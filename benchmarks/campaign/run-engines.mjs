// Cross-engine arm: Chromium (V8), Firefox (SpiderMonkey), WebKit
// (JavaScriptCore) on their current Playwright builds, in one session against
// one build of the library. Writes raw per-repetition samples so the analysis
// can report dispersion rather than a bare minimum. Sizes, reps, warmups, and
// seed come from the shared protocol module, the same one the page itself
// loads.
//
//   node benchmarks/campaign/run-engines.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";
import { REPS, SEED, SIZES, WARMUPS } from "./protocol.mjs";
import { startServer } from "./serve.mjs";
import { median } from "./stats.mjs";

const engines = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];

const server = await startServer();
const results = {
  startedAt: new Date().toISOString(),
  machine: { platform: process.platform, arch: process.arch, node: process.version },
  config: { sizes: SIZES, reps: REPS, warmups: WARMUPS, seed: SEED },
  engines: {},
};

try {
  for (const [name, type] of engines) {
    process.stdout.write(`\n=== ${name}\n`);
    const browser = await type.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
      });

      await page.goto(server.url, { waitUntil: "load" });
      await page.waitForFunction(() => globalThis.__ready === true, null, { timeout: 30_000 });

      const data = await page.evaluate((cfg) => globalThis.__runCampaign(cfg), {
        sizes: SIZES,
        reps: REPS,
        warmups: WARMUPS,
        seed: SEED,
      });

      results.engines[name] = { version: browser.version(), errors, ...data };

      for (const size of data.sizes) {
        process.stdout.write(
          `  n=${size.n.toLocaleString()}  wasm=${median(size.wasm_raw).toFixed(3)}ms  ` +
            `js=${median(size.js_core).toFixed(3)}ms  ` +
            `copy=${median(size.copy_proxy).toFixed(3)}ms  ` +
            `api=${median(size.public_api).toFixed(3)}ms  maxAbsDiff=${size.maxAbsDiff}\n`,
        );
      }
      process.stdout.write(`  timer granularity: ${data.timerResolutionProbeMs}ms\n`);
      if (errors.length > 0) process.stdout.write(`  ERRORS: ${errors.slice(0, 3).join(" | ")}\n`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

results.finishedAt = new Date().toISOString();
const out = new URL("./results/raw.json", import.meta.url);
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write(`\nwrote ${out.pathname}\n`);
