/**
 * Renders a heatmap visualisation of bin2d output onto a canvas.
 *
 * Each cell in the `grid` (row-major, xBins * yBins) maps to a colour
 * intensity proportional to its count relative to `maxCount`.
 */
export function renderScatterDensity(
  container: HTMLElement,
  grid: Uint32Array,
  xBins: number,
  yBins: number,
  maxCount: number,
): void {
  let canvas = container.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "400px";
    container.appendChild(canvas);
  }

  canvas.width = xBins;
  canvas.height = yBins;

  // Use nearest-neighbour scaling for crisp bins
  canvas.style.imageRendering = "pixelated";

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const imageData = ctx.createImageData(xBins, yBins);
  const data = imageData.data;

  for (let row = 0; row < yBins; row++) {
    for (let col = 0; col < xBins; col++) {
      const count = grid[row * xBins + col];
      const t = maxCount > 0 ? count / maxCount : 0;

      // Viridis-inspired colour ramp (dark purple -> teal -> yellow)
      const r = Math.round(lerp(13, 253, t));
      const g = Math.round(lerp(8, 231, t));
      const b = Math.round(lerp(135, 37, t));
      const a = count === 0 ? 0 : 255;

      const idx = (row * xBins + col) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
