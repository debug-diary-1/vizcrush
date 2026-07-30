/**
 * Simple canvas-based line chart renderer using the Canvas 2D API.
 * Handles device-pixel-ratio scaling and draws min/max y-axis labels.
 */
export function renderLineChart(
  canvas: HTMLCanvasElement,
  x: Float64Array,
  y: Float64Array,
  color: string,
): void {
  if (x.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const padLeft = 70;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 10;

  // Determine y range
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < y.length; i++) {
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
  }
  const rangeY = maxY - minY || 1;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Draw y-axis labels (min and max)
  ctx.fillStyle = "#888";
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(formatNumber(maxY), 4, padTop);
  ctx.textBaseline = "bottom";
  ctx.fillText(formatNumber(minY), 4, h - padBottom);

  // Draw the line
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.beginPath();

  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;
  const len = x.length;

  for (let i = 0; i < len; i++) {
    const px = padLeft + (i / (len - 1)) * plotW;
    const py = h - padBottom - ((y[i] - minY) / rangeY) * plotH;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000) {
    return n.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    });
  }
  return n.toFixed(2);
}
