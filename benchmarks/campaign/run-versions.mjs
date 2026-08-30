// Engine-version sweep with INDEPENDENT browser launches.
//
// Why this exists: a failure to reproduce an older performance number does not,
// on its own, say what changed. Between two campaigns the browser build may
// change, but so may the harness, the statistic, the machine, and the browser
// lifecycle. This script holds all of those fixed and varies ONLY the engine
// binary, using the Chromium builds Playwright has already cached (see the
// README for how to obtain the historical builds).
//
// It also measures each build in several independent launches, so the reported
// spread is across-launch (fresh process, fresh JIT state) rather than the
// much smaller within-session spread. Launches are ordered ROUND-ROBIN —
// every build once, then every build again — so that slow machine-state drift
// lands across all builds instead of being confounded with build order.
//
//   SESSIONS=5 node benchmarks/campaign/run-versions.mjs
//   VERSIONS_OUT=versions-run2.json node benchmarks/campaign/run-versions.mjs
//   SWEEP_BUILDS=chromium-1223,chromium-1228 node benchmarks/campaign/run-versions.mjs
//
// Chromium only: Playwright's Firefox and WebKit distributions are launched
// through `pw_run.sh`, which is a wrapper script rather than a browser
// executable, so passing it as `executablePath` hangs instead of launching.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { REPS, SEED, SIZES, WARMUPS } from "./protocol.mjs";
import { startServer } from "./serve.mjs";
import { median } from "./stats.mjs";

/**
 * Playwright's browser cache for this platform: the PLAYWRIGHT_BROWSERS_PATH
 * override when set, otherwise the per-OS default Playwright itself uses.
 */
export function defaultCacheDir({ platform = process.platform, env = process.env } = {}) {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform === "darwin") return `${homedir()}/Library/Caches/ms-playwright`;
  if (platform === "win32") {
    return `${env.LOCALAPPDATA ?? `${homedir()}/AppData/Local`}/ms-playwright`;
  }
  return `${env.XDG_CACHE_HOME ?? `${homedir()}/.cache`}/ms-playwright`;
}

// Chromium executable location inside a cached build, per Playwright platform.
const EXE_LAYOUTS = [
  "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-linux/chrome",
  "chrome-win/chrome.exe",
];

/**
 * Discover cached Chromium builds under `cache`, ascending by build number.
 * A `chromium-<n>` directory counts only if a known executable layout exists
 * inside it.
 */
export function cachedChromiumBuilds(cache = defaultCacheDir()) {
  if (!existsSync(cache)) return [];
  return readdirSync(cache)
    .filter((entry) => /^chromium-\d+$/u.test(entry))
    .map((entry) => ({
      build: entry,
      exe: EXE_LAYOUTS.map((layout) => `${cache}/${entry}/${layout}`).find(existsSync) ?? null,
    }))
    .filter((candidate) => candidate.exe !== null)
    .sort((a, b) => Number(a.build.split("-")[1]) - Number(b.build.split("-")[1]));
}

/**
 * Restrict discovered builds to a comma-separated SWEEP_BUILDS allowlist of
 * cache directory names. Unset means "sweep everything cached". A name that
 * is not in the cache throws: a pinned sweep that silently dropped a build
 * would produce a misleading table.
 */
export function filterBuilds(builds, allowlist) {
  if (allowlist === undefined || allowlist === "") return builds;
  const wanted = new Set(
    allowlist
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const missing = [...wanted].filter((name) => !builds.some((b) => b.build === name));
  if (missing.length > 0) {
    throw new Error(`SWEEP_BUILDS names builds not in the cache: ${missing.join(", ")}`);
  }
  return builds.filter((b) => wanted.has(b.build));
}

/**
 * Parse a SESSIONS value into a positive integer launch count, or throw.
 * Zero, negative, fractional, and non-numeric values are configuration
 * errors, not requests for an empty sweep.
 */
export function parseSessions(value, fallback = 5) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`SESSIONS must be a positive integer, got "${value}"`);
  }
  return n;
}

/**
 * Round-robin measurement order: session 0 of every build, then session 1 of
 * every build, and so on. Interleaving decouples slow machine-state drift
 * from build identity; the sequential alternative would confound the two.
 */
export function sessionPlan(builds, sessions) {
  const plan = [];
  for (let session = 0; session < sessions; session += 1) {
    for (const build of builds) plan.push({ session, build });
  }
  return plan;
}

async function main() {
  const sessions = parseSessions(process.env.SESSIONS);
  const builds = filterBuilds(cachedChromiumBuilds(), process.env.SWEEP_BUILDS);
  if (builds.length === 0) {
    process.stderr.write(`No cached Chromium builds found under ${defaultCacheDir()}\n`);
    process.exit(1);
  }

  const server = await startServer();
  const out = {
    startedAt: new Date().toISOString(),
    purpose: "engine-version sweep, independent launches per session, round-robin build order",
    machine: { platform: process.platform, arch: process.arch, node: process.version },
    config: {
      sessions,
      order: "round-robin (session-major)",
      sizes: SIZES,
      reps: REPS,
      warmups: WARMUPS,
      seed: SEED,
    },
    targets: [],
  };
  const records = new Map();
  for (const { build } of builds) {
    const record = { label: build, version: null, sessions: [] };
    records.set(build, record);
    out.targets.push(record);
  }

  const resultsDir = new URL("./results/", import.meta.url);
  const outPath = new URL(process.env.VERSIONS_OUT ?? "versions.json", resultsDir);
  mkdirSync(resultsDir, { recursive: true });

  const dead = new Set();
  let order = 0;
  try {
    for (const { session, build } of sessionPlan(builds, sessions)) {
      if (dead.has(build.build)) continue;
      const record = records.get(build.build);

      let browser;
      try {
        browser = await chromium.launch({ headless: true, executablePath: build.exe });
      } catch (error) {
        process.stdout.write(`${build.build} launch failed: ${String(error).slice(0, 120)}\n`);
        dead.add(build.build);
        continue;
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

        const measured = { index: session, order, sizes: {} };
        order += 1;
        for (const size of data.sizes) {
          measured.sizes[size.n] = {
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
        record.sessions.push(measured);

        const one = measured.sizes[1_000_000];
        process.stdout.write(
          `${build.build} session ${session}: 1M wasm=${one.wasm_median.toFixed(2)} ` +
            `js=${one.js_median.toFixed(2)} ` +
            `median-ratio=${(one.wasm_median / one.js_median).toFixed(2)}x  ` +
            `min-ratio=${(one.wasm_min / one.js_min).toFixed(2)}x\n`,
        );
      } catch (error) {
        // A parity-gate rejection means the harness measured nothing
        // comparable; that invalidates the sweep, so abort rather than skip.
        if (/parity gate/u.test(String(error))) throw error;
        process.stdout.write(
          `${build.build} session ${session} failed: ${String(error).slice(0, 160)}\n`,
        );
      } finally {
        await browser.close();
      }

      // Written after every launch so a later hang cannot lose completed work.
      writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
    }
  } finally {
    await server.close();
  }

  for (const record of out.targets) {
    if (record.sessions.length === 0) continue;
    const ratios = record.sessions.map(
      (s) => s.sizes[1_000_000].wasm_median / s.sizes[1_000_000].js_median,
    );
    process.stdout.write(
      `${record.label} -> ${record.version} | 1M wasm/js across ${ratios.length} launches: ` +
        `${ratios.map((r) => r.toFixed(2)).join(", ")}\n`,
    );
  }

  out.finishedAt = new Date().toISOString();
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`\nwrote ${outPath.pathname}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
