import type { KernelBackend } from "@vizcrush/core";
import { downsampleKernels } from "@vizcrush/downsample";

self.onmessage = async (
  event: MessageEvent<{
    x: ArrayBuffer;
    y: ArrayBuffer;
    threshold: number;
    backend: KernelBackend;
  }>,
) => {
  try {
    const x = new Float64Array(event.data.x);
    const y = new Float64Array(event.data.y);
    const options = { backend: event.data.backend } as const;
    await downsampleKernels.lttb.withBackend(x, y, event.data.threshold, options);
    const started = performance.now();
    const execution = await downsampleKernels.lttb.withBackend(x, y, event.data.threshold, options);
    const elapsed = performance.now() - started;

    self.postMessage(
      {
        x: execution.result.x.buffer,
        y: execution.result.y.buffer,
        requestedBackend: execution.requestedBackend,
        backend: execution.backend,
        reason: execution.reason,
        elapsed,
      },
      { transfer: [execution.result.x.buffer, execution.result.y.buffer] },
    );
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
