import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `test/` holds repo-level integration tests that cannot live inside a
    // package: the bundler guard has to build a real app against the published
    // shape of the workspace, not import it as a module.
    include: ["packages/*/src/**/*.test.ts", "test/**/*.test.ts"],
    globals: true,
    testTimeout: 30000,
  },
});
