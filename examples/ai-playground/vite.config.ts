import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: { exclude: ["@vizcrush/core", "@vizcrush/ai", "@vizcrush/downsample"] },
});
