use wasm_bindgen::prelude::*;

/// Largest-Triangle-Three-Buckets downsampling algorithm.
///
/// Reduces a time-series dataset to `threshold` points while preserving
/// visual shape. The algorithm selects points that maximize triangle area
/// between consecutive buckets.
///
/// # Arguments
/// * `x` - Sorted x values (e.g., timestamps). Must be strictly increasing.
/// * `y` - Corresponding y values. Same length as x.
/// * `threshold` - Target number of output points. Must be >= 2.
///
/// # Returns
/// Interleaved [x0, y0, x1, y1, ...] for efficient transfer across WASM boundary.
#[wasm_bindgen]
pub fn lttb(x: &[f64], y: &[f64], threshold: usize) -> Vec<f64> {
    let n = x.len();
    assert_eq!(n, y.len(), "x and y must have equal length");

    if threshold >= n || threshold < 2 {
        // Return all points interleaved
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

    let mut prev_selected_x = x[0];
    let mut prev_selected_y = y[0];

    for i in 0..(threshold - 2) {
        // Current bucket boundaries
        let bucket_start = ((i as f64 * bucket_size) as usize) + 1;
        let bucket_end = (((i + 1) as f64 * bucket_size) as usize + 1).min(n - 1);

        // Next bucket boundaries (for averaging)
        let next_bucket_start = (((i + 1) as f64 * bucket_size) as usize) + 1;
        let next_bucket_end = (((i + 2) as f64 * bucket_size) as usize + 1).min(n);

        // Average of next bucket
        let mut avg_x = 0.0;
        let mut avg_y = 0.0;
        let next_count = next_bucket_end - next_bucket_start;
        for j in next_bucket_start..next_bucket_end {
            avg_x += x[j];
            avg_y += y[j];
        }
        if next_count > 0 {
            avg_x /= next_count as f64;
            avg_y /= next_count as f64;
        }

        // Find point in current bucket with max triangle area
        let mut max_area = -1.0;
        let mut max_idx = bucket_start;

        for j in bucket_start..bucket_end {
            // Triangle area = 0.5 * |x_a(y_b - y_c) + x_b(y_c - y_a) + x_c(y_a - y_b)|
            let area = ((prev_selected_x - avg_x) * (y[j] - prev_selected_y)
                - (prev_selected_x - x[j]) * (avg_y - prev_selected_y))
                .abs();

            if area > max_area {
                max_area = area;
                max_idx = j;
            }
        }

        result.push(x[max_idx]);
        result.push(y[max_idx]);
        prev_selected_x = x[max_idx];
        prev_selected_y = y[max_idx];
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
    fn test_lttb_basic() {
        let x: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let y: Vec<f64> = x.iter().map(|&xi| (xi * 0.1).sin()).collect();

        let result = lttb(&x, &y, 20);
        // Result is interleaved: length should be 20 * 2
        assert_eq!(result.len(), 40);
        // First point preserved
        assert_eq!(result[0], 0.0);
        // Last point preserved
        assert_eq!(result[38], 99.0);
    }

    #[test]
    fn test_lttb_threshold_exceeds_length() {
        let x = vec![1.0, 2.0, 3.0];
        let y = vec![4.0, 5.0, 6.0];
        let result = lttb(&x, &y, 10);
        assert_eq!(result.len(), 6); // all 3 points * 2
    }

    #[test]
    fn test_lttb_minimum_threshold() {
        let x: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let y: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let result = lttb(&x, &y, 2);
        assert_eq!(result.len(), 4); // 2 points * 2
        assert_eq!(result[0], 0.0);
        assert_eq!(result[2], 99.0);
    }

    #[test]
    fn test_lttb_empty() {
        let x: Vec<f64> = vec![];
        let y: Vec<f64> = vec![];
        let result = lttb(&x, &y, 10);
        assert_eq!(result.len(), 0);
    }
}
