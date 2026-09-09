import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    // deck.gl 9.4 can omit its WebGPU branches and WGSL sources when an app
    // intentionally targets WebGL2, reducing this example's shipped bundle.
    conditions: ["visgl:webgl-only"],
  },
  optimizeDeps: {
    exclude: ["@vizcrush/bin", "@vizcrush/core"],
  },
});
