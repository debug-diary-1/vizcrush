import { init } from "@vizcrush/core";
import { lttb } from "@vizcrush/downsample";

self.onmessage = async (
  event: MessageEvent<{ x: ArrayBuffer; y: ArrayBuffer; threshold: number }>,
) => {
  try {
    const x = new Float64Array(event.data.x);
    const y = new Float64Array(event.data.y);
    const context = await init();
    const started = performance.now();
    const reduced = await lttb(x, y, event.data.threshold);
    const elapsed = performance.now() - started;

    self.postMessage(
      { x: reduced.x.buffer, y: reduced.y.buffer, backend: context.backend, elapsed },
      { transfer: [reduced.x.buffer, reduced.y.buffer] },
    );
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
