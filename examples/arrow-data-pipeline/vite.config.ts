import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@vizcrush/aggregate", "@vizcrush/core", "@vizcrush/downsample"],
  },
});
