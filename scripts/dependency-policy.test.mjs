import { describe, expect, test } from "vitest";
import { dependabotUsesNpm, findNonFrozenPnpmInstalls } from "./dependency-policy.mjs";

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
});
