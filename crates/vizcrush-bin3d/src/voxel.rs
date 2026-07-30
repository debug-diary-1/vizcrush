use vizcrush_core::find_finite_range;
use wasm_bindgen::prelude::*;

/// 3D voxel grid binning (WASM fallback path for MVP).
///
/// # Arguments
/// * `x`, `y`, `z` - Coordinate arrays (same length).
/// * `x_bins`, `y_bins`, `z_bins` - Grid resolution per axis.
/// * `x_min`, `x_max`, `y_min`, `y_max`, `z_min`, `z_max` - Range (NaN = auto-detect).
///
/// # Returns
/// Flat grid (z_bins * y_bins * x_bins) as f64 counts, followed by
/// x_edges (x_bins+1), y_edges (y_bins+1), z_edges (z_bins+1).
#[wasm_bindgen]
pub fn bin3d(
    x: &[f64],
    y: &[f64],
    z: &[f64],
    x_bins: usize,
    y_bins: usize,
    z_bins: usize,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    z_min: f64,
    z_max: f64,
) -> Vec<f64> {
    let n = x.len();
    assert_eq!(n, y.len(), "x and y must have equal length");
    assert_eq!(n, z.len(), "x and z must have equal length");

    if n == 0 || x_bins == 0 || y_bins == 0 || z_bins == 0 {
        return vec![];
    }

    let (mut xn, mut xx) = if x_min.is_nan() || x_max.is_nan() {
        find_finite_range(x)
    } else {
        (x_min, x_max)
    };

    let (mut yn, mut yx) = if y_min.is_nan() || y_max.is_nan() {
        find_finite_range(y)
    } else {
        (y_min, y_max)
    };

    let (mut zn, mut zx) = if z_min.is_nan() || z_max.is_nan() {
        find_finite_range(z)
    } else {
        (z_min, z_max)
    };

    // Handle min==max edge case: widen by 1
    if xn >= xx {
        xn -= 0.5;
        xx += 0.5;
    }
    if yn >= yx {
        yn -= 0.5;
        yx += 0.5;
    }
    if zn >= zx {
        zn -= 0.5;
        zx += 0.5;
    }

    let x_width = (xx - xn) / x_bins as f64;
    let y_width = (yx - yn) / y_bins as f64;
    let z_width = (zx - zn) / z_bins as f64;
    let grid_size = x_bins * y_bins * z_bins;
    let mut grid = vec![0u32; grid_size];

    // Single pass O(n) binning
    for i in 0..n {
        if !x[i].is_finite() || !y[i].is_finite() || !z[i].is_finite() {
            continue;
        }
        let mut xi = ((x[i] - xn) / x_width) as usize;
        let mut yi = ((y[i] - yn) / y_width) as usize;
        let mut zi = ((z[i] - zn) / z_width) as usize;
        if xi >= x_bins {
            xi = x_bins - 1;
        }
        if yi >= y_bins {
            yi = y_bins - 1;
        }
        if zi >= z_bins {
            zi = z_bins - 1;
        }
        // Index: z-major, then y, then x
        grid[zi * (y_bins * x_bins) + yi * x_bins + xi] += 1;
    }

    // Pack: grid, x_edges, y_edges, z_edges
    let mut result = Vec::with_capacity(grid_size + (x_bins + 1) + (y_bins + 1) + (z_bins + 1));
    for &c in &grid {
        result.push(c as f64);
    }
    for i in 0..=x_bins {
        result.push(xn + i as f64 * x_width);
    }
    for i in 0..=y_bins {
        result.push(yn + i as f64 * y_width);
    }
    for i in 0..=z_bins {
        result.push(zn + i as f64 * z_width);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bin3d_basic() {
        let x = vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0];
        let y = vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0];
        let z = vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0];

        let result = bin3d(&x, &y, &z, 2, 2, 2, 0.0, 10.0, 0.0, 10.0, 0.0, 10.0);
        // grid: 2*2*2=8 cells, x_edges: 3, y_edges: 3, z_edges: 3
        let grid_size = 8;
        let total_len = grid_size + 3 + 3 + 3;
        assert_eq!(result.len(), total_len);

        // Total count across all bins should equal 10
        let total_count: f64 = result[..grid_size].iter().sum();
        assert_eq!(total_count as usize, 10);
    }

    #[test]
    fn test_bin3d_auto_range() {
        let x = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let y = vec![10.0, 20.0, 30.0, 40.0, 50.0];
        let z = vec![100.0, 200.0, 300.0, 400.0, 500.0];

        let result = bin3d(
            &x,
            &y,
            &z,
            2,
            2,
            2,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
        );
        let grid_size = 8;
        assert_eq!(result.len(), grid_size + 3 + 3 + 3);

        // Total count should equal 5
        let total_count: f64 = result[..grid_size].iter().sum();
        assert_eq!(total_count as usize, 5);
    }

    #[test]
    fn test_bin3d_empty() {
        let result = bin3d(&[], &[], &[], 2, 2, 2, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0);
        assert!(result.is_empty());
    }
}
