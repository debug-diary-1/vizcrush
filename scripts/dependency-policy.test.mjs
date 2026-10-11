import { describe, expect, test } from "vitest";
import {
  dependabotUsesNpm,
  findNonFrozenPnpmInstalls,
  findToolchainPinMismatch,
  findUnpinnedActionUses,
  findUnpinnedCargoInstalls,
} from "./dependency-policy.mjs";

describe("dependency policy", () => {
  test.each([
    "package-ecosystem: npm",
    'package-ecosystem: "npm"',
    "package-ecosystem: 'npm' # catalog lockfiles are incompatible",
  ])("recognizes npm Dependabot ecosystems: %s", (source) => {
    expect(dependabotUsesNpm(source)).toBe(true);
  });

  test("does not confuse other ecosystems with npm", () => {
    expect(dependabotUsesNpm("package-ecosystem: github-actions")).toBe(false);
  });

  test("finds bare, argument-bearing, and chained non-frozen installs", () => {
    const source = [
      "run: pnpm install",
      "run: pnpm install --prefer-offline",
      "run: pnpm install --frozen-lockfile && pnpm install --offline",
    ].join("\n");

    expect(findNonFrozenPnpmInstalls(source)).toEqual([1, 2, 3]);
  });

  test("accepts frozen installs with other arguments and shell commands", () => {
    const source = [
      "run: pnpm install --prefer-offline --frozen-lockfile",
      "run: pnpm install --frozen-lockfile && pnpm build",
    ].join("\n");

    expect(findNonFrozenPnpmInstalls(source)).toEqual([]);
  });

  test("does not accept a frozen-lockfile flag that appears only in a comment", () => {
    expect(findNonFrozenPnpmInstalls("run: pnpm install # --frozen-lockfile")).toEqual([1]);
  });

  test("checks installs separated by a single background operator", () => {
    expect(
      findNonFrozenPnpmInstalls(
        "run: pnpm install --frozen-lockfile & pnpm install --prefer-offline",
      ),
    ).toEqual([1]);
  });

  test("requires CI cargo installs to pin a version and use the crate lockfile", () => {
    const source = [
      "run: cargo install cargo-audit --quiet",
      "run: cargo install cargo-audit --version 0.22.2",
      "run: cargo install cargo-audit --version 0.22.2 --locked",
    ].join("\n");

    expect(findUnpinnedCargoInstalls(source)).toEqual([1, 2]);
  });

  test.each([
    "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    "- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    "uses: dtolnay/rust-toolchain@6bed0761d98439e5a578e2877258200ad565ba87 # stable",
    "uses: owner/repo/path/to/action@6bed0761d98439e5a578e2877258200ad565ba87 # v1.0.0",
    "uses: ./local/path",
    "uses: docker://alpine@sha256:9d36088643581e728c969f35141f88139fec77280b2be23c1f66f8e40e1025e7",
  ])("accepts pinned and allowed action uses forms: %s", (source) => {
    expect(findUnpinnedActionUses(source)).toEqual([]);
  });

  test.each([
    "uses: actions/checkout@v7",
    "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "uses: actions/checkout@3d3c42 # v7.0.1",
    "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 #",
    "uses: docker://alpine:latest",
    "uses: docker://alpine@sha256:9d36088",
  ])("flags unpinned or uncommented action uses forms: %s", (source) => {
    expect(findUnpinnedActionUses(source)).toEqual([1]);
  });

  test("finds unpinned action uses by line number across a workflow", () => {
    const source = [
      "jobs:",
      "  build:",
      "    steps:",
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
      "      - uses: actions/setup-node@v4",
    ].join("\n");

    expect(findUnpinnedActionUses(source)).toEqual([5]);
  });

  test.each([
    ["double-quoted, no comment", '[tools]\npnpm = "12.3.4"\n'],
    ["double-quoted with trailing comment", '[tools]\npnpm = "12.3.4" # keep in sync\n'],
    ["single-quoted", "[tools]\npnpm = '12.3.4'\n"],
  ])("accepts matching pnpm pins in mise.toml and package.json (%s)", (_label, miseToml) => {
    expect(findToolchainPinMismatch(miseToml, '{"packageManager": "pnpm@12.3.4"}')).toBeNull();
  });

  test("reports mismatched pnpm pins between mise.toml and package.json", () => {
    expect(
      findToolchainPinMismatch('[tools]\npnpm = "12.3.4"\n', '{"packageManager": "pnpm@12.3.0"}'),
    ).toBe("mise.toml pins pnpm 12.3.4 but package.json's packageManager pins pnpm 12.3.0");
  });

  test("reports a mismatch even when the mise.toml pin has a trailing comment", () => {
    expect(
      findToolchainPinMismatch(
        '[tools]\npnpm = "12.3.4" # keep in sync\n',
        '{"packageManager": "pnpm@11.0.0"}',
      ),
    ).toBe("mise.toml pins pnpm 12.3.4 but package.json's packageManager pins pnpm 11.0.0");
  });

  test("fails closed when mise.toml has no parseable pnpm pin", () => {
    expect(
      findToolchainPinMismatch('[tools]\nnode = "24.21.0"\n', '{"packageManager": "pnpm@12.3.4"}'),
    ).toBe("mise.toml does not pin a parseable pnpm version");
  });

  test("fails closed when package.json has no parseable packageManager pin", () => {
    expect(findToolchainPinMismatch('[tools]\npnpm = "12.3.4"\n', '{"name": "vizcrush"}')).toBe(
      "package.json does not pin a parseable pnpm packageManager version",
    );
  });
});
