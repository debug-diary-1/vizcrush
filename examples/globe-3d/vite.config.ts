import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@vizcrush/core", "@vizcrush/spatial3d", "@vizcrush/bin3d"],
  },
});
