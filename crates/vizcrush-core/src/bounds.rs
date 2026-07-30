//! Shared bounds-finding used by the binning and spatial-indexing crates.
//! Two distinct policies live here because the callers actually need two
//! distinct things — collapsing them into one "do everything" function would
//! silently change behaviour for whichever caller didn't want the other's
//! semantics:
//!
//! - [`find_finite_range`]: one array, each element's finiteness judged on
//!   its own. Used for auto-ranging a single axis (histograms, per-axis bin
//!   ranges).
//! - [`find_padded_bounds`]: N parallel coordinate arrays, a point only
//!   counts if *every* axis is finite at that index (a NaN `y` drops the
//!   whole point, not just that axis), then each axis is padded by 0.1% of
//!   its own span. Used for building spatial trees, where a point with a
//!   missing coordinate isn't placeable at all.

/// Find the `(min, max)` of the finite values in `data`, ignoring non-finite
/// entries independently of any other array. Returns `(f64::INFINITY,
/// f64::NEG_INFINITY)` if `data` is empty or has no finite values — callers
/// that need a usable range on that case already check `min <= max` (a
/// non-finite result fails that check).
pub fn find_finite_range(data: &[f64]) -> (f64, f64) {
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

/// Find the per-axis `(min, max)` bounds across N parallel coordinate arrays
/// (all the same length), counting a point only when every axis is finite at
/// that index, then padding each axis by 0.1% of its own span. Returns one
/// `(min, max)` pair per input axis, in the same order.
///
/// Panics if `axes` is empty or the arrays have unequal lengths — both are
/// caller bugs, not runtime conditions (mirrors the `assert_eq!` the
/// duplicated call sites already had for x/y/z length checks).
pub fn find_padded_bounds(axes: &[&[f64]]) -> Vec<(f64, f64)> {
    assert!(
        !axes.is_empty(),
        "find_padded_bounds: at least one axis is required"
    );
    let n = axes[0].len();
    for a in axes {
        assert_eq!(
            a.len(),
            n,
            "find_padded_bounds: all axes must have equal length"
        );
    }

    let mut mins = vec![f64::INFINITY; axes.len()];
    let mut maxs = vec![f64::NEG_INFINITY; axes.len()];

    for i in 0..n {
        if axes.iter().all(|a| a[i].is_finite()) {
            for (k, a) in axes.iter().enumerate() {
                if a[i] < mins[k] {
                    mins[k] = a[i];
                }
                if a[i] > maxs[k] {
                    maxs[k] = a[i];
                }
            }
        }
    }

    mins.iter()
        .zip(maxs.iter())
        .map(|(&mn, &mx)| {
            let pad = (mx - mn) * 0.001;
            (mn - pad, mx + pad)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- find_finite_range -----------------------------------------------

    #[test]
    fn finite_range_basic() {
        assert_eq!(find_finite_range(&[3.0, 1.0, 2.0]), (1.0, 3.0));
    }

    #[test]
    fn finite_range_empty() {
        let (mn, mx) = find_finite_range(&[]);
        assert!(mn.is_infinite() && mn.is_sign_positive());
        assert!(mx.is_infinite() && mx.is_sign_negative());
    }

    #[test]
    fn finite_range_single_point() {
        assert_eq!(find_finite_range(&[5.0]), (5.0, 5.0));
    }

    #[test]
    fn finite_range_skips_nan_and_infinity_independently() {
        let (mn, mx) = find_finite_range(&[1.0, f64::NAN, 9.0, f64::INFINITY, -3.0]);
        assert_eq!((mn, mx), (-3.0, 9.0));
    }

    #[test]
    fn finite_range_all_non_finite() {
        let (mn, mx) = find_finite_range(&[f64::NAN, f64::INFINITY, f64::NEG_INFINITY]);
        assert!(mn.is_infinite() && mn.is_sign_positive());
        assert!(mx.is_infinite() && mx.is_sign_negative());
    }

    // -- find_padded_bounds -------------------------------------------------

    #[test]
    fn padded_bounds_basic_2d() {
        let x = vec![0.0, 10.0];
        let y = vec![0.0, 10.0];
        let bounds = find_padded_bounds(&[&x, &y]);
        assert_eq!(bounds.len(), 2);
        // 0.1% padding of a span of 10 is 0.01.
        assert!((bounds[0].0 - -0.01).abs() < 1e-9);
        assert!((bounds[0].1 - 10.01).abs() < 1e-9);
        assert_eq!(bounds[0], bounds[1]);
    }

    #[test]
    fn padded_bounds_single_point_has_zero_span() {
        let x = vec![5.0];
        let y = vec![5.0];
        let bounds = find_padded_bounds(&[&x, &y]);
        // Zero span → zero padding, bounds collapse to the point itself.
        assert_eq!(bounds[0], (5.0, 5.0));
    }

    #[test]
    fn padded_bounds_drops_whole_point_when_any_axis_is_non_finite() {
        let x = vec![1.0, 2.0, f64::NAN];
        let y = vec![1.0, f64::NAN, 3.0];
        // Only index 0 has both axes finite.
        let bounds = find_padded_bounds(&[&x, &y]);
        assert_eq!(bounds[0], (1.0, 1.0));
        assert_eq!(bounds[1], (1.0, 1.0));
    }

    #[test]
    fn padded_bounds_3d() {
        let x = vec![0.0, 4.0];
        let y = vec![0.0, 4.0];
        let z = vec![0.0, 4.0];
        let bounds = find_padded_bounds(&[&x, &y, &z]);
        assert_eq!(bounds.len(), 3);
        for b in &bounds {
            assert!(b.0 < 0.0 && b.1 > 4.0);
        }
    }

    #[test]
    #[should_panic(expected = "at least one axis")]
    fn padded_bounds_requires_at_least_one_axis() {
        find_padded_bounds(&[]);
    }

    #[test]
    #[should_panic(expected = "equal length")]
    fn padded_bounds_requires_equal_length_axes() {
        let x = vec![1.0, 2.0];
        let y = vec![1.0];
        find_padded_bounds(&[&x, &y]);
    }
}
