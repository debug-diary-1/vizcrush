use wasm_bindgen::prelude::*;

/// Largest-Triangle-One-Bucket downsampling.
///
/// Simpler than LTTB — selects the point with maximum triangle area
/// using only the previous selected point and the current point's neighbors.
/// Slightly less accurate but faster.
///
/// # Returns
/// Interleaved [x0, y0, x1, y1, ...].
#[wasm_bindgen]
pub fn ltob(x: &[f64], y: &[f64], threshold: usize) -> Vec<f64> {
    let n = x.len();
    assert_eq!(n, y.len(), "x and y must have equal length");

    if threshold >= n || threshold < 2 {
        let mut result = Vec::with_capacity(n * 2);
        for i in 0..n {
            result.push(x[i]);
            result.push(y[i]);
        }
        return result;
    }

    let mut result = Vec::with_capacity(threshold * 2);

    // Always include first point
    result.push(x[0]);
    result.push(y[0]);

    let bucket_size = (n - 2) as f64 / (threshold - 2) as f64;

    for i in 0..(threshold - 2) {
        let start = ((i as f64 * bucket_size) as usize) + 1;
        let end = (((i + 1) as f64 * bucket_size) as usize + 1).min(n - 1);

        if start >= end {
            continue;
        }

        // Find point with largest triangle area using bucket boundaries
        let mut max_area = -1.0;
        let mut max_idx = start;

        let first_x = x[start];
        let first_y = y[start];
        let last_x = x[end - 1];
        let last_y = y[end - 1];

        for j in start..end {
            let area = ((first_x - last_x) * (y[j] - first_y)
                - (first_x - x[j]) * (last_y - first_y))
                .abs();
            if area > max_area {
                max_area = area;
                max_idx = j;
            }
        }

        result.push(x[max_idx]);
        result.push(y[max_idx]);
    }

    // Always include last point
    result.push(x[n - 1]);
    result.push(y[n - 1]);

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ltob_basic() {
        let x: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let y: Vec<f64> = x.iter().map(|&xi| (xi * 0.1).sin()).collect();

        let result = ltob(&x, &y, 20);
        assert_eq!(result.len(), 40); // 20 points * 2
        assert_eq!(result[0], 0.0);
        assert_eq!(result[38], 99.0);
    }
}
