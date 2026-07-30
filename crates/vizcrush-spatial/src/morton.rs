use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// 2D bit spreading / compacting  (32-bit coords → 64-bit interleaved)
// ---------------------------------------------------------------------------

/// Spread bits of a 32-bit value so each bit has a zero gap between it and the
/// next, producing a 64-bit result.
#[inline]
fn spread_bits_32(x: u32) -> u64 {
    let mut x = x as u64;
    x = (x | (x << 16)) & 0x0000_FFFF_0000_FFFF;
    x = (x | (x << 8)) & 0x00FF_00FF_00FF_00FF;
    x = (x | (x << 4)) & 0x0F0F_0F0F_0F0F_0F0F;
    x = (x | (x << 2)) & 0x3333_3333_3333_3333;
    x = (x | (x << 1)) & 0x5555_5555_5555_5555;
    x
}

/// Compact a 64-bit interleaved value back to a 32-bit coordinate.
#[inline]
fn compact_bits_32(mut x: u64) -> u32 {
    x &= 0x5555_5555_5555_5555;
    x = (x | (x >> 1)) & 0x3333_3333_3333_3333;
    x = (x | (x >> 2)) & 0x0F0F_0F0F_0F0F_0F0F;
    x = (x | (x >> 4)) & 0x00FF_00FF_00FF_00FF;
    x = (x | (x >> 8)) & 0x0000_FFFF_0000_FFFF;
    x = (x | (x >> 16)) & 0x0000_0000_FFFF_FFFF;
    x as u32
}

// ---------------------------------------------------------------------------
// 3D bit spreading / compacting  (21-bit coords → 63-bit interleaved)
// ---------------------------------------------------------------------------

/// Spread a 21-bit value so each bit has two zero gaps (for 3-way interleave).
#[inline]
fn spread_bits_21(x: u32) -> u64 {
    let mut x = x as u64 & 0x1F_FFFF;
    x = (x | (x << 32)) & 0x001F_0000_0000_FFFF;
    x = (x | (x << 16)) & 0x001F_0000_FF00_00FF;
    x = (x | (x << 8)) & 0x100F_00F0_0F00_F00F;
    x = (x | (x << 4)) & 0x10C3_0C30_C30C_30C3;
    x = (x | (x << 2)) & 0x1249_2492_4924_9249;
    x
}

/// Compact a 3-way interleaved 63-bit value back to a 21-bit coordinate.
#[inline]
fn compact_bits_21(mut x: u64) -> u32 {
    x &= 0x1249_2492_4924_9249;
    x = (x | (x >> 2)) & 0x10C3_0C30_C30C_30C3;
    x = (x | (x >> 4)) & 0x100F_00F0_0F00_F00F;
    x = (x | (x >> 8)) & 0x001F_0000_FF00_00FF;
    x = (x | (x >> 16)) & 0x001F_0000_0000_FFFF;
    x = (x | (x >> 32)) & 0x0000_0000_001F_FFFF;
    x as u32
}

// ---------------------------------------------------------------------------
// Public encode / decode
// ---------------------------------------------------------------------------

/// Encode two 32-bit coordinates into a 64-bit Morton (Z-order) code.
#[wasm_bindgen]
pub fn morton_encode_2d(x: u32, y: u32) -> u64 {
    spread_bits_32(x) | (spread_bits_32(y) << 1)
}

/// Decode a 64-bit Morton code back to two 32-bit coordinates `[x, y]`.
#[wasm_bindgen]
pub fn morton_decode_2d(code: u64) -> Vec<u32> {
    vec![compact_bits_32(code), compact_bits_32(code >> 1)]
}

/// Encode three 21-bit coordinates into a 63-bit Morton code.
#[wasm_bindgen]
pub fn morton_encode_3d(x: u32, y: u32, z: u32) -> u64 {
    spread_bits_21(x) | (spread_bits_21(y) << 1) | (spread_bits_21(z) << 2)
}

/// Decode a 63-bit Morton code back to three 21-bit coordinates `[x, y, z]`.
#[wasm_bindgen]
pub fn morton_decode_3d(code: u64) -> Vec<u32> {
    vec![
        compact_bits_21(code),
        compact_bits_21(code >> 1),
        compact_bits_21(code >> 2),
    ]
}

// ---------------------------------------------------------------------------
// Point ordering helpers
// ---------------------------------------------------------------------------

/// Maximum integer coordinate value used when normalising floating-point data
/// to the 21-bit range required by the 3D encoder (and also used for the 2D
/// ordering so that both helpers share the same resolution).
const NORM_SCALE: u32 = (1u32 << 21) - 1;

/// Reorder 2D points by Z-order curve.  Returns an index permutation sorted by
/// ascending Morton code.  Coordinates are normalised to a 21-bit integer
/// range internally.  Non-finite values are placed at the end.
#[wasm_bindgen]
pub fn morton_order_2d(x: &[f64], y: &[f64]) -> Vec<u32> {
    if x.is_empty() {
        return vec![];
    }
    let n = x.len().min(y.len());

    // Compute bounding box (skip NaN / Inf)
    let (mut x_min, mut x_max) = (f64::INFINITY, f64::NEG_INFINITY);
    let (mut y_min, mut y_max) = (f64::INFINITY, f64::NEG_INFINITY);
    for i in 0..n {
        if x[i].is_finite() && y[i].is_finite() {
            x_min = x_min.min(x[i]);
            x_max = x_max.max(x[i]);
            y_min = y_min.min(y[i]);
            y_max = y_max.max(y[i]);
        }
    }
    // If no finite points were found, return identity permutation.
    if !x_min.is_finite() {
        return (0..n as u32).collect();
    }

    let x_range = if x_max > x_min { x_max - x_min } else { 1.0 };
    let y_range = if y_max > y_min { y_max - y_min } else { 1.0 };
    let scale = NORM_SCALE as f64;

    let mut indexed: Vec<(u64, u32)> = (0..n)
        .map(|i| {
            if !x[i].is_finite() || !y[i].is_finite() {
                (u64::MAX, i as u32)
            } else {
                let xi = ((x[i] - x_min) / x_range * scale).min(scale) as u32;
                let yi = ((y[i] - y_min) / y_range * scale).min(scale) as u32;
                (morton_encode_2d(xi, yi), i as u32)
            }
        })
        .collect();

    indexed.sort_unstable_by_key(|&(code, _)| code);
    indexed.iter().map(|&(_, idx)| idx).collect()
}

/// Reorder 3D points by Z-order curve.  Returns an index permutation sorted by
/// ascending Morton code.  Coordinates are normalised to a 21-bit integer
/// range.  Non-finite values are placed at the end.
#[wasm_bindgen]
pub fn morton_order_3d(x: &[f64], y: &[f64], z: &[f64]) -> Vec<u32> {
    if x.is_empty() {
        return vec![];
    }
    let n = x.len().min(y.len()).min(z.len());

    let (mut x_min, mut x_max) = (f64::INFINITY, f64::NEG_INFINITY);
    let (mut y_min, mut y_max) = (f64::INFINITY, f64::NEG_INFINITY);
    let (mut z_min, mut z_max) = (f64::INFINITY, f64::NEG_INFINITY);
    for i in 0..n {
        if x[i].is_finite() && y[i].is_finite() && z[i].is_finite() {
            x_min = x_min.min(x[i]);
            x_max = x_max.max(x[i]);
            y_min = y_min.min(y[i]);
            y_max = y_max.max(y[i]);
            z_min = z_min.min(z[i]);
            z_max = z_max.max(z[i]);
        }
    }
    if !x_min.is_finite() {
        return (0..n as u32).collect();
    }

    let x_range = if x_max > x_min { x_max - x_min } else { 1.0 };
    let y_range = if y_max > y_min { y_max - y_min } else { 1.0 };
    let z_range = if z_max > z_min { z_max - z_min } else { 1.0 };
    let scale = NORM_SCALE as f64;

    let mut indexed: Vec<(u64, u32)> = (0..n)
        .map(|i| {
            if !x[i].is_finite() || !y[i].is_finite() || !z[i].is_finite() {
                (u64::MAX, i as u32)
            } else {
                let xi = ((x[i] - x_min) / x_range * scale).min(scale) as u32;
                let yi = ((y[i] - y_min) / y_range * scale).min(scale) as u32;
                let zi = ((z[i] - z_min) / z_range * scale).min(scale) as u32;
                (morton_encode_3d(xi, yi, zi), i as u32)
            }
        })
        .collect();

    indexed.sort_unstable_by_key(|&(code, _)| code);
    indexed.iter().map(|&(_, idx)| idx).collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- Round-trip encode/decode 2D ------------------------------------------

    #[test]
    fn roundtrip_2d_zero() {
        let code = morton_encode_2d(0, 0);
        assert_eq!(morton_decode_2d(code), vec![0, 0]);
    }

    #[test]
    fn roundtrip_2d_small() {
        for x in 0..64u32 {
            for y in 0..64u32 {
                let code = morton_encode_2d(x, y);
                let decoded = morton_decode_2d(code);
                assert_eq!(decoded, vec![x, y], "failed for ({x}, {y})");
            }
        }
    }

    #[test]
    fn roundtrip_2d_large_values() {
        let vals: Vec<u32> = vec![0, 1, 255, 1023, 65535, 0x00FF_FFFF, 0xFFFF_FFFF];
        for &x in &vals {
            for &y in &vals {
                let decoded = morton_decode_2d(morton_encode_2d(x, y));
                assert_eq!(decoded, vec![x, y]);
            }
        }
    }

    // -- Round-trip encode/decode 3D ------------------------------------------

    #[test]
    fn roundtrip_3d_zero() {
        let code = morton_encode_3d(0, 0, 0);
        assert_eq!(morton_decode_3d(code), vec![0, 0, 0]);
    }

    #[test]
    fn roundtrip_3d_small() {
        for x in 0..16u32 {
            for y in 0..16u32 {
                for z in 0..16u32 {
                    let decoded = morton_decode_3d(morton_encode_3d(x, y, z));
                    assert_eq!(decoded, vec![x, y, z], "failed for ({x}, {y}, {z})");
                }
            }
        }
    }

    #[test]
    fn roundtrip_3d_max() {
        let max21 = (1u32 << 21) - 1;
        let decoded = morton_decode_3d(morton_encode_3d(max21, max21, max21));
        assert_eq!(decoded, vec![max21, max21, max21]);
    }

    // -- morton_order_2d with known points ------------------------------------

    #[test]
    fn order_2d_known_points() {
        // Four points at the corners of a unit square.
        // After normalisation the integer coords are:
        //   (0,0) → code 0
        //   (1,0) → code with x bits only (small)
        //   (0,1) → code with y bits only (slightly larger)
        //   (1,1) → code largest
        // Expected Z-order: bottom-left, bottom-right, top-left, top-right
        let x = vec![0.0, 1.0, 0.0, 1.0];
        let y = vec![0.0, 0.0, 1.0, 1.0];
        let order = morton_order_2d(&x, &y);
        assert_eq!(order, vec![0, 1, 2, 3]);
    }

    #[test]
    fn order_2d_known_points_shuffled() {
        // Same corners but supplied in a different order.
        let x = vec![1.0, 0.0, 1.0, 0.0];
        let y = vec![1.0, 0.0, 0.0, 1.0];
        let order = morton_order_2d(&x, &y);
        // Expected Z-order:
        //   (0,0)=idx1  (1,0)=idx2  (0,1)=idx3  (1,1)=idx0
        assert_eq!(order, vec![1, 2, 3, 0]);
    }

    // -- Empty / single -------------------------------------------------------

    #[test]
    fn order_2d_empty() {
        let order = morton_order_2d(&[], &[]);
        assert!(order.is_empty());
    }

    #[test]
    fn order_2d_single() {
        let order = morton_order_2d(&[42.0], &[99.0]);
        assert_eq!(order, vec![0]);
    }

    #[test]
    fn order_3d_empty() {
        let order = morton_order_3d(&[], &[], &[]);
        assert!(order.is_empty());
    }

    #[test]
    fn order_3d_single() {
        let order = morton_order_3d(&[1.0], &[2.0], &[3.0]);
        assert_eq!(order, vec![0]);
    }

    // -- NaN skipping ---------------------------------------------------------

    #[test]
    fn order_2d_nan_skipped() {
        let x = vec![0.0, f64::NAN, 1.0];
        let y = vec![0.0, 1.0, 1.0];
        let order = morton_order_2d(&x, &y);
        // Finite points first in Z-order, then the NaN point last.
        assert_eq!(order.len(), 3);
        // The NaN index (1) must be last.
        assert_eq!(*order.last().unwrap(), 1);
    }

    #[test]
    fn order_3d_nan_skipped() {
        let x = vec![f64::NAN, 0.0, 1.0];
        let y = vec![0.0, 0.0, 1.0];
        let z = vec![0.0, 0.0, 1.0];
        let order = morton_order_3d(&x, &y, &z);
        assert_eq!(order.len(), 3);
        assert_eq!(*order.last().unwrap(), 0); // NaN index is 0
    }

    // -- Large scale (10K) valid permutation ----------------------------------

    #[test]
    fn order_2d_large_scale() {
        let n = 10_000usize;
        let x: Vec<f64> = (0..n).map(|i| (i as f64 * 0.1).sin() * 1000.0).collect();
        let y: Vec<f64> = (0..n).map(|i| (i as f64 * 0.07).cos() * 1000.0).collect();
        let order = morton_order_2d(&x, &y);

        // Must be a valid permutation of 0..n
        assert_eq!(order.len(), n);
        let mut sorted = order.clone();
        sorted.sort();
        let expected: Vec<u32> = (0..n as u32).collect();
        assert_eq!(sorted, expected);
    }

    #[test]
    fn order_3d_large_scale() {
        let n = 10_000usize;
        let x: Vec<f64> = (0..n).map(|i| (i as f64 * 0.1).sin() * 500.0).collect();
        let y: Vec<f64> = (0..n).map(|i| (i as f64 * 0.07).cos() * 500.0).collect();
        let z: Vec<f64> = (0..n).map(|i| (i as f64 * 0.03).sin() * 500.0).collect();
        let order = morton_order_3d(&x, &y, &z);

        assert_eq!(order.len(), n);
        let mut sorted = order.clone();
        sorted.sort();
        let expected: Vec<u32> = (0..n as u32).collect();
        assert_eq!(sorted, expected);
    }
}
