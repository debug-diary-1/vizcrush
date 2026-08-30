import { describe, expect, test } from "vitest";
import { createPackedFixturePackageJson } from "./packed-browser-harness.mjs";

describe("packed browser fixture", () => {
  test("overrides transitive core resolution with the packed core tarball", () => {
    const manifest = createPackedFixturePackageJson("/packs/core.tgz", "/packs/downsample.tgz");

    expect(manifest.dependencies).toEqual({
      "@vizcrush/core": "file:/packs/core.tgz",
      "@vizcrush/downsample": "file:/packs/downsample.tgz",
    });
    expect(manifest.pnpm.overrides).toEqual({
      "@vizcrush/core": "file:/packs/core.tgz",
    });
  });
});
