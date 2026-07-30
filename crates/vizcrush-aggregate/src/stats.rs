use wasm_bindgen::prelude::*;

/// Compute summary statistics over a numeric array in a single pass.
///
/// Uses Welford's online algorithm for numerically stable variance computation.
/// Min/max is tracked inline in the same pass — no separate scan.
///
/// Note: this is a scalar single pass. The `is_finite` skip and the min/max
/// branches keep the loop from autovectorizing, and benchmarks show no
/// difference between `+simd128` and scalar builds here (see ADR 0002). Cost
/// is dominated by the one sequential pass over the data.
///
/// # Returns
/// [count, min, max, mean, std_dev, variance]
#[wasm_bindgen]
pub fn compute_stats(data: &[f64]) -> Vec<f64> {
    if data.is_empty() {
        return vec![0.0, f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN];
    }

    // Single-pass: Welford + inline min/max
    let mut count = 0u64;
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut mean = 0.0;
    let mut m2 = 0.0;

    for &v in data {
        if !v.is_finite() {
            continue;
        }
        count += 1;
        // Min/max tracked inline — no second pass
        if v < min {
            min = v;
        }
        if v > max {
            max = v;
        }
        // Welford's online update
        let delta = v - mean;
        mean += delta / count as f64;
        let delta2 = v - mean;
        m2 += delta * delta2;
    }

    if count == 0 {
        return vec![0.0, f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN];
    }

    let variance = if count > 1 {
        m2 / (count - 1) as f64
    } else {
        0.0
    };
    let std_dev = variance.sqrt();

    vec![count as f64, min, max, mean, std_dev, variance]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stats_basic() {
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = compute_stats(&data);
        assert_eq!(result[0], 5.0); // count
        assert_eq!(result[1], 1.0); // min
        assert_eq!(result[2], 5.0); // max
        assert_eq!(result[3], 3.0); // mean
        assert!((result[4] - 1.5811388300841898).abs() < 1e-10); // std_dev
    }

    #[test]
    fn test_stats_empty() {
        let result = compute_stats(&[]);
        assert_eq!(result[0], 0.0);
        assert!(result[1].is_nan());
    }

    #[test]
    fn test_stats_single() {
        let result = compute_stats(&[42.0]);
        assert_eq!(result[0], 1.0);
        assert_eq!(result[1], 42.0); // min
        assert_eq!(result[2], 42.0); // max
        assert_eq!(result[3], 42.0); // mean
        assert_eq!(result[4], 0.0); // std_dev
    }

    #[test]
    fn test_stats_with_nan() {
        let data = vec![1.0, f64::NAN, 3.0, f64::INFINITY, 5.0];
        let result = compute_stats(&data);
        assert_eq!(result[0], 3.0); // count (only finite values)
        assert_eq!(result[1], 1.0); // min
        assert_eq!(result[2], 5.0); // max
        assert_eq!(result[3], 3.0); // mean of [1, 3, 5]
    }

    #[test]
    fn test_stats_large() {
        let data: Vec<f64> = (0..10_000).map(|i| i as f64).collect();
        let result = compute_stats(&data);
        assert_eq!(result[0], 10_000.0);
        assert_eq!(result[1], 0.0);
        assert_eq!(result[2], 9999.0);
        assert!((result[3] - 4999.5).abs() < 0.01);
    }
}
