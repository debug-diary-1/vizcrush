import { describe, expect, test } from "vitest";
import { isDocumentationOnlyChange, isDocumentationOnlyPath } from "./ci-change-scope.mjs";

describe("CI change scope", () => {
  test.each([
    "README.md",
    "packages/core/README.md",
    "docs/index.md",
    "docs/.vitepress/config.mts",
    "LICENSE",
  ])("treats %s as documentation-only", (path) => {
    expect(isDocumentationOnlyPath(path)).toBe(true);
  });

  test.each(["src/index.ts", "examples/demo/index.html", "documentation/index.ts", "LICENSE.txt"])(
    "treats %s as code-affecting",
    (path) => {
      expect(isDocumentationOnlyPath(path)).toBe(false);
    },
  );

  test("requires every changed path to be documentation-only", () => {
    expect(isDocumentationOnlyChange(["README.md", "docs/index.md"])).toBe(true);
    expect(isDocumentationOnlyChange(["README.md", "packages/core/src/index.ts"])).toBe(false);
    expect(isDocumentationOnlyChange([])).toBe(false);
  });
});
