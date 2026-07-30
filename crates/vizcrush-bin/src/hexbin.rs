use std::collections::HashMap;
use wasm_bindgen::prelude::*;

/// Hexagonal binning using a sparse HashMap.
///
/// Only non-zero bins are stored, saving memory for sparse distributions
/// with large radius. Hex centers are computed on output, not upfront.
#[wasm_bindgen]
pub fn hexbin(x: &[f64], y: &[f64], radius: f64) -> Vec<f64> {
    let n = x.len();
    assert_eq!(n, y.len(), "x and y must have equal length");

    if n == 0 || radius <= 0.0 {
        return vec![];
    }

    // Find data bounds for coordinate origin
    let mut mn_x = f64::INFINITY;
    let mut mn_y = f64::INFINITY;

    for i in 0..n {
        if x[i].is_finite() && y[i].is_finite() {
            if x[i] < mn_x {
                mn_x = x[i];
            }
            if y[i] < mn_y {
                mn_y = y[i];
            }
        }
    }

    let dx = radius * 2.0;
    let dy = radius * 3.0_f64.sqrt();

    // Sparse bin counts keyed by (row, col)
    let mut bins: HashMap<(i32, i32), u32> = HashMap::new();

    // Assign each point to nearest hex center
    for i in 0..n {
        if !x[i].is_finite() || !y[i].is_finite() {
            continue;
        }
        let row = ((y[i] - mn_y) / dy).round() as i32;
        let offset = if row % 2 != 0 { radius } else { 0.0 };
        let col = ((x[i] - mn_x - offset) / dx).round() as i32;
        *bins.entry((row, col)).or_insert(0) += 1;
    }

    // Pack non-zero bins: [cx, cy, count, ...]
    // Compute hex centers on output from (row, col) keys
    let mut result = Vec::with_capacity(bins.len() * 3);
    for (&(row, col), &count) in &bins {
        let offset = if row % 2 != 0 { radius } else { 0.0 };
        let cx = mn_x + col as f64 * dx + offset;
        let cy = mn_y + row as f64 * dy;
        result.push(cx);
        result.push(cy);
        result.push(count as f64);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hexbin_basic() {
        let x = vec![0.0, 1.0, 1.1, 5.0, 5.1];
        let y = vec![0.0, 0.1, 0.2, 5.0, 5.1];
        let result = hexbin(&x, &y, 1.0);
        // Should have some triplets
        assert!(result.len().is_multiple_of(3));
        assert!(!result.is_empty());
    }
}
