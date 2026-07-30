import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: {
    exclude: [
      "@vizcrush/core",
      "@vizcrush/aggregate",
      "@vizcrush/bin",
      "@vizcrush/spatial",
      "@vizcrush/spatial3d",
    ],
  },
});
