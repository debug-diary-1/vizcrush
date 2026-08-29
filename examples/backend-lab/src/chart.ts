/**
 * Canvas line chart.
 *
 * Deliberately plain: no library, no animation, one path. The demo is about
 * what the downsampler returns, so the renderer should not be doing anything
 * clever enough to become part of the measurement. Rendering is always driven
 * explicitly by the caller and never from a rAF loop, because a loop running
 * during timing is exactly the contamination this example exists to avoid.
 */

const PAD = { top: 16, right: 16, bottom: 28, left: 68 };

export interface ChartTheme {
  line: string;
  axis: string;
  text: string;
  grid: string;
}

export const THEME: ChartTheme = {
  line: "#6ea8fe",
  axis: "#3a3a3a",
  text: "#8a8580",
  grid: "#1e1e1e",
};

function niceExtent(values: Float64Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * 0.06;
  return [min - pad, max + pad];
}

export function renderChart(canvas: HTMLCanvasElement, x: Float64Array, y: Float64Array): void {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  if (x.length === 0) return;

  const plotW = cssWidth - PAD.left - PAD.right;
  const plotH = cssHeight - PAD.top - PAD.bottom;

  const [yMin, yMax] = niceExtent(y);
  const xMin = x[0]!;
  const xMax = x[x.length - 1]!;
  const xSpan = xMax - xMin || 1;

  const px = (v: number) => PAD.left + ((v - xMin) / xSpan) * plotW;
  const py = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Horizontal gridlines with value labels.
  ctx.strokeStyle = THEME.grid;
  ctx.fillStyle = THEME.text;
  ctx.lineWidth = 1;
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const TICKS = 5;
  for (let i = 0; i <= TICKS; i++) {
    const value = yMin + ((yMax - yMin) * i) / TICKS;
    const yPos = py(value);
    ctx.beginPath();
    ctx.moveTo(PAD.left, yPos);
    ctx.lineTo(PAD.left + plotW, yPos);
    ctx.stroke();
    ctx.fillText(value.toFixed(1), PAD.left - 10, yPos);
  }

  // Axis line.
  ctx.strokeStyle = THEME.axis;
  ctx.beginPath();
  ctx.moveTo(PAD.left, PAD.top);
  ctx.lineTo(PAD.left, PAD.top + plotH);
  ctx.stroke();

  // The series itself.
  ctx.strokeStyle = THEME.line;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(px(x[0]!), py(y[0]!));
  for (let i = 1; i < x.length; i++) ctx.lineTo(px(x[i]!), py(y[i]!));
  ctx.stroke();

  // Time range labels.
  ctx.fillStyle = THEME.text;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(new Date(xMin).toISOString().slice(0, 10), PAD.left, PAD.top + plotH + 8);
  ctx.textAlign = "right";
  ctx.fillText(new Date(xMax).toISOString().slice(0, 10), PAD.left + plotW, PAD.top + plotH + 8);
}
