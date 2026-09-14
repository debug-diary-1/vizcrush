import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const examplesUrl = "https://debug-diary-1.github.io/vizcrush/examples/";

describe("cross-app documentation links", () => {
  test("the hero and navigation leave the VitePress router for the examples app", () => {
    const home = readFileSync(new URL("../docs/index.md", import.meta.url), "utf8");
    const config = readFileSync(new URL("../docs/.vitepress/config.mts", import.meta.url), "utf8");

    expect(home).toContain(`link: ${examplesUrl}\n      target: _self`);
    expect(config).toContain(`link: "${examplesUrl}"`);
    expect(config).toContain('target: "_self"');
    expect(home).not.toMatch(/^\s+link: \/examples\/$/m);
    expect(config).not.toContain('link: "/examples/"');
  });
});
