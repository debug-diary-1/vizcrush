/**
 * Generate synthetic CT-like volume data simulating a head scan.
 *
 * Structures:
 * - Outer sphere (skull): high density, radius ~40
 * - Inner sphere (brain tissue): medium density, radius ~35
 * - Two small dense spheres (tumors/features): very high density, radius ~5
 * - Background: low-level noise
 *
 * @param n - number of sample points to generate within the volume
 * @returns {x, y, z, density} arrays for each sample point
 */
export function generateCTVolume(n: number): {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  density: Float64Array;
} {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const density = new Float64Array(n);

  // Volume is centered at (50, 50, 50) with range [0, 100]
  const cx = 50;
  const cy = 50;
  const cz = 50;

  // Skull: hollow sphere with outer radius 40, inner radius 37
  const skullOuterR = 40;
  const skullInnerR = 37;
  const skullDensity = 0.95; // bone is very dense in CT

  // Brain: solid sphere with radius 35, moderate density
  const brainR = 35;
  const brainBaseDensity = 0.45;

  // Two small high-density features (tumors / calcifications)
  const feature1 = { x: 60, y: 55, z: 55, r: 5, density: 0.88 };
  const feature2 = { x: 38, y: 42, z: 52, r: 6, density: 0.78 };

  // Ventricles (low-density fluid regions inside brain)
  const ventricle1 = { x: 46, y: 50, z: 50, r: 4, density: 0.15 };
  const ventricle2 = { x: 54, y: 50, z: 50, r: 4, density: 0.15 };

  for (let i = 0; i < n; i++) {
    // Distribute points uniformly in the 0-100 cube
    const px = Math.random() * 100;
    const py = Math.random() * 100;
    const pz = Math.random() * 100;

    x[i] = px;
    y[i] = py;
    z[i] = pz;

    // Distance from center
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Start with background noise
    let d = Math.random() * 0.03;

    // Brain tissue (inside brain radius)
    if (dist < brainR) {
      // Slightly vary density to simulate tissue texture
      d = brainBaseDensity + (Math.random() - 0.5) * 0.1;

      // Gray matter near the surface is slightly denser
      const brainEdgeFactor = dist / brainR;
      if (brainEdgeFactor > 0.8) {
        d += 0.1 * ((brainEdgeFactor - 0.8) / 0.2);
      }
    }

    // Skull shell
    if (dist >= skullInnerR && dist <= skullOuterR) {
      d = skullDensity + (Math.random() - 0.5) * 0.05;
    }

    // Feature 1 (tumor)
    const d1x = px - feature1.x;
    const d1y = py - feature1.y;
    const d1z = pz - feature1.z;
    const dist1 = Math.sqrt(d1x * d1x + d1y * d1y + d1z * d1z);
    if (dist1 < feature1.r) {
      const falloff = 1 - dist1 / feature1.r;
      d = Math.max(d, feature1.density * falloff + (Math.random() - 0.5) * 0.05);
    }

    // Feature 2 (calcification)
    const d2x = px - feature2.x;
    const d2y = py - feature2.y;
    const d2z = pz - feature2.z;
    const dist2 = Math.sqrt(d2x * d2x + d2y * d2y + d2z * d2z);
    if (dist2 < feature2.r) {
      const falloff = 1 - dist2 / feature2.r;
      d = Math.max(d, feature2.density * falloff + (Math.random() - 0.5) * 0.05);
    }

    // Ventricle 1 (overrides brain tissue with low density)
    const v1x = px - ventricle1.x;
    const v1y = py - ventricle1.y;
    const v1z = pz - ventricle1.z;
    const distV1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
    if (distV1 < ventricle1.r) {
      d = ventricle1.density + Math.random() * 0.03;
    }

    // Ventricle 2
    const v2x = px - ventricle2.x;
    const v2y = py - ventricle2.y;
    const v2z = pz - ventricle2.z;
    const distV2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z);
    if (distV2 < ventricle2.r) {
      d = ventricle2.density + Math.random() * 0.03;
    }

    density[i] = Math.max(0, Math.min(1, d));
  }

  return { x, y, z, density };
}
