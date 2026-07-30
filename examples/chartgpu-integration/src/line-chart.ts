/**
 * Renders a line chart into a container using Canvas 2D.
 *
 * This is a placeholder for a ChartGPU-accelerated renderer. In a real
 * integration the Canvas 2D drawing below would be replaced with:
 *
 *   const chart = await ChartGPU.create(container, { type: 'line' });
 *   chart.setData({ x, y });
 *   chart.render();
 *
 * The preprocessing (LTTB downsampling, etc.) that feeds x/y remains the same.
 */
export function renderLineChart(container: HTMLElement, x: Float64Array, y: Float64Array): void {
  let canvas = container.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "400px";
    container.appendChild(canvas);
  }

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const padding = 30;

  // Compute bounds
  let xMin = Infinity,
    xMax = -Infinity;
  let yMin = Infinity,
    yMax = -Infinity;
  for (let i = 0; i < x.length; i++) {
    if (x[i] < xMin) xMin = x[i];
    if (x[i] > xMax) xMax = x[i];
    if (y[i] < yMin) yMin = y[i];
    if (y[i] > yMax) yMax = y[i];
  }
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#3b9ecf";
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.beginPath();

  for (let i = 0; i < x.length; i++) {
    const px = padding + ((x[i] - xMin) / xRange) * (w - 2 * padding);
    const py = h - padding - ((y[i] - yMin) / yRange) * (h - 2 * padding);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }

  ctx.stroke();
}
