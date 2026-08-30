import { stats } from "@vizcrush/aggregate";
import { init } from "@vizcrush/core";
import { lttb } from "@vizcrush/downsample";
import { tableFromArrays, tableFromIPC, tableToIPC } from "apache-arrow";
import "./styles.css";

const ROW_COUNT = 250_000;
const canvas = document.querySelector<HTMLCanvasElement>("#chart")!;
const status = document.querySelector<HTMLElement>("#status")!;
const fields = Object.fromEntries(
  ["rows", "bytes", "columns", "decode", "backend", "pipeline", "output", "summary"].map((id) => [
    id,
    document.querySelector<HTMLElement>(`#${id}`)!,
  ]),
);

function createPayload(): Uint8Array {
  const sample = new Float64Array(ROW_COUNT);
  const value = new Float64Array(ROW_COUNT);
  for (let i = 0; i < ROW_COUNT; i += 1) {
    sample[i] = i;
    value[i] = 30 + Math.sin(i / 2_700) * 12 + Math.sin(i / 83) * 1.5;
  }
  return tableToIPC(tableFromArrays({ sample, value }), "stream");
}

function draw(x: Float64Array, y: Float64Array): void {
  const context = canvas.getContext("2d")!;
  const width = canvas.width;
  const height = canvas.height;
  const min = Math.min(...y);
  const max = Math.max(...y);
  context.fillStyle = "#081418";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#f5bd4f";
  context.lineWidth = 2;
  context.beginPath();
  for (let i = 0; i < x.length; i += 1) {
    const px = (i / (x.length - 1)) * width;
    const py = height - 16 - ((y[i] - min) / (max - min)) * (height - 32);
    if (i === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.stroke();
}

async function run(): Promise<void> {
  const payload = createPayload();
  const decodeStarted = performance.now();
  const table = tableFromIPC(payload);
  const xColumn = table.getChild("sample");
  const yColumn = table.getChild("value");
  if (!xColumn || !yColumn) throw new Error("Arrow payload is missing expected columns");
  const x = xColumn.toArray() as Float64Array;
  const y = yColumn.toArray() as Float64Array;
  const decodeElapsed = performance.now() - decodeStarted;
  const context = await init();
  status.textContent = "Warming the downsample and aggregate kernels on the decoded columns…";
  await Promise.all([lttb(x, y, 1_600), stats(y)]);
  const pipelineStarted = performance.now();
  const [reduced, summary] = await Promise.all([lttb(x, y, 1_600), stats(y)]);
  const pipelineElapsed = performance.now() - pipelineStarted;
  draw(reduced.x, reduced.y);

  fields.rows.textContent = table.numRows.toLocaleString();
  fields.bytes.textContent = `${(payload.byteLength / 1_024).toFixed(1)} KiB`;
  fields.columns.textContent = `${x.constructor.name} + ${y.constructor.name}`;
  fields.decode.textContent = `${decodeElapsed.toFixed(1)} ms`;
  fields.backend.textContent = context.backend;
  fields.pipeline.textContent = `${pipelineElapsed.toFixed(1)} ms`;
  fields.output.textContent = reduced.x.length.toLocaleString();
  fields.summary.textContent = `${summary.mean.toFixed(2)} ± ${summary.stdDev.toFixed(2)}`;
  status.textContent =
    "All values are local measurements. The vizcrush pipeline excludes one untimed real-input warm-up; the generated IPC payload has no network dependency.";
}

void run().catch((error) => {
  status.textContent = `Pipeline failed: ${error instanceof Error ? error.message : String(error)}`;
});
