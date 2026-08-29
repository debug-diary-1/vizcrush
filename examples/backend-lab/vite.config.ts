import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // The packages load their wasm-bindgen glue through a runtime specifier,
    // which Vite's prebundler cannot follow. Excluding them keeps the real
    // dispatch path intact instead of silently serving a JS-only build.
    exclude: ["@vizcrush/core", "@vizcrush/downsample"],
  },
});
