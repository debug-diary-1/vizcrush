/**
 * Generate a clustered 3D point cloud.
 *
 * 8 cluster centres are placed at the corners of a cube [-70, 70]^3.
 * Each cluster has Gaussian-distributed points (radius ~30).
 * ~5% of points are inter-cluster noise spread across [-100, 100]^3.
 */
export function generatePointCloud(n: number): {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
} {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);

  // 8 cluster centres at cube corners
  const centres: [number, number, number][] = [
    [-70, -70, -70],
    [-70, -70, 70],
    [-70, 70, -70],
    [-70, 70, 70],
    [70, -70, -70],
    [70, -70, 70],
    [70, 70, -70],
    [70, 70, 70],
  ];

  const noiseRatio = 0.05;
  const clusterCount = Math.floor(n * (1 - noiseRatio));
  const noiseCount = n - clusterCount;
  const perCluster = Math.floor(clusterCount / centres.length);

  let idx = 0;

  // Clustered points
  for (let c = 0; c < centres.length; c++) {
    const [cx, cy, cz] = centres[c];
    const count = c < centres.length - 1 ? perCluster : clusterCount - idx;
    for (let i = 0; i < count; i++) {
      x[idx] = cx + gaussianRandom() * 30;
      y[idx] = cy + gaussianRandom() * 30;
      z[idx] = cz + gaussianRandom() * 30;
      idx++;
    }
  }

  // Noise points spread across the full volume
  for (let i = 0; i < noiseCount; i++) {
    x[idx] = (Math.random() - 0.5) * 200;
    y[idx] = (Math.random() - 0.5) * 200;
    z[idx] = (Math.random() - 0.5) * 200;
    idx++;
  }

  return { x, y, z };
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
