import type { KernelExecution } from "@vizcrush/core";

/** Times one kernel execution and exposes only truthful execution metadata. */
export async function timedKernelExecution<T>(
  execute: () => Promise<KernelExecution<T>>,
): Promise<KernelExecution<T> & { backend_used: "js" | "wasm"; elapsed_ms: number }> {
  const started = performance.now();
  const execution = await execute();
  return {
    ...execution,
    backend_used: execution.backend,
    elapsed_ms: Math.round((performance.now() - started) * 100) / 100,
  };
}
