import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: {
    exclude: ["@vizcrush/core", "@vizcrush/aggregate", "@vizcrush/transform", "@vizcrush/spatial"],
  },
});
