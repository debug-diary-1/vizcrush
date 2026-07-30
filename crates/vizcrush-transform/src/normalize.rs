use wasm_bindgen::prelude::*;

// ── SIMD helpers (WASM SIMD128) ─────────────────────────────────────────────

#[cfg(target_feature = "simd128")]
use core::arch::wasm32::*;

/// Find the min and max of finite values in `data`.
#[cfg(target_feature = "simd128")]
#[inline]
fn find_min_max(data: &[f64]) -> (f64, f64) {
    let len = data.len();
    let chunks = len / 2;

    let mut vmin = f64x2_splat(f64::INFINITY);
    let mut vmax = f64x2_splat(f64::NEG_INFINITY);

    let ptr = data.as_ptr();
    for i in 0..chunks {
        let v = unsafe { v128_load(ptr.add(i * 2) as *const v128) };
        vmin = f64x2_pmin(vmin, v);
        vmax = f64x2_pmax(vmax, v);
    }

    // Horizontal reduce: extract lanes
    let min_a = f64x2_extract_lane::<0>(vmin);
    let min_b = f64x2_extract_lane::<1>(vmin);
    let max_a = f64x2_extract_lane::<0>(vmax);
    let max_b = f64x2_extract_lane::<1>(vmax);

    let mut mn = if min_a < min_b { min_a } else { min_b };
    let mut mx = if max_a > max_b { max_a } else { max_b };

    // Handle the tail element (odd length)
    if len % 2 != 0 {
        let v = data[len - 1];
        if v.is_finite() {
            if v < mn {
                mn = v;
            }
            if v > mx {
                mx = v;
            }
        }
    }

    // SIMD pmin/pmax propagate NaN differently; do a finite check on the result.
    // If the SIMD result is non-finite (e.g. the input contained NaN/Inf), fall back.
    if !mn.is_finite() || !mx.is_finite() {
        return find_min_max_scalar(data);
    }

    (mn, mx)
}

/// Scalar fallback for find_min_max.
#[cfg(target_feature = "simd128")]
#[inline]
fn find_min_max_scalar(data: &[f64]) -> (f64, f64) {
    let mut mn = f64::INFINITY;
    let mut mx = f64::NEG_INFINITY;
    for &v in data {
        if v.is_finite() {
            if v < mn {
                mn = v;
            }
            if v > mx {
                mx = v;
            }
        }
    }
    (mn, mx)
}

/// Normalize `data` to [0, 1] using SIMD: `(v - min) * inv_range`, clamped.
#[cfg(target_feature = "simd128")]
#[inline]
fn normalize_inner(data: &[f64], min_val: f64, inv_range: f64) -> Vec<f64> {
    let len = data.len();
    let mut out = vec![0.0f64; len];
    let chunks = len / 2;

    let vmin = f64x2_splat(min_val);
    let vinv = f64x2_splat(inv_range);
    let vzero = f64x2_splat(0.0);
    let vone = f64x2_splat(1.0);
    let vnan = f64x2_splat(f64::NAN);

    let src = data.as_ptr();
    let dst = out.as_mut_ptr();

    for i in 0..chunks {
        let v = unsafe { v128_load(src.add(i * 2) as *const v128) };
        let shifted = f64x2_sub(v, vmin);
        let normed = f64x2_mul(shifted, vinv);
        let clamped = f64x2_pmax(vzero, f64x2_pmin(vone, normed));

        // NaN detection in-lane: NaN != NaN, so f64x2_eq(v, v) is false for NaN.
        // Use bitselect to blend NaN into the result where input was non-finite.
        let is_finite = f64x2_eq(v, v);
        let result = v128_bitselect(clamped, vnan, is_finite);
        unsafe { v128_store(dst.add(i * 2) as *mut v128, result) };
    }

    // Handle odd tail element via scalar
    if len % 2 != 0 {
        let v = data[len - 1];
        out[len - 1] = if !v.is_finite() {
            f64::NAN
        } else {
            let n = (v - min_val) * inv_range;
            n.clamp(0.0, 1.0)
        };
    }

    out
}

// ── Scalar path (non-SIMD or fallback) ──────────────────────────────────────

#[cfg(not(target_feature = "simd128"))]
#[inline]
fn find_min_max(data: &[f64]) -> (f64, f64) {
    let mut mn = f64::INFINITY;
    let mut mx = f64::NEG_INFINITY;
    for &v in data {
        if v.is_finite() {
            if v < mn {
                mn = v;
            }
            if v > mx {
                mx = v;
            }
        }
    }
    (mn, mx)
}

#[cfg(not(target_feature = "simd128"))]
#[inline]
fn normalize_inner(data: &[f64], min_val: f64, inv_range: f64) -> Vec<f64> {
    data.iter()
        .map(|&v| {
            if !v.is_finite() {
                f64::NAN
            } else {
                let n = (v - min_val) * inv_range;
                n.clamp(0.0, 1.0)
            }
        })
        .collect()
}

// ── Public API ──────────────────────────────────────────────────────────────

/// Min-max normalization of `data` to \[0, 1\], optionally with a custom range.
/// NaN / Infinity values are preserved as NaN.
#[wasm_bindgen]
pub fn normalize(data: &[f64], range_min: f64, range_max: f64) -> Vec<f64> {
    let (mn, mx) = if range_min.is_finite() && range_max.is_finite() && range_max > range_min {
        (range_min, range_max)
    } else {
        find_min_max(data)
    };

    if !mn.is_finite() || !mx.is_finite() || mx <= mn {
        // All NaN/Inf or constant — return zeros or NaN
        return data
            .iter()
            .map(|&v| if v.is_finite() { 0.0 } else { f64::NAN })
            .collect();
    }

    let inv_range = 1.0 / (mx - mn);
    normalize_inner(data, mn, inv_range)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic() {
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = normalize(&data, f64::NAN, f64::NAN);
        assert_eq!(result.len(), 5);
        assert!((result[0] - 0.0).abs() < 1e-10);
        assert!((result[4] - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_with_nan() {
        let data = vec![1.0, f64::NAN, 3.0];
        let result = normalize(&data, f64::NAN, f64::NAN);
        assert!((result[0] - 0.0).abs() < 1e-10);
        assert!(result[1].is_nan());
        assert!((result[2] - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_empty() {
        let result = normalize(&[], f64::NAN, f64::NAN);
        assert!(result.is_empty());
    }

    #[test]
    fn test_custom_range() {
        let data = vec![10.0, 20.0, 30.0];
        let result = normalize(&data, 0.0, 100.0);
        assert!((result[0] - 0.1).abs() < 1e-10);
        assert!((result[1] - 0.2).abs() < 1e-10);
        assert!((result[2] - 0.3).abs() < 1e-10);
    }

    #[test]
    fn test_large() {
        let data: Vec<f64> = (0..10000).map(|i| i as f64).collect();
        let result = normalize(&data, f64::NAN, f64::NAN);
        assert_eq!(result.len(), 10000);
        assert!((result[0] - 0.0).abs() < 1e-10);
        assert!((result[9999] - 1.0).abs() < 1e-10);
    }
}
