/**
 * The smallest app that exercises the WASM path.
 *
 * It only has to *reference* the kernel: the assertion is about what the
 * bundler emits, not about what this code prints. `withBackend` is used rather
 * than the plain `lttb` because it reports the path that actually ran, which is
 * the distinction the regression is about.
 */
import { downsampleKernels } from "@vizcrush/downsample";

const x = Float64Array.from({ length: 4096 }, (_, i) => i);
const y = Float64Array.from({ length: 4096 }, (_, i) => Math.sin(i / 32));

const { backend } = await downsampleKernels.lttb.withBackend(x, y, 256, {
  backend: "wasm",
});

document.body.textContent = `backend: ${backend}`;
