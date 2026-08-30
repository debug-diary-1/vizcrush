import { defineConfig } from "vite";

export default defineConfig({
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@vizcrush/core", "@vizcrush/downsample"],
  },
});
