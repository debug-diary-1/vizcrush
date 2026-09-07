import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium, firefox, webkit } from "playwright";
import { build, preview } from "vite";

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

// pnpm 11 reads overrides only from pnpm-workspace.yaml, never from a
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
      '<script type="module" src="/main.js"></script>',
    );
    writeFileSync(
      join(fixtureDirectory, "main.js"),
      `
        import { TimeSeriesWorkerClient } from "@vizcrush/downsample/worker-client";

        const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
        const client = new TimeSeriesWorkerClient(worker);

        async function measure(backend) {
          await client.view(
            { xMin: 0, xMax: 99_999, widthCssPixels: 100 },
            { backend },
          );
          const times = [];
          let latest;
          for (let run = 0; run < 5; run++) {
            const started = performance.now();
            latest = await client.view(
              { xMin: 0, xMax: 99_999, widthCssPixels: 100 },
              { backend },
            );
            times.push(performance.now() - started);
          }
          return {
            backend: latest.value.backend,
            outputLength: latest.value.x.length,
            x: Array.from(latest.value.x),
            y: Array.from(latest.value.y),
            bestMs: Math.min(...times),
            requestId: latest.requestId,
          };
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
          const state = await client.state();
          const obsolete = client.view({ xMin: 40_000, xMax: 60_000, widthCssPixels: 100 });
          const replaced = client.view({ xMin: 20_000, xMax: 30_000, widthCssPixels: 100 });
          const reset = client.view({ xMin: 0, xMax: 99_999, widthCssPixels: 100 });
          const [obsoleteOutcome, replacedOutcome, resetOutcome] = await Promise.allSettled([
            obsolete,
            replaced,
            reset,
          ]);
          if (resetOutcome.status !== "fulfilled") throw resetOutcome.reason;
          const wasm = await measure("wasm");
          const js = await measure("js");
          const firstBatch = batch(100_000, 20_000);
          const activeBeforeAppend = client.view({ xMin: 90_000, xMax: 99_999, widthCssPixels: 100 });
          const firstAppend = client.append(firstBatch.x, firstBatch.y, { transfer: true });
          const navigationDuringAppend = client.view({ xMin: 80_000, xMax: 89_999, widthCssPixels: 100 });
          const rejectedBatch = batch(120_000, 1);
          const backpressure = await client
            .append(rejectedBatch.x, rejectedBatch.y, { transfer: true })
            .then(() => "unexpected-success", (error) => error.name);
          const [activeOutcome, navigationOutcome, firstAppendState] = await Promise.all([
            activeBeforeAppend.then(() => "unexpected-success", (error) => error.name),
            navigationDuringAppend,
            firstAppend,
          ]);
          for (let start = 120_000; start < 220_000; start += 20_000) {
            const next = batch(start, 20_000);
            await client.append(next.x, next.y, { transfer: true });
          }
          const finalState = await client.state();
          const evicted = await client.view({ xMin: 0, xMax: 999, widthCssPixels: 100 });
          const newest = await client.view({ xMin: 120_000, xMax: 219_999, widthCssPixels: 100 });
          globalThis.__vizcrushResult = {
            retainedPoints: finalState.value.retainedPoints,
            bufferBytes: finalState.value.bufferBytes,
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

        const size = 100_000;
        const x = new Float64Array(size);
        const y = new Float64Array(size);
        for (let index = 0; index < size; index++) {
          x[index] = index;
          y[index] = Math.sin(index / 100) + (index % 997 === 0 ? 5 : 0);
        }
        const session = new TimeSeriesSession({
          capacity: size,
          maxOutputPoints: 100,
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
    await viteServer?.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
