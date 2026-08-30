import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@vizcrush/bin", "@vizcrush/core"],
  },
});
