use vizcrush_core::find_finite_range;
use wasm_bindgen::prelude::*;

/// 1D histogram binning.
///
/// Counts the number of values falling into each of `num_bins` equally-spaced bins.
///
/// # Arguments
/// * `data` - Input values.
/// * `num_bins` - Number of bins.
/// * `range_min` - Minimum range value (NaN = auto-detect from data).
/// * `range_max` - Maximum range value (NaN = auto-detect from data).
///
/// # Returns
/// Interleaved [count0, count1, ..., edge0, edge1, ...edgeN] where edges has num_bins+1 elements.
#[wasm_bindgen]
pub fn histogram(data: &[f64], num_bins: usize, range_min: f64, range_max: f64) -> Vec<f64> {
    if data.is_empty() || num_bins == 0 {
        return vec![];
    }

    let (min_val, max_val) = if range_min.is_nan() || range_max.is_nan() {
        find_finite_range(data)
    } else {
        (range_min, range_max)
    };

    if !min_val.is_finite() || !max_val.is_finite() || min_val >= max_val {
        return vec![];
    }

    let bin_width = (max_val - min_val) / num_bins as f64;
    let mut counts = vec![0u32; num_bins];

    for &v in data {
        if !v.is_finite() {
            continue;
        }
        let mut bin = ((v - min_val) / bin_width) as usize;
        if bin >= num_bins {
            bin = num_bins - 1;
        }
        counts[bin] += 1;
    }

    // Pack result: counts as f64, then edges
    let mut result = Vec::with_capacity(num_bins + num_bins + 1);
    for &c in &counts {
        result.push(c as f64);
    }
    for i in 0..=num_bins {
        result.push(min_val + i as f64 * bin_width);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_histogram_uniform() {
        let data: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let result = histogram(&data, 10, f64::NAN, f64::NAN);
        // 10 counts + 11 edges = 21
        assert_eq!(result.len(), 21);
        // Roughly 10 per bin
        let total: f64 = result[0..10].iter().sum();
        assert_eq!(total, 100.0);
    }

    #[test]
    fn test_histogram_explicit_range() {
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = histogram(&data, 5, 0.0, 10.0);
        assert_eq!(result.len(), 5 + 6); // 5 counts + 6 edges
    }

    #[test]
    fn test_histogram_empty() {
        let result = histogram(&[], 10, f64::NAN, f64::NAN);
        assert!(result.is_empty());
    }
}
