use wasm_bindgen::prelude::*;

/// Compute approximate percentiles using sorting.
///
/// For MVP, uses exact computation via sorting. t-digest for approximate
/// percentiles on massive arrays will be added in v0.4.
///
/// # Arguments
/// * `data` - Input values.
/// * `percentiles` - Percentile values to compute (e.g., [25, 50, 75, 95, 99]).
///
/// # Returns
/// One value per requested percentile.
#[wasm_bindgen]
pub fn compute_percentiles(data: &[f64], percentiles: &[f64]) -> Vec<f64> {
    if data.is_empty() || percentiles.is_empty() {
        return vec![f64::NAN; percentiles.len()];
    }

    // Filter out non-finite values and sort
    let mut sorted: Vec<f64> = data.iter().filter(|v| v.is_finite()).copied().collect();
    if sorted.is_empty() {
        return vec![f64::NAN; percentiles.len()];
    }
    sorted.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap());

    let n = sorted.len();
    percentiles
        .iter()
        .map(|&p| {
            let p = p.clamp(0.0, 100.0);
            let rank = (p / 100.0) * (n - 1) as f64;
            let lower = rank.floor() as usize;
            let upper = rank.ceil() as usize;
            if lower == upper || upper >= n {
                sorted[lower.min(n - 1)]
            } else {
                let frac = rank - lower as f64;
                sorted[lower] * (1.0 - frac) + sorted[upper] * frac
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_percentile_basic() {
        let data: Vec<f64> = (0..=100).map(|i| i as f64).collect();
        let result = compute_percentiles(&data, &[25.0, 50.0, 75.0]);
        assert_eq!(result.len(), 3);
        assert!((result[0] - 25.0).abs() < 0.01);
        assert!((result[1] - 50.0).abs() < 0.01);
        assert!((result[2] - 75.0).abs() < 0.01);
    }

    #[test]
    fn test_percentile_empty() {
        let result = compute_percentiles(&[], &[50.0]);
        assert!(result[0].is_nan());
    }

    #[test]
    fn test_percentile_single() {
        let result = compute_percentiles(&[42.0], &[0.0, 50.0, 100.0]);
        assert_eq!(result, vec![42.0, 42.0, 42.0]);
    }
}
