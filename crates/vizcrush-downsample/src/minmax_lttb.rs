use wasm_bindgen::prelude::*;

/// MinMax pre-selection + LTTB downsampling.
///
/// Better for spiky data (financial, IoT sensors) because it first ensures
/// local min/max extremes are preserved, then applies LTTB for visual shape.
///
/// # Arguments
/// * `x` - Sorted x values. Must be strictly increasing.
/// * `y` - Corresponding y values. Same length as x.
/// * `threshold` - Target number of output points. Must be >= 2.
///
/// # Returns
/// Interleaved [x0, y0, x1, y1, ...] for efficient transfer.
#[wasm_bindgen]
pub fn minmax_lttb(x: &[f64], y: &[f64], threshold: usize) -> Vec<f64> {
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

    // Phase 1: MinMax pre-selection
    // Use 4x the threshold for pre-selection, then LTTB down to threshold
    let pre_threshold = (threshold * 4).min(n);

    if pre_threshold >= n {
        // Not enough data for pre-selection, fall back to pure LTTB
        return crate::lttb::lttb(x, y, threshold);
    }

    let bucket_size = (n - 2) as f64 / (pre_threshold / 2 - 1) as f64;
    let mut pre_x = Vec::with_capacity(pre_threshold);
    let mut pre_y = Vec::with_capacity(pre_threshold);

    // Always include first point
    pre_x.push(x[0]);
    pre_y.push(y[0]);

    for i in 0..(pre_threshold / 2 - 1) {
        let start = ((i as f64 * bucket_size) as usize) + 1;
        let end = (((i + 1) as f64 * bucket_size) as usize + 1).min(n - 1);

        if start >= end {
            continue;
        }

        let mut min_idx = start;
        let mut max_idx = start;
        let mut min_val = y[start];
        let mut max_val = y[start];

        #[allow(clippy::needless_range_loop)]
        for j in (start + 1)..end {
            if y[j] < min_val {
                min_val = y[j];
                min_idx = j;
            }
            if y[j] > max_val {
                max_val = y[j];
                max_idx = j;
            }
        }

        // Add min and max in order of their x position
        if min_idx <= max_idx {
            pre_x.push(x[min_idx]);
            pre_y.push(y[min_idx]);
            if min_idx != max_idx {
                pre_x.push(x[max_idx]);
                pre_y.push(y[max_idx]);
            }
        } else {
            pre_x.push(x[max_idx]);
            pre_y.push(y[max_idx]);
            pre_x.push(x[min_idx]);
            pre_y.push(y[min_idx]);
        }
    }

    // Always include last point
    pre_x.push(x[n - 1]);
    pre_y.push(y[n - 1]);

    // Phase 2: Apply LTTB on the pre-selected points
    crate::lttb::lttb(&pre_x, &pre_y, threshold)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_minmax_lttb_basic() {
        let x: Vec<f64> = (0..1000).map(|i| i as f64).collect();
        let y: Vec<f64> = x.iter().map(|&xi| (xi * 0.05).sin() * 100.0).collect();

        let result = minmax_lttb(&x, &y, 50);
        assert_eq!(result.len(), 100); // 50 points * 2 (interleaved)
        assert_eq!(result[0], 0.0); // first point
        assert_eq!(result[98], 999.0); // last point
    }

    #[test]
    fn test_minmax_preserves_spikes() {
        // Create data with a clear spike
        let mut y = vec![0.0; 100];
        y[50] = 1000.0; // spike
        let x: Vec<f64> = (0..100).map(|i| i as f64).collect();

        let result = minmax_lttb(&x, &y, 10);
        let result_y: Vec<f64> = result.iter().skip(1).step_by(2).copied().collect();
        // The spike should be preserved
        assert!(result_y.contains(&1000.0));
    }
}
