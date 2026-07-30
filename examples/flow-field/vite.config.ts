import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: {
    exclude: [
      "@vizcrush/core",
      "@vizcrush/bin",
      "@vizcrush/aggregate",
      "@vizcrush/downsample",
      "@vizcrush/spatial",
      "@vizcrush/spatial3d",
    ],
  },
});
