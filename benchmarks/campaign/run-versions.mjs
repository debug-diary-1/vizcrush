// Engine-version sweep with INDEPENDENT browser launches.
//
// Why this exists: a failure to reproduce an older performance number does not,
// on its own, say what changed. Between two campaigns the browser build may
// change, but so may the harness, the statistic, the machine, and the browser
// lifecycle. This script holds all of those fixed and varies ONLY the engine
// binary, using the Chromium builds Playwright has already cached.
//
// It also measures each build in several independent launches, so the reported
// spread is across-launch (fresh process, fresh JIT state) rather than the
// much smaller within-session spread.
//
//   SESSIONS=5 node benchmarks/campaign/run-versions.mjs
//
// Chromium only: Playwright's Firefox and WebKit distributions are launched
// through `pw_run.sh`, which is a wrapper script rather than a browser
// executable, so passing it as `executablePath` hangs instead of launching.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";
import { median } from "./stats.mjs";

const CACHE = process.env.PLAYWRIGHT_BROWSERS_PATH ?? `${homedir()}/Library/Caches/ms-playwright`;
const SESSIONS = Number(process.env.SESSIONS ?? 5);
const SIZES = [
  { n: 100_000, calls: 300, asyncCalls: 100 },
  { n: 1_000_000, calls: 30, asyncCalls: 20 },
];
const REPS = 15;
const WARMUPS = 3;
const SEED = 42;

function cachedChromiumBuilds() {
  if (!existsSync(CACHE)) return [];
  return readdirSync(CACHE)
    .filter((entry) => /^chromium-\d+$/u.test(entry))
    .map((entry) => ({
      build: entry,
      exe: `${CACHE}/${entry}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    }))
    .filter((candidate) => existsSync(candidate.exe))
    .sort((a, b) => Number(a.build.split("-")[1]) - Number(b.build.split("-")[1]));
}

const builds = cachedChromiumBuilds();
if (builds.length === 0) {
  process.stderr.write(`No cached Chromium builds found under ${CACHE}\n`);
  process.exit(1);
}

const server = await startServer();
const out = {
  startedAt: new Date().toISOString(),
  purpose: "engine-version sweep, independent launches per session",
  machine: { platform: process.platform, arch: process.arch, node: process.version },
  config: { sessions: SESSIONS, sizes: SIZES, reps: REPS, warmups: WARMUPS, seed: SEED },
  targets: [],
};
const resultsDir = new URL("./results/", import.meta.url);
const outPath = new URL("./results/versions.json", import.meta.url);

try {
  for (const { build, exe } of builds) {
    process.stdout.write(`\n=== ${build}\n`);
    const record = { label: build, version: null, sessions: [] };

    for (let index = 0; index < SESSIONS; index += 1) {
      let browser;
      try {
        browser = await chromium.launch({ headless: true, executablePath: exe });
      } catch (error) {
        process.stdout.write(`  launch failed: ${String(error).slice(0, 120)}\n`);
        break;
      }
      try {
        record.version ??= browser.version();
        const page = await browser.newPage();
        await page.goto(server.url, { waitUntil: "load" });
        await page.waitForFunction(() => globalThis.__ready === true, null, { timeout: 30_000 });
        const data = await page.evaluate((cfg) => globalThis.__runCampaign(cfg), {
          sizes: SIZES,
          reps: REPS,
          warmups: WARMUPS,
          seed: SEED,
        });

        const session = { index, sizes: {} };
        for (const size of data.sizes) {
          session.sizes[size.n] = {
            wasm_median: median(size.wasm_raw),
            wasm_min: Math.min(...size.wasm_raw),
            js_median: median(size.js_core),
            js_min: Math.min(...size.js_core),
            copy_median: median(size.copy_proxy),
            api_median: median(size.public_api),
            maxAbsDiff: size.maxAbsDiff,
            samples: { wasm_raw: size.wasm_raw, js_core: size.js_core },
          };
        }
        record.sessions.push(session);

        const one = session.sizes[1_000_000];
        process.stdout.write(
          `  session ${index}: 1M wasm=${one.wasm_median.toFixed(2)} js=${one.js_median.toFixed(2)} ` +
            `median-ratio=${(one.wasm_median / one.js_median).toFixed(2)}x  ` +
            `min-ratio=${(one.wasm_min / one.js_min).toFixed(2)}x\n`,
        );
      } catch (error) {
        process.stdout.write(`  session ${index} failed: ${String(error).slice(0, 160)}\n`);
      } finally {
        await browser.close();
      }
    }

    if (record.sessions.length > 0) {
      const ratios = record.sessions.map(
        (s) => s.sizes[1_000_000].wasm_median / s.sizes[1_000_000].js_median,
      );
      process.stdout.write(
        `  -> ${record.version} | 1M wasm/js across ${ratios.length} launches: ` +
          `${ratios.map((r) => r.toFixed(2)).join(", ")}\n`,
      );
    }

    // Written after every build so a later hang cannot lose completed work.
    out.targets.push(record);
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2));
  }
} finally {
  await server.close();
}

out.finishedAt = new Date().toISOString();
writeFileSync(outPath, JSON.stringify(out, null, 2));
process.stdout.write(`\nwrote ${outPath.pathname}\n`);
