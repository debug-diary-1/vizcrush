import { describe, expect, test } from "vitest";
import {
  createPackedFixturePackageJson,
  createPackedFixtureWorkspaceYaml,
} from "./packed-browser-harness.mjs";

describe("packed browser fixture", () => {
  test("overrides transitive core resolution with the packed core tarball", () => {
    const manifest = createPackedFixturePackageJson("/packs/core.tgz", "/packs/downsample.tgz");

    expect(manifest.dependencies).toEqual({
      "@vizcrush/core": "file:/packs/core.tgz",
      "@vizcrush/downsample": "file:/packs/downsample.tgz",
    });
    expect(manifest).not.toHaveProperty("pnpm");
  });

  test("pins the transitive core in the fixture workspace file", () => {
    expect(createPackedFixtureWorkspaceYaml("/packs/core.tgz")).toBe(
      'overrides:\n  "@vizcrush/core": "file:/packs/core.tgz"\n',
    );
  });
});
