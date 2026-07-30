use wasm_bindgen::prelude::*;

/// M4 downsampling: Min-max per pixel bucket (4 points per bucket).
///
/// For each bucket, preserves first, last, min, and max points.
/// Produces up to 4 * ceil(n / bucket_width) points.
///
/// # Returns
/// Interleaved [x0, y0, x1, y1, ...].
#[wasm_bindgen]
pub fn m4(x: &[f64], y: &[f64], threshold: usize) -> Vec<f64> {
    let n = x.len();
    assert_eq!(n, y.len(), "x and y must have equal length");

    if threshold >= n || threshold < 4 {
        let mut result = Vec::with_capacity(n * 2);
        for i in 0..n {
            result.push(x[i]);
            result.push(y[i]);
        }
        return result;
    }

    // Each bucket produces 4 points, so we need threshold/4 buckets
    let num_buckets = threshold / 4;
    let bucket_size = n as f64 / num_buckets as f64;
    let mut result = Vec::with_capacity(num_buckets * 4 * 2);

    for b in 0..num_buckets {
        let start = (b as f64 * bucket_size) as usize;
        let end = (((b + 1) as f64 * bucket_size) as usize).min(n);

        if start >= end {
            continue;
        }

        let mut min_idx = start;
        let mut max_idx = start;
        let first_idx = start;
        let last_idx = end - 1;

        for j in start..end {
            if y[j] < y[min_idx] {
                min_idx = j;
            }
            if y[j] > y[max_idx] {
                max_idx = j;
            }
        }

        // Collect unique indices sorted by position
        let mut indices = vec![first_idx, min_idx, max_idx, last_idx];
        indices.sort_unstable();
        indices.dedup();

        for &idx in &indices {
            result.push(x[idx]);
            result.push(y[idx]);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_m4_basic() {
        let x: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let y: Vec<f64> = x.iter().map(|&xi| (xi * 0.1).sin()).collect();

        let result = m4(&x, &y, 20);
        // Should produce points (interleaved), count depends on dedup
        assert!(result.len() >= 4); // at least 2 points
        assert!(result.len() <= 40); // at most 20 points
    }
}
