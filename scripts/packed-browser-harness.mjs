import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium, firefox, webkit } from "playwright";
import { build, createServer, preview } from "vite";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const browserTypes = { chromium, firefox, webkit };

export function createPackedFixturePackageJson(coreTarball, downsampleTarball) {
  return {
    name: "vizcrush-packed-browser-fixture",
    private: true,
    type: "module",
    dependencies: {
      "@vizcrush/core": `file:${coreTarball}`,
      "@vizcrush/downsample": `file:${downsampleTarball}`,
    },
  };
}

// pnpm 12 reads overrides only from pnpm-workspace.yaml, never from a
// package.json "pnpm" field, so the fixture pins its transitive core here.
export function createPackedFixtureWorkspaceYaml(coreTarball) {
  return `overrides:\n  "@vizcrush/core": ${JSON.stringify(`file:${coreTarball}`)}\n`;
}

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
}

function packPackage(packageDirectory, destination) {
  const before = new Set(readdirSync(destination));
  run("pnpm", ["--dir", packageDirectory, "pack", "--pack-destination", destination]);
  const tarball = readdirSync(destination).find(
    (file) => file.endsWith(".tgz") && !before.has(file),
  );
  if (!tarball) throw new Error(`pnpm pack did not produce a tarball for ${packageDirectory}`);
  return join(destination, tarball);
}

export async function runPackedBrowserSmoke({ browser }) {
  const browserType = browserTypes[browser];
  if (!browserType) throw new Error(`Unsupported browser '${browser}'`);

  const temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), "vizcrush-packed-browser-")));
  const packDirectory = join(temporaryRoot, "packs");
  const fixtureDirectory = join(temporaryRoot, "fixture");
  mkdirSync(packDirectory);
  mkdirSync(fixtureDirectory);

  let viteServer;
  let demoServer;
  let browserInstance;
  try {
    const coreTarball = packPackage(join(repositoryRoot, "packages/core"), packDirectory);
    const downsampleTarball = packPackage(
      join(repositoryRoot, "packages/downsample"),
      packDirectory,
    );
    writeFileSync(
      join(fixtureDirectory, "package.json"),
      JSON.stringify(createPackedFixturePackageJson(coreTarball, downsampleTarball), null, 2),
    );
    writeFileSync(
      join(fixtureDirectory, "pnpm-workspace.yaml"),
      createPackedFixtureWorkspaceYaml(coreTarball),
    );
    writeFileSync(
      join(fixtureDirectory, "index.html"),
      '<!doctype html><canvas id="chart" width="320" height="160"></canvas><script type="module" src="/main.js"></script>',
    );
    writeFileSync(
      join(fixtureDirectory, "main.js"),
      `
        import { TimeSeriesWorkerClient } from "@vizcrush/downsample/worker-client";

        const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
        const client = new TimeSeriesWorkerClient(worker);
        const canvas = document.querySelector("#chart");
        const context = canvas.getContext("2d");
        let latestDomainMax = 999_999;

        function render(result) {
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.beginPath();
          for (let index = 0; index < result.x.length; index++) {
            const px = (index / Math.max(1, result.x.length - 1)) * canvas.width;
            const py = canvas.height / 2 - result.y[index] * 4;
            if (index === 0) context.moveTo(px, py);
            else context.lineTo(px, py);
          }
          context.stroke();
        }

        async function measure(backend, phase = "viewport", repetitions = 5) {
          await client.view(
            { xMin: 900_000, xMax: 999_999, widthCssPixels: 100 },
            { backend },
          );
          const samples = [];
          let latest;
          for (let run = 0; run < repetitions; run++) {
            const started = performance.now();
            latest = await client.view(
              {
                xMin: Math.max(0, latestDomainMax - 99_999),
                xMax: latestDomainMax,
                widthCssPixels: canvas.getBoundingClientRect().width,
              },
              { backend },
            );
            const responseAt = performance.now();
            render(latest.value);
            const completedAt = performance.now();
            samples.push({
              label: "warm",
              phase,
              sourceRevision: latest.value.sourceRevision,
              domain: { xMin: Math.max(0, latestDomainMax - 99_999), xMax: latestDomainMax },
              widthCssPixels: canvas.getBoundingClientRect().width,
              actualBackend: latest.value.backend,
              workerProcessingMs: latest.workerProcessingMs,
              roundTripMs: responseAt - started,
              callerToRenderCompletionMs: completedAt - started,
              rendererMs: completedAt - responseAt,
            });
          }
          return {
            backend: latest.value.backend,
            outputLength: latest.value.x.length,
            x: Array.from(latest.value.x),
            y: Array.from(latest.value.y),
            bestMs: Math.min(...samples.map((sample) => sample.roundTripMs)),
            samples,
            requestId: latest.requestId,
          };
        }

        function percentiles(values) {
          const sorted = [...values].sort((left, right) => left - right);
          const at = (quantile) => sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
          return { p50: at(0.5), p95: at(0.95) };
        }

        function batch(start, length) {
          const x = new Float64Array(length);
          const y = new Float64Array(length);
          for (let index = 0; index < length; index++) {
            x[index] = start + index;
            y[index] = Math.sin((start + index) / 100);
          }
          return { x, y };
        }

        try {
          const frameGapsMs = [];
          let previousFrame = null;
          let frameActive = true;
          let frameId = 0;
          const recordFrame = (now) => {
            if (previousFrame !== null) frameGapsMs.push(now - previousFrame);
            previousFrame = now;
            if (frameActive) frameId = requestAnimationFrame(recordFrame);
          };
          frameId = requestAnimationFrame(recordFrame);
          const initializationStarted = performance.now();
          const state = await client.state();
          const initializationCompleted = performance.now();
          const obsolete = client.view({ xMin: 940_000, xMax: 960_000, widthCssPixels: 100 });
          const replaced = client.view({ xMin: 920_000, xMax: 930_000, widthCssPixels: 100 });
          const reset = client.view({ xMin: 900_000, xMax: 999_999, widthCssPixels: 100 });
          const [obsoleteOutcome, replacedOutcome, resetOutcome] = await Promise.allSettled([
            obsolete,
            replaced,
            reset,
          ]);
          if (resetOutcome.status !== "fulfilled") throw resetOutcome.reason;
          const wasm = await measure("wasm");
          const js = await measure("js");
          const resizeSamples = [];
          const resizeOutputLengths = [];
          for (const width of [320, 960]) {
            canvas.style.width = width + "px";
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const resizedJs = await measure("js", "resize", 1);
            const resizedWasm = await measure("wasm", "resize", 1);
            resizeSamples.push(...resizedJs.samples, ...resizedWasm.samples);
            resizeOutputLengths.push(resizedJs.outputLength, resizedWasm.outputLength);
          }
          canvas.style.width = "320px";
          const firstBatch = batch(1_000_000, 20_000);
          const activeBeforeAppend = client.view({ xMin: 990_000, xMax: 999_999, widthCssPixels: 100 });
          const firstAppend = client.append(firstBatch.x, firstBatch.y, { transfer: true });
          const navigationDuringAppend = client.view({ xMin: 980_000, xMax: 989_999, widthCssPixels: 100 });
          const rejectedBatch = batch(1_020_000, 1);
          const backpressure = await client
            .append(rejectedBatch.x, rejectedBatch.y, { transfer: true })
            .then(() => "unexpected-success", (error) => error.name);
          const [activeOutcome, navigationOutcome, firstAppendState] = await Promise.all([
            activeBeforeAppend.then(() => "unexpected-success", (error) => error.name),
            navigationDuringAppend,
            firstAppend,
          ]);
          for (let start = 1_020_000; start < 1_120_000; start += 20_000) {
            const next = batch(start, 20_000);
            await client.append(next.x, next.y, { transfer: true });
          }
          latestDomainMax = 1_119_999;
          const steadyJs = await measure("js", "steady-stream", 1);
          const steadyWasm = await measure("wasm", "steady-stream", 1);
          const finalState = await client.state();
          const evicted = await client.view({ xMin: 0, xMax: 999, widthCssPixels: 100 });
          const newest = await client.view({ xMin: 1_020_000, xMax: 1_119_999, widthCssPixels: 100 });
          frameActive = false;
          cancelAnimationFrame(frameId);
          const samples = [
            ...js.samples,
            ...wasm.samples,
            ...resizeSamples,
            ...steadyJs.samples,
            ...steadyWasm.samples,
          ];
          const summaries = {
            workerRoundTripMs: percentiles(samples.map((sample) => sample.roundTripMs)),
            rendererMs: percentiles(samples.map((sample) => sample.rendererMs)),
            callerToRenderCompletionMs: percentiles(
              samples.map((sample) => sample.callerToRenderCompletionMs),
            ),
            frameGapMs: percentiles(frameGapsMs),
          };
          const report = {
            schemaVersion: 1,
            source: {
              initialGenerator: "lcg-1664525-seed-7",
              initialPoints: 1_000_000,
              retentionCapacity: 1_000_000,
              scenarioStartSourceIndex: 1_000_000,
              scenarioStartRevision: state.value.sourceRevision,
            },
            samples,
            frameGapsMs,
            summaries,
          };
          const exportedReport = JSON.parse(await new Blob([JSON.stringify(report)]).text());
          globalThis.__vizcrushResult = {
            retainedPoints: finalState.value.retainedPoints,
            bufferBytes: finalState.value.bufferBytes,
            scenario: {
              initialization: {
                label: "cold",
                roundTripMs: initializationCompleted - initializationStarted,
                workerProcessingMs: state.workerProcessingMs,
                sourceRevision: state.value.sourceRevision,
              },
              ...exportedReport,
              exportRoundTrip: JSON.stringify(exportedReport) === JSON.stringify(report),
              resizeOutputLengths,
            },
            scheduling: {
              obsolete: obsoleteOutcome.reason?.name,
              replaced: replacedOutcome.reason?.name,
              resetViewportId: resetOutcome.value.viewportId,
              resetOutputLength: resetOutcome.value.value.x.length,
            },
            streaming: {
              activeOutcome,
              navigationRevision: navigationOutcome.value.sourceRevision,
              appendRevision: firstAppendState.value.sourceRevision,
              transferDetached: firstBatch.x.byteLength === 0 && firstBatch.y.byteLength === 0,
              backpressure,
              rejectedOwnershipPreserved:
                rejectedBatch.x.byteLength > 0 && rejectedBatch.y.byteLength > 0,
              sourceRevision: finalState.value.sourceRevision,
              oldestX: finalState.value.oldestX,
              newestX: finalState.value.newestX,
              evictedVisiblePoints: evicted.value.visiblePoints,
              evictedNeighborPoints: evicted.value.edgeNeighborPoints,
              newestOutputLength: newest.value.x.length,
            },
            wasm,
            js,
            parity:
              wasm.x.length === js.x.length &&
              wasm.x.every((value, index) => value === js.x[index]) &&
              wasm.y.every((value, index) => value === js.y[index]),
          };
        } catch (error) {
          globalThis.__vizcrushError = String(error?.stack ?? error);
        } finally {
          await client.dispose();
        }
      `,
    );
    writeFileSync(
      join(fixtureDirectory, "worker.js"),
      `
        import { TimeSeriesSession } from "@vizcrush/downsample/session";
        import { installTimeSeriesWorkerHost } from "@vizcrush/downsample/worker-host";

        const size = 1_000_000;
        const x = new Float64Array(size);
        const y = new Float64Array(size);
        let state = 7;
        for (let index = 0; index < size; index++) {
          state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
          x[index] = index;
          y[index] =
            Math.sin(index / 7_000) * 16 +
            Math.sin(index / 311) * 2 +
            (state / 4_294_967_296 - 0.5);
        }
        const session = new TimeSeriesSession({
          capacity: size,
          maxOutputPoints: 20_000,
          maxIngestionBatchPoints: 20_000,
        });
        session.load(x, y);
        installTimeSeriesWorkerHost(self, session);
      `,
    );

    run("pnpm", ["install", "--dir", fixtureDirectory, "--ignore-scripts", "--no-frozen-lockfile"]);

    const directCoreEntry = realpathSync(
      join(fixtureDirectory, "node_modules/@vizcrush/core/dist/index.js"),
    );
    const downsampleDirectory = realpathSync(
      join(fixtureDirectory, "node_modules/@vizcrush/downsample"),
    );
    const transitiveCoreEntry = realpathSync(join(downsampleDirectory, "../core/dist/index.js"));
    if (transitiveCoreEntry !== directCoreEntry) {
      throw new Error(
        `Packed downsample resolved a different core package: ${transitiveCoreEntry}`,
      );
    }

    await build({
      root: fixtureDirectory,
      logLevel: "error",
      build: { target: "esnext" },
      worker: { format: "es" },
    });
    viteServer = await preview({
      root: fixtureDirectory,
      logLevel: "error",
      preview: { host: "127.0.0.1", port: 0 },
    });
    const url = viteServer.resolvedUrls?.local[0];
    if (!url) throw new Error("Vite did not expose a local fixture URL");

    browserInstance = await browserType.launch({ headless: true });
    const page = await browserInstance.newPage();
    const diagnostics = [];
    page.on("console", (message) =>
      diagnostics.push(`console:${message.type()}: ${message.text()}`),
    );
    page.on("requestfailed", (request) =>
      diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`),
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        diagnostics.push(`response:${response.status()}: ${response.url()}`);
    });
    await page.goto(url);
    await page.waitForFunction(() => globalThis.__vizcrushResult || globalThis.__vizcrushError);
    const error = await page.evaluate(() => globalThis.__vizcrushError);
    if (error) throw new Error(error);
    const result = await page.evaluate(() => globalThis.__vizcrushResult);

    const demoDirectory = join(repositoryRoot, "examples/viewport-session");
    demoServer = await createServer({
      root: demoDirectory,
      logLevel: "error",
      worker: { format: "es" },
      server: { host: "127.0.0.1", port: 0 },
    });
    await demoServer.listen();
    const demoUrl = demoServer.resolvedUrls?.local[0];
    if (!demoUrl) throw new Error("Vite did not expose the complete demo URL");
    const demoPage = await browserInstance.newPage({ acceptDownloads: true });
    await demoPage.goto(demoUrl);
    await demoPage.waitForFunction(
      () => {
        const chart = document.querySelector("#chart");
        return (
          document.querySelector("#retained")?.textContent?.includes("1,000,000") &&
          chart?.dataset.viewportId !== undefined
        );
      },
      undefined,
      { timeout: 120_000 },
    );
    const readDemoState = () =>
      demoPage.$eval("#chart", (element) => ({
        viewportId: Number(element.dataset.viewportId),
        sourceRevision: Number(element.dataset.sourceRevision),
        domainMin: Number(element.dataset.domainMin),
        domainMax: Number(element.dataset.domainMax),
      }));
    const initialDemoState = await readDemoState();
    await demoPage.click("#pan-left");
    await demoPage.waitForFunction((previous) => {
      const chart = document.querySelector("#chart");
      return (
        Number(chart?.dataset.viewportId) > previous.viewportId &&
        Number(chart?.dataset.domainMax) < previous.domainMax
      );
    }, initialDemoState);
    const pannedDemoState = await readDemoState();
    if (pannedDemoState.domainMax >= initialDemoState.domainMax) {
      throw new Error("Complete demo pan did not change the rendered domain");
    }
    if ((await demoPage.getAttribute("#follow", "aria-pressed")) !== "false") {
      throw new Error("Complete demo pan did not disable follow-latest");
    }
    await demoPage.click("#zoom-in");
    await demoPage.waitForFunction((previous) => {
      const chart = document.querySelector("#chart");
      return (
        Number(chart?.dataset.viewportId) > previous.viewportId &&
        Number(chart?.dataset.domainMax) - Number(chart?.dataset.domainMin) <
          previous.domainMax - previous.domainMin
      );
    }, pannedDemoState);
    const zoomedDemoState = await readDemoState();
    if (
      zoomedDemoState.domainMax - zoomedDemoState.domainMin >=
      pannedDemoState.domainMax - pannedDemoState.domainMin
    ) {
      throw new Error("Complete demo zoom did not narrow the rendered domain");
    }
    await demoPage.click("#chart");
    await demoPage.keyboard.press("ArrowRight");
    await demoPage.waitForFunction((previous) => {
      const chart = document.querySelector("#chart");
      return (
        Number(chart?.dataset.viewportId) > previous.viewportId &&
        Number(chart?.dataset.domainMin) > previous.domainMin
      );
    }, zoomedDemoState);
    const keyboardPanState = await readDemoState();
    if (
      keyboardPanState.domainMin <= zoomedDemoState.domainMin ||
      (await demoPage.getAttribute("#follow", "aria-pressed")) !== "false"
    ) {
      throw new Error("Complete demo keyboard pan did not publish its current domain");
    }
    await demoPage.keyboard.press("f");
    if ((await demoPage.getAttribute("#follow", "aria-pressed")) !== "true") {
      throw new Error("Complete demo keyboard follow-latest control failed");
    }
    await demoPage.selectOption("#backend", "js");
    await demoPage.waitForFunction(
      () => document.querySelector("#actual-backend")?.textContent === "js",
    );
    await demoPage.click("#pause");
    if ((await demoPage.getAttribute("#pause", "aria-pressed")) !== "true") {
      throw new Error("Complete demo pause control failed");
    }
    await demoPage.click("#pause");
    if ((await demoPage.getAttribute("#pause", "aria-pressed")) !== "false") {
      throw new Error("Complete demo button resume did not clear the paused state");
    }
    await demoPage.click("#chart");
    await demoPage.keyboard.press("Space");
    if ((await demoPage.getAttribute("#pause", "aria-pressed")) !== "true") {
      throw new Error("Complete demo keyboard pause control failed");
    }
    await demoPage.keyboard.press("Space");
    if ((await demoPage.getAttribute("#pause", "aria-pressed")) !== "false") {
      throw new Error("Complete demo keyboard resume did not clear the paused state");
    }
    await demoPage.keyboard.press("0");
    await demoPage.waitForFunction(
      () => {
        const chart = document.querySelector("#chart");
        return (
          document.querySelector("#progress")?.textContent === "1,000,000 total · rev 1" &&
          chart?.dataset.viewportId === "1" &&
          chart.dataset.sourceRevision === "1" &&
          chart.dataset.domainMin === "900000" &&
          chart.dataset.domainMax === "999999"
        );
      },
      undefined,
      { timeout: 120_000 },
    );
    await demoPage.click("#run-scenario");
    await demoPage.waitForFunction(
      () => !document.querySelector("#export-results")?.hasAttribute("disabled"),
      undefined,
      { timeout: 120_000 },
    );
    const [download] = await Promise.all([
      demoPage.waitForEvent("download"),
      demoPage.click("#export-results"),
    ]);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error("Complete demo export did not produce a local file");
    const demoReport = JSON.parse(readFileSync(downloadPath, "utf8"));
    await demoPage.close();

    const output = {
      browser,
      timestamp: new Date().toISOString(),
      wasm: {
        backend: result.wasm.backend,
        outputLength: result.wasm.outputLength,
        bestMs: result.wasm.bestMs,
      },
      js: {
        backend: result.js.backend,
        outputLength: result.js.outputLength,
        bestMs: result.js.bestMs,
      },
      parity: result.parity,
      retainedPoints: result.retainedPoints,
      bufferBytes: result.bufferBytes,
      scenario: result.scenario,
      demo: {
        schemaVersion: demoReport.schemaVersion,
        initialPoints: demoReport.source.initialPoints,
        scenarioStartSourceIndex: demoReport.source.scenarioStartSourceIndex,
        scenarioStartRevision: demoReport.source.scenarioStartRevision,
        viewSamples: demoReport.viewSamples,
        appendSamples: demoReport.appendSamples,
        frameGapsMs: demoReport.frameGapsMs,
        summaries: demoReport.summaries,
        parity: demoReport.parity,
        controlsExercised: true,
        exported: true,
      },
      requestIds: { wasm: result.wasm.requestId, js: result.js.requestId },
      scheduling: result.scheduling,
      streaming: result.streaming,
      diagnostics,
    };

    if (process.env.BROWSER_RESULT_PATH) {
      writeFileSync(
        resolve(repositoryRoot, process.env.BROWSER_RESULT_PATH),
        JSON.stringify(output, null, 2),
      );
    }
    return output;
  } finally {
    await browserInstance?.close();
    await demoServer?.close();
    await viteServer?.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
