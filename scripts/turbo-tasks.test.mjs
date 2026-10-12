import { describe, expect, test } from "vitest";
import { findInvokedTurboTasks, findMissingTurboTasks } from "./turbo-tasks.mjs";

describe("turbo task policy", () => {
  test("finds tasks behind pnpm, bare turbo, and turbo run", () => {
    expect(
      findInvokedTurboTasks({
        test: "pnpm turbo test",
        build: "turbo build",
        typecheck: "turbo run typecheck",
      }),
    ).toEqual([
      { script: "test", task: "test" },
      { script: "build", task: "build" },
      { script: "typecheck", task: "typecheck" },
    ]);
  });

  test("finds a turbo task in each segment of a chained script", () => {
    expect(findInvokedTurboTasks({ build: "pnpm build:wasm && pnpm turbo build" })).toEqual([
      { script: "build", task: "build" },
    ]);
  });

  test("ignores scripts that never reach turbo", () => {
    expect(findInvokedTurboTasks({ lint: "oxlint --deny-warnings" })).toEqual([]);
  });

  test("reports the regression this check exists for", () => {
    // package.json said `pnpm turbo test`; turbo.json defined no `test` task.
    expect(
      findMissingTurboTasks({ test: "pnpm turbo test" }, ["build", "typecheck", "dev"]),
    ).toEqual([{ script: "test", task: "test" }]);
  });

  test("passes when every invoked task is defined", () => {
    expect(findMissingTurboTasks({ build: "pnpm turbo build" }, ["build"])).toEqual([]);
  });
});
