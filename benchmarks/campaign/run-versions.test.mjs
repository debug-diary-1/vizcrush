import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cachedChromiumBuilds, parseSessions, sessionPlan } from "./run-versions.mjs";

describe("parseSessions", () => {
  it("defaults when unset and parses positive integers", () => {
    expect(parseSessions(undefined)).toBe(5);
    expect(parseSessions("")).toBe(5);
    expect(parseSessions(undefined, 3)).toBe(3);
    expect(parseSessions("4")).toBe(4);
  });

  it("rejects zero, negative, fractional, and non-numeric values", () => {
    for (const bad of ["0", "-3", "2.5", "NaN", "abc", "Infinity"]) {
      expect(() => parseSessions(bad)).toThrow(/positive integer/u);
    }
  });
});

describe("sessionPlan", () => {
  it("interleaves builds round-robin, session-major", () => {
    const builds = [{ build: "chromium-1" }, { build: "chromium-2" }];
    const plan = sessionPlan(builds, 3);
    expect(plan.map((p) => `${p.build.build}#${p.session}`)).toEqual([
      "chromium-1#0",
      "chromium-2#0",
      "chromium-1#1",
      "chromium-2#1",
      "chromium-1#2",
      "chromium-2#2",
    ]);
  });
});

describe("cachedChromiumBuilds", () => {
  const cache = mkdtempSync(join(tmpdir(), "campaign-cache-"));
  afterAll(() => rmSync(cache, { recursive: true, force: true }));

  it("returns an empty list for a missing cache directory", () => {
    expect(cachedChromiumBuilds(join(cache, "nope"))).toEqual([]);
  });

  it("finds builds across platform layouts, sorted by build number", () => {
    const macExe = join(
      cache,
      "chromium-1300",
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
    );
    mkdirSync(macExe, { recursive: true });
    writeFileSync(join(macExe, "Google Chrome for Testing"), "");

    const linuxExe = join(cache, "chromium-999", "chrome-linux");
    mkdirSync(linuxExe, { recursive: true });
    writeFileSync(join(linuxExe, "chrome"), "");

    // No executable inside: must be filtered out, not returned with a bad path.
    mkdirSync(join(cache, "chromium-1400"), { recursive: true });
    // Non-Chromium entries are ignored entirely.
    mkdirSync(join(cache, "firefox-1497"), { recursive: true });
    mkdirSync(join(cache, "chromium_headless_shell-1300"), { recursive: true });

    const builds = cachedChromiumBuilds(cache);
    expect(builds.map((b) => b.build)).toEqual(["chromium-999", "chromium-1300"]);
    expect(builds[0].exe.endsWith("chrome-linux/chrome")).toBe(true);
    expect(builds[1].exe.endsWith("MacOS/Google Chrome for Testing")).toBe(true);
  });
});
