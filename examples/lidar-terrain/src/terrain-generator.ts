/**
 * Generate terrain-like LiDAR point data.
 *
 * Height (y) is computed from (x,z) using layered sine/cosine waves
 * to create rolling hills, with random jitter to simulate LiDAR scatter.
 *
 * x,z range: [-200, 200]
 */
export function generateTerrain(n: number): {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
} {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);

  const rangeMin = -200;
  const rangeMax = 200;
  const span = rangeMax - rangeMin;

  for (let i = 0; i < n; i++) {
    // Distribute points across the terrain with slight random jitter
    const px = rangeMin + Math.random() * span;
    const pz = rangeMin + Math.random() * span;

    // Layered sine waves for terrain height
    const h1 = 30 * Math.sin(px / 50) * Math.cos(pz / 60);
    const h2 = 15 * Math.sin(px / 20 + pz / 30);
    const h3 = 8 * Math.sin(px / 12) * Math.sin(pz / 15);
    const h4 = 4 * Math.cos(px / 8 + pz / 10);

    // LiDAR noise: small vertical scatter + tiny horizontal jitter
    const noise = (Math.random() - 0.5) * 2.0;
    const jitterX = (Math.random() - 0.5) * 0.5;
    const jitterZ = (Math.random() - 0.5) * 0.5;

    x[i] = px + jitterX;
    y[i] = h1 + h2 + h3 + h4 + noise;
    z[i] = pz + jitterZ;
  }

  return { x, y, z };
}
