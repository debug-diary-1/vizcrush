/**
 * Generate a clustered 3D point cloud with color information.
 *
 * 8 cluster centres are placed at the corners of a cube [-70, 70]^3.
 * Each cluster has Gaussian-distributed points (radius ~30).
 * ~5% of points are inter-cluster noise spread across [-100, 100]^3.
 * Each cluster gets a distinct color for visual differentiation.
 */
export function generatePointCloud(n: number): {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
} {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);

  // 8 cluster centres at cube corners, each with a distinct color
  const centres: { pos: [number, number, number]; color: [number, number, number] }[] = [
    { pos: [-70, -70, -70], color: [0.35, 0.55, 1.0] }, // blue
    { pos: [-70, -70, 70], color: [0.4, 0.9, 0.5] }, // green
    { pos: [-70, 70, -70], color: [1.0, 0.45, 0.35] }, // red
    { pos: [-70, 70, 70], color: [1.0, 0.75, 0.2] }, // orange
    { pos: [70, -70, -70], color: [0.8, 0.4, 1.0] }, // purple
    { pos: [70, -70, 70], color: [0.2, 0.9, 0.9] }, // cyan
    { pos: [70, 70, -70], color: [1.0, 0.5, 0.75] }, // pink
    { pos: [70, 70, 70], color: [0.95, 0.95, 0.3] }, // yellow
  ];

  const noiseRatio = 0.05;
  const clusterCount = Math.floor(n * (1 - noiseRatio));
  const noiseCount = n - clusterCount;
  const perCluster = Math.floor(clusterCount / centres.length);

  let idx = 0;

  // Clustered points
  for (let c = 0; c < centres.length; c++) {
    const {
      pos: [cx, cy, cz],
      color: [cr, cg, cb],
    } = centres[c];
    const count = c < centres.length - 1 ? perCluster : clusterCount - idx;
    for (let i = 0; i < count; i++) {
      x[idx] = cx + gaussianRandom() * 30;
      y[idx] = cy + gaussianRandom() * 30;
      z[idx] = cz + gaussianRandom() * 30;
      // Slight color variation within cluster
      r[idx] = Math.max(0, Math.min(1, cr + (Math.random() - 0.5) * 0.1));
      g[idx] = Math.max(0, Math.min(1, cg + (Math.random() - 0.5) * 0.1));
      b[idx] = Math.max(0, Math.min(1, cb + (Math.random() - 0.5) * 0.1));
      idx++;
    }
  }

  // Noise points spread across the full volume
  for (let i = 0; i < noiseCount; i++) {
    x[idx] = (Math.random() - 0.5) * 200;
    y[idx] = (Math.random() - 0.5) * 200;
    z[idx] = (Math.random() - 0.5) * 200;
    r[idx] = 0.3;
    g[idx] = 0.3;
    b[idx] = 0.4;
    idx++;
  }

  return { x, y, z, r, g, b };
}

/**
 * Box-Muller transform for Gaussian random numbers (mean 0, stddev 1).
 */
function gaussianRandom(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
