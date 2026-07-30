/**
 * Generates clustered scatter data simulating gene expression profiles.
 *
 * Produces 8 clusters arranged in a 4x2 grid, each with Gaussian-like
 * spread (approximated with additive uniform noise).
 */
export function generateGenomicsData(n: number): {
  x: Float64Array;
  y: Float64Array;
} {
  const x = new Float64Array(n);
  const y = new Float64Array(n);

  // 8 cluster centres on a 4-column x 2-row grid
  const clusterCentres = [
    { cx: 125, cy: 150 },
    { cx: 375, cy: 150 },
    { cx: 625, cy: 150 },
    { cx: 875, cy: 150 },
    { cx: 125, cy: 450 },
    { cx: 375, cy: 450 },
    { cx: 625, cy: 450 },
    { cx: 875, cy: 450 },
  ];

  for (let i = 0; i < n; i++) {
    const cluster = clusterCentres[Math.floor(Math.random() * 8)];
    x[i] = cluster.cx + (Math.random() - 0.5) * 200 + Math.random() * 50;
    y[i] = cluster.cy + (Math.random() - 0.5) * 200 + Math.random() * 50;
  }

  return { x, y };
}
