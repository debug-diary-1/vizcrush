import "./styles.css";

const POINT_COUNT = 2_000_000;
const OUTPUT_COUNT = 2_000;
const button = document.querySelector<HTMLButtonElement>("#run")!;
const canvas = document.querySelector<HTMLCanvasElement>("#chart")!;
const status = document.querySelector<HTMLElement>("#status")!;
const fields = {
  backend: document.querySelector<HTMLElement>("#backend")!,
  compute: document.querySelector<HTMLElement>("#compute")!,
  roundtrip: document.querySelector<HTMLElement>("#roundtrip")!,
  frameGap: document.querySelector<HTMLElement>("#frame-gap")!,
  detached: document.querySelector<HTMLElement>("#detached")!,
};

function makeSeries(): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(POINT_COUNT);
  const y = new Float64Array(POINT_COUNT);
  let state = 7;
  for (let i = 0; i < POINT_COUNT; i += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    x[i] = i;
    y[i] = Math.sin(i / 7_000) * 16 + Math.sin(i / 311) * 2 + (state / 4_294_967_296 - 0.5);
  }
  return { x, y };
}

function draw(x: Float64Array, y: Float64Array): void {
  const context = canvas.getContext("2d")!;
  const width = canvas.width;
  const height = canvas.height;
  if (x.length === 0 || y.length === 0) return;

  const xMin = x[0];
  const xSpan = x[x.length - 1] - xMin;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#071412";
  context.fillRect(0, 0, width, height);
  let min = Infinity;
  let max = -Infinity;
  for (const value of y) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  context.strokeStyle = "#55d6be";
  context.lineWidth = 2;
  context.beginPath();
  for (let i = 0; i < x.length; i += 1) {
    const px = xSpan === 0 ? width / 2 : ((x[i] - xMin) / xSpan) * width;
    const py = max === min ? height / 2 : height - ((y[i] - min) / (max - min)) * height;
    if (i === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.stroke();
}

button.addEventListener("click", () => {
  button.disabled = true;
  status.textContent = "Generating input on the main thread (not timed)…";
  requestAnimationFrame(() => {
    const { x, y } = makeSeries();
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let largestFrameGap = 0;
    let previousFrame = performance.now();
    let frameRequest = 0;
    const trackFrames = (now: number) => {
      largestFrameGap = Math.max(largestFrameGap, now - previousFrame);
      previousFrame = now;
      frameRequest = requestAnimationFrame(trackFrames);
    };
    frameRequest = requestAnimationFrame(trackFrames);
    const started = performance.now();
    worker.postMessage({ x: x.buffer, y: y.buffer, threshold: OUTPUT_COUNT }, [x.buffer, y.buffer]);
    fields.detached.textContent = `${x.byteLength + y.byteLength} bytes`;
    status.textContent =
      "Worker is warming and processing; input buffers are now detached on the main thread.";

    worker.onmessage = (
      event: MessageEvent<{
        x?: ArrayBuffer;
        y?: ArrayBuffer;
        backend?: string;
        elapsed?: number;
        error?: string;
      }>,
    ) => {
      cancelAnimationFrame(frameRequest);
      const roundtrip = performance.now() - started;
      if (event.data.error || !event.data.x || !event.data.y) {
        status.textContent = `Worker error: ${event.data.error ?? "missing result"}`;
      } else {
        const outputX = new Float64Array(event.data.x);
        const outputY = new Float64Array(event.data.y);
        draw(outputX, outputY);
        fields.backend.textContent = event.data.backend ?? "—";
        fields.compute.textContent = `${event.data.elapsed?.toFixed(1) ?? "—"} ms`;
        fields.roundtrip.textContent = `${roundtrip.toFixed(1)} ms`;
        fields.frameGap.textContent = `${largestFrameGap.toFixed(1)} ms`;
        status.textContent = `${outputX.length.toLocaleString()} points returned. Compute excludes one real-input warm-up; round trip includes it. Frame gap is observed during this run, not a responsiveness guarantee.`;
      }
      worker.terminate();
      button.disabled = false;
    };

    worker.onerror = (event) => {
      cancelAnimationFrame(frameRequest);
      status.textContent = `Worker error: ${event.message}`;
      worker.terminate();
      button.disabled = false;
    };
  });
});
