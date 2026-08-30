import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  cachedChromiumBuilds,
  defaultCacheDir,
  filterBuilds,
  parseSessions,
  sessionPlan,
} from "./run-versions.mjs";

describe("defaultCacheDir", () => {
  it("prefers PLAYWRIGHT_BROWSERS_PATH on every platform", () => {
    for (const platform of ["darwin", "linux", "win32"]) {
      expect(defaultCacheDir({ platform, env: { PLAYWRIGHT_BROWSERS_PATH: "/pw" } })).toBe("/pw");
    }
  });

  it("uses each platform's Playwright cache location", () => {
    expect(defaultCacheDir({ platform: "darwin", env: {} })).toMatch(
      /Library\/Caches\/ms-playwright$/u,
    );
    expect(defaultCacheDir({ platform: "linux", env: {} })).toMatch(/\.cache\/ms-playwright$/u);
    expect(defaultCacheDir({ platform: "linux", env: { XDG_CACHE_HOME: "/xdg" } })).toBe(
      "/xdg/ms-playwright",
    );
    expect(defaultCacheDir({ platform: "win32", env: { LOCALAPPDATA: "C:/lad" } })).toBe(
      "C:/lad/ms-playwright",
    );
  });
});

describe("filterBuilds", () => {
  const builds = [{ build: "chromium-1200" }, { build: "chromium-1234" }];

  it("passes everything through when no allowlist is set", () => {
    expect(filterBuilds(builds, undefined)).toEqual(builds);
    expect(filterBuilds(builds, "")).toEqual(builds);
  });

  it("keeps only the named builds, preserving discovery order", () => {
    expect(filterBuilds(builds, "chromium-1234")).toEqual([{ build: "chromium-1234" }]);
    expect(filterBuilds(builds, " chromium-1234 , chromium-1200 ")).toEqual(builds);
  });

  it("throws when the allowlist names a build the cache does not hold", () => {
    expect(() => filterBuilds(builds, "chromium-1200,chromium-9999")).toThrow(/chromium-9999/u);
  });
});

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
