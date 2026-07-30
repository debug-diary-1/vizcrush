use wasm_bindgen::prelude::*;

/// Logarithm transform with arbitrary base.
///
/// Computes log_base(v) for each element. Non-finite values and
/// values <= 0 produce NaN.
///
/// # Arguments
/// * `data` - Input array.
/// * `base` - Logarithm base (e.g. 2.0, 10.0, E).
///
/// # Returns
/// Transformed array.
#[wasm_bindgen]
pub fn log_transform(data: &[f64], base: f64) -> Vec<f64> {
    let ln_base = base.ln();
    data.iter()
        .map(|&v| {
            if !v.is_finite() || v <= 0.0 {
                f64::NAN
            } else {
                v.ln() / ln_base
            }
        })
        .collect()
}

/// Natural logarithm transform.
///
/// Computes ln(v) for each element. Non-finite values and
/// values <= 0 produce NaN.
///
/// # Arguments
/// * `data` - Input array.
///
/// # Returns
/// Transformed array.
#[wasm_bindgen]
pub fn ln_transform(data: &[f64]) -> Vec<f64> {
    data.iter()
        .map(|&v| {
            if !v.is_finite() || v <= 0.0 {
                f64::NAN
            } else {
                v.ln()
            }
        })
        .collect()
}

/// Base-10 logarithm transform.
///
/// Computes log10(v) for each element. Non-finite values and
/// values <= 0 produce NaN.
///
/// # Arguments
/// * `data` - Input array.
///
/// # Returns
/// Transformed array.
#[wasm_bindgen]
pub fn log10_transform(data: &[f64]) -> Vec<f64> {
    data.iter()
        .map(|&v| {
            if !v.is_finite() || v <= 0.0 {
                f64::NAN
            } else {
                v.log10()
            }
        })
        .collect()
}

/// Power transform.
///
/// Computes v^exponent for each element. Non-finite values produce NaN.
///
/// # Arguments
/// * `data` - Input array.
/// * `exponent` - The power to raise each element to.
///
/// # Returns
/// Transformed array.
#[wasm_bindgen]
pub fn power_transform(data: &[f64], exponent: f64) -> Vec<f64> {
    data.iter()
        .map(|&v| {
            if !v.is_finite() {
                f64::NAN
            } else {
                v.powf(exponent)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log10_basic() {
        let data = vec![1.0, 10.0, 100.0, 1000.0];
        let result = log10_transform(&data);
        assert_eq!(result, vec![0.0, 1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_log_base2() {
        let data = vec![1.0, 2.0, 4.0, 8.0];
        let result = log_transform(&data, 2.0);
        assert_eq!(result, vec![0.0, 1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_ln_transform() {
        let data = vec![1.0, std::f64::consts::E];
        let result = ln_transform(&data);
        assert!((result[0] - 0.0).abs() < 1e-12);
        assert!((result[1] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn test_log_of_one_is_zero() {
        // log_b(1) = 0 for any base
        assert_eq!(log_transform(&[1.0], 2.0)[0], 0.0);
        assert_eq!(log_transform(&[1.0], 10.0)[0], 0.0);
        assert_eq!(ln_transform(&[1.0])[0], 0.0);
        assert_eq!(log10_transform(&[1.0])[0], 0.0);
    }

    #[test]
    fn test_log_negative_and_zero_produce_nan() {
        let data = vec![-5.0, 0.0, -0.0];
        let result = log10_transform(&data);
        assert!(result.iter().all(|v| v.is_nan()));

        let result2 = ln_transform(&data);
        assert!(result2.iter().all(|v| v.is_nan()));

        let result3 = log_transform(&data, 2.0);
        assert!(result3.iter().all(|v| v.is_nan()));
    }

    #[test]
    fn test_log_nan_passthrough() {
        let data = vec![f64::NAN, f64::INFINITY, f64::NEG_INFINITY];
        let result = log10_transform(&data);
        assert!(result.iter().all(|v| v.is_nan()));
    }

    #[test]
    fn test_log_empty() {
        let result = log10_transform(&[]);
        assert!(result.is_empty());
        let result = ln_transform(&[]);
        assert!(result.is_empty());
        let result = log_transform(&[], 2.0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_power_square() {
        let data = vec![1.0, 2.0, 3.0, -2.0];
        let result = power_transform(&data, 2.0);
        assert_eq!(result, vec![1.0, 4.0, 9.0, 4.0]);
    }

    #[test]
    fn test_power_sqrt() {
        let data = vec![0.0, 1.0, 4.0, 9.0];
        let result = power_transform(&data, 0.5);
        assert!((result[0] - 0.0).abs() < 1e-12);
        assert!((result[1] - 1.0).abs() < 1e-12);
        assert!((result[2] - 2.0).abs() < 1e-12);
        assert!((result[3] - 3.0).abs() < 1e-12);
    }

    #[test]
    fn test_power_identity() {
        let data = vec![2.0, 5.0, 100.0];
        let result = power_transform(&data, 1.0);
        assert_eq!(result, vec![2.0, 5.0, 100.0]);
    }

    #[test]
    fn test_power_nan_passthrough() {
        let data = vec![f64::NAN, f64::INFINITY];
        let result = power_transform(&data, 2.0);
        assert!(result.iter().all(|v| v.is_nan()));
    }

    #[test]
    fn test_power_empty() {
        let result = power_transform(&[], 2.0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_log_large_scale() {
        let n = 100_000;
        let data: Vec<f64> = (1..=n).map(|i| i as f64).collect();
        let result = log10_transform(&data);
        assert_eq!(result.len(), n);
        assert!((result[0] - 0.0).abs() < 1e-12); // log10(1)
        assert!((result[9] - 1.0).abs() < 1e-12); // log10(10)
        assert!((result[99] - 2.0).abs() < 1e-12); // log10(100)
    }

    #[test]
    fn test_power_large_scale() {
        let n = 100_000;
        let data: Vec<f64> = (0..n).map(|i| i as f64).collect();
        let result = power_transform(&data, 2.0);
        assert_eq!(result.len(), n);
        assert_eq!(result[0], 0.0);
        assert_eq!(result[1], 1.0);
        assert_eq!(result[10], 100.0);
    }
}
