import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: {
    exclude: ["@vizcrush/core", "@vizcrush/bin", "@vizcrush/aggregate", "@vizcrush/spatial"],
  },
});
