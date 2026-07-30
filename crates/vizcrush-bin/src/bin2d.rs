use vizcrush_core::find_finite_range;
use wasm_bindgen::prelude::*;

/// 2D density grid binning (WASM fallback path for MVP).
///
/// WebGPU compute shader version will be added in v0.2.0.
///
/// # Arguments
/// * `x`, `y` - Coordinate arrays (same length).
/// * `x_bins`, `y_bins` - Grid resolution.
/// * `x_min`, `x_max`, `y_min`, `y_max` - Range (NaN = auto-detect).
///
/// # Returns
/// Flat grid (row-major, y_bins * x_bins) as f64, followed by x_edges (x_bins+1) and y_edges (y_bins+1).
#[wasm_bindgen]
pub fn bin2d(
    x: &[f64],
    y: &[f64],
    x_bins: usize,
    y_bins: usize,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
) -> Vec<f64> {
    let n = x.len();
    assert_eq!(n, y.len(), "x and y must have equal length");

    if n == 0 || x_bins == 0 || y_bins == 0 {
        return vec![];
    }

    let (xn, xx) = if x_min.is_nan() || x_max.is_nan() {
        find_finite_range(x)
    } else {
        (x_min, x_max)
    };

    let (yn, yx) = if y_min.is_nan() || y_max.is_nan() {
        find_finite_range(y)
    } else {
        (y_min, y_max)
    };

    if xn >= xx || yn >= yx {
        return vec![];
    }

    let x_width = (xx - xn) / x_bins as f64;
    let y_width = (yx - yn) / y_bins as f64;
    let grid_size = x_bins * y_bins;
    let mut grid = vec![0u32; grid_size];

    for i in 0..n {
        if !x[i].is_finite() || !y[i].is_finite() {
            continue;
        }
        let mut xi = ((x[i] - xn) / x_width) as usize;
        let mut yi = ((y[i] - yn) / y_width) as usize;
        if xi >= x_bins {
            xi = x_bins - 1;
        }
        if yi >= y_bins {
            yi = y_bins - 1;
        }
        grid[yi * x_bins + xi] += 1;
    }

    // Pack: grid, x_edges, y_edges
    let mut result = Vec::with_capacity(grid_size + x_bins + 1 + y_bins + 1);
    for &c in &grid {
        result.push(c as f64);
    }
    for i in 0..=x_bins {
        result.push(xn + i as f64 * x_width);
    }
    for i in 0..=y_bins {
        result.push(yn + i as f64 * y_width);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bin2d_basic() {
        let x = vec![0.0, 1.0, 2.0, 3.0, 4.0];
        let y = vec![0.0, 1.0, 2.0, 3.0, 4.0];
        let result = bin2d(&x, &y, 2, 2, f64::NAN, f64::NAN, f64::NAN, f64::NAN);
        // grid: 4, x_edges: 3, y_edges: 3 = 10 total
        assert_eq!(result.len(), 4 + 3 + 3);
    }
}
