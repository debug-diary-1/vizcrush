/**
 * Renders a 2D density grid to a canvas element using a configurable color scale
 * and gamma correction.
 */

const GAMMA = 0.4;

/**
 * Draw the density grid onto a canvas.
 *
 * @param canvas   - Target canvas element
 * @param grid     - Flat row-major density grid (yBins * xBins)
 * @param xBins    - Number of horizontal bins
 * @param yBins    - Number of vertical bins
 * @param maxCount - Maximum count in any bin (used for normalization)
 * @param colorScale - Function mapping a [0,1] intensity to an RGB CSS string
 */
export function renderHeatmap(
  canvas: HTMLCanvasElement,
  grid: Uint32Array,
  xBins: number,
  yBins: number,
  maxCount: number,
  colorScale: (t: number) => string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D rendering context from canvas");
  }

  const cellW = canvas.width / xBins;
  const cellH = canvas.height / yBins;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let yi = 0; yi < yBins; yi++) {
    for (let xi = 0; xi < xBins; xi++) {
      const count = grid[yi * xBins + xi];
      if (count === 0) continue;

      // Gamma correction to boost visibility of low-density cells
      const intensity = Math.pow(count / maxCount, GAMMA);
      ctx.fillStyle = colorScale(intensity);
      // Slight overlap (+0.5) to avoid sub-pixel gaps between cells
      ctx.fillRect(xi * cellW, (yBins - 1 - yi) * cellH, cellW + 0.5, cellH + 0.5);
    }
  }
}
