/**
 * Renders a streaming line chart on a canvas element.
 *
 * Uses requestAnimationFrame internally to avoid redundant repaints when
 * called more frequently than the display refresh rate.
 */

let rafId: number | null = null;

export function renderStreamChart(
  canvas: HTMLCanvasElement,
  values: number[],
  maxPoints: number,
): void {
  // Coalesce rapid calls into a single frame.
  if (rafId !== null) return;

  rafId = requestAnimationFrame(() => {
    rafId = null;
    draw(canvas, values, maxPoints);
  });
}

function draw(canvas: HTMLCanvasElement, values: number[], maxPoints: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const slice = values.length > maxPoints ? values.slice(-maxPoints) : values;
  const n = slice.length;
  if (n < 2) return;

  let min = Infinity;
  let max = -Infinity;
  for (const v of slice) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const padding = 20;

  ctx.strokeStyle = "#3b9ecf";
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = padding + (i / (n - 1)) * (w - 2 * padding);
    const y = h - padding - ((slice[i] - min) / range) * (h - 2 * padding);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
