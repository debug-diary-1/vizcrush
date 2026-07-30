import { lttbCore, minMaxLttbCore, m4Core, downsampleKernels } from "@vizcrush/downsample";
import type { DownsampleInputType, AutoDownsampleInputType } from "../schemas.js";

export async function handleLttb(input: DownsampleInputType) {
  const x = new Float64Array(input.x);
  const y = new Float64Array(input.y);
  const start = performance.now();
  // Dispatches through the real kernel (WASM above the size threshold, JS
  // below it) instead of always running the JS core, so `input.backend` is
  // honoured and `backend_used` reports what actually ran.
  const { result, backend } = await downsampleKernels.lttb.withBackend(x, y, input.target_points, {
    backend: input.backend,
  });
  const elapsed = performance.now() - start;

  return {
    x: Array.from(result.x),
    y: Array.from(result.y),
    original_length: input.x.length,
    output_length: result.x.length,
    algorithm: "lttb",
    backend_used: backend,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

export async function handleMinMaxLttb(input: DownsampleInputType) {
  const x = new Float64Array(input.x);
  const y = new Float64Array(input.y);
  const start = performance.now();
  const { result, backend } = await downsampleKernels.minMaxLttb.withBackend(
    x,
    y,
    input.target_points,
    { backend: input.backend },
  );
  const elapsed = performance.now() - start;

  return {
    x: Array.from(result.x),
    y: Array.from(result.y),
    original_length: input.x.length,
    output_length: result.x.length,
    algorithm: "minmax_lttb",
    backend_used: backend,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

// AutoDownsampleInput carries no `backend` field — it always runs the JS core.
// That's an honest default (ADR 0001: wasm ≈ js in Node for these algorithms),
// not a broken promise, since nothing here claims otherwise.
export function handleAutoDownsample(input: AutoDownsampleInputType) {
  const hint = input.data_hint ?? "time_series";
  let algorithm: string;
  let core: typeof lttbCore;

  switch (hint) {
    case "financial":
    case "sensor":
      algorithm = "minmax_lttb";
      core = minMaxLttbCore;
      break;
    case "scatter":
      algorithm = "m4";
      core = m4Core;
      break;
    default:
      algorithm = "lttb";
      core = lttbCore;
  }

  const x = new Float64Array(input.x);
  const y = new Float64Array(input.y);
  const start = performance.now();
  const result = core(x, y, input.target_points);
  const elapsed = performance.now() - start;

  return {
    x: Array.from(result.x),
    y: Array.from(result.y),
    original_length: input.x.length,
    output_length: result.x.length,
    algorithm,
    backend_used: "js",
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}
