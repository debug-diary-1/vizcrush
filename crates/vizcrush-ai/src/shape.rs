use wasm_bindgen::prelude::*;

fn mean(data: &[f64]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    data.iter().sum::<f64>() / data.len() as f64
}

fn stddev(data: &[f64], m: f64) -> f64 {
    if data.len() < 2 {
        return 0.0;
    }
    let variance = data.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (data.len() - 1) as f64;
    variance.sqrt()
}

/// Compute a fixed-length feature vector describing the "shape" of the data.
///
/// The vector encodes: normalized histogram bins, trend coefficient, volatility,
/// spike ratio, and autocorrelation at multiple lags. The result can be compared
/// using cosine similarity to find "charts that look like this."
#[wasm_bindgen]
pub fn compute_shape_vector(y: &[f64], dimensions: usize) -> Vec<f64> {
    if y.is_empty() || dimensions == 0 {
        return vec![0.0; dimensions];
    }

    let n = y.len();
    let m = mean(y);
    let sd = stddev(y, m);

    // Normalize data to [0, 1]
    let y_min = y.iter().cloned().fold(f64::INFINITY, f64::min);
    let y_max = y.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let y_range = y_max - y_min;

    let normalized: Vec<f64> = if y_range > f64::EPSILON {
        y.iter().map(|v| (v - y_min) / y_range).collect()
    } else {
        vec![0.5; n]
    };

    let mut features = Vec::with_capacity(dimensions);

    // Feature budget allocation:
    // ~25% histogram, ~37% derivative histogram, ~12% stats, ~25% autocorrelation
    let hist_bins = dimensions / 4;
    let deriv_bins = (dimensions * 3) / 8;
    let stat_features = 4; // trend, volatility, spike_ratio, smoothness
    let auto_lags = dimensions.saturating_sub(hist_bins + deriv_bins + stat_features);

    // 1. Normalized histogram bins (value distribution)
    let mut histogram = vec![0.0f64; hist_bins];
    if hist_bins > 0 {
        for &v in &normalized {
            let bin = (v * hist_bins as f64).floor() as usize;
            let bin = bin.min(hist_bins - 1);
            histogram[bin] += 1.0;
        }
        let total: f64 = histogram.iter().sum();
        if total > 0.0 {
            for h in &mut histogram {
                *h /= total;
            }
        }
    }
    features.extend_from_slice(&histogram);

    // 2. Derivative histogram (captures shape transitions - key differentiator)
    let derivatives: Vec<f64> = if n > 1 {
        normalized.windows(2).map(|w| w[1] - w[0]).collect()
    } else {
        vec![0.0]
    };
    let mut deriv_hist = vec![0.0f64; deriv_bins];
    if deriv_bins > 0 && !derivatives.is_empty() {
        let d_min = derivatives.iter().cloned().fold(f64::INFINITY, f64::min);
        let d_max = derivatives
            .iter()
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);
        let d_range = d_max - d_min;
        for &d in &derivatives {
            let norm_d = if d_range > f64::EPSILON {
                (d - d_min) / d_range
            } else {
                0.5
            };
            let bin = (norm_d * deriv_bins as f64).floor() as usize;
            let bin = bin.min(deriv_bins - 1);
            deriv_hist[bin] += 1.0;
        }
        let total: f64 = deriv_hist.iter().sum();
        if total > 0.0 {
            for h in &mut deriv_hist {
                *h /= total;
            }
        }
    }
    features.extend_from_slice(&deriv_hist);

    // 3. Trend coefficient (slope of linear regression, normalized)
    let trend = if n > 1 && sd > f64::EPSILON {
        let x_mean = (n - 1) as f64 / 2.0;
        let num: f64 = (0..n).map(|i| (i as f64 - x_mean) * (y[i] - m)).sum();
        let den: f64 = (0..n).map(|i| (i as f64 - x_mean).powi(2)).sum();
        if den.abs() > f64::EPSILON {
            (num / den / sd).tanh()
        } else {
            0.0
        }
    } else {
        0.0
    };
    features.push((trend + 1.0) / 2.0);

    // 4. Volatility (coefficient of variation, normalized)
    let volatility = if m.abs() > f64::EPSILON {
        (sd / m.abs()).tanh()
    } else if sd > f64::EPSILON {
        1.0
    } else {
        0.0
    };
    features.push(volatility);

    // 5. Spike ratio
    let spike_count = if sd > f64::EPSILON {
        y.iter().filter(|v| (*v - m).abs() > 2.0 * sd).count()
    } else {
        0
    };
    features.push(spike_count as f64 / n as f64);

    // 6. Smoothness: mean absolute second derivative (captures jaggedness vs smoothness)
    let smoothness = if n > 2 {
        let second_derivs: f64 = (1..n - 1)
            .map(|i| (normalized[i + 1] - 2.0 * normalized[i] + normalized[i - 1]).abs())
            .sum();
        let avg = second_derivs / (n - 2) as f64;
        // Invert and normalize so smooth=1.0, jagged=0.0
        1.0 / (1.0 + avg * 100.0)
    } else {
        0.5
    };
    features.push(smoothness);

    // 7. Autocorrelation at multiple lags (kept as signed values for discrimination)
    let variance: f64 = y.iter().map(|v| (v - m).powi(2)).sum();
    for lag_idx in 0..auto_lags {
        let lag = ((lag_idx + 1) as f64 / auto_lags as f64 * (n / 4) as f64).ceil() as usize;
        let lag = lag.min(n - 1).max(1);

        let corr = if variance > f64::EPSILON {
            (0..n - lag)
                .map(|i| (y[i] - m) * (y[i + lag] - m))
                .sum::<f64>()
                / variance
        } else {
            0.0
        };
        // Use absolute value so cosine similarity works well (all positive),
        // but preserve magnitude differences. Periodic signals will have high
        // autocorrelation at harmonic lags; noise will have near-zero.
        features.push(corr.abs());
    }

    // Pad or truncate to exact dimensions
    features.resize(dimensions, 0.0);
    features
}

/// Compute cosine similarity between two shape vectors.
///
/// Returns a value from 0.0 (completely different) to 1.0 (identical shape).
#[wasm_bindgen]
pub fn shape_similarity(a: &[f64], b: &[f64]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let dot: f64 = a.iter().zip(b.iter()).map(|(ai, bi)| ai * bi).sum();
    let mag_a: f64 = a.iter().map(|ai| ai * ai).sum::<f64>().sqrt();
    let mag_b: f64 = b.iter().map(|bi| bi * bi).sum::<f64>().sqrt();

    if mag_a < f64::EPSILON || mag_b < f64::EPSILON {
        return 0.0;
    }

    let cosine = dot / (mag_a * mag_b);
    // Clamp to [0, 1] (cosine similarity can be negative, but we define 0 as floor)
    cosine.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn test_shape_similar() {
        // Two sine waves with different phase but same shape
        let y1: Vec<f64> = (0..500)
            .map(|i| (2.0 * PI * i as f64 / 100.0).sin())
            .collect();
        let y2: Vec<f64> = (0..500)
            .map(|i| (2.0 * PI * i as f64 / 100.0 + 0.5).sin())
            .collect();

        let v1 = compute_shape_vector(&y1, 16);
        let v2 = compute_shape_vector(&y2, 16);
        let sim = shape_similarity(&v1, &v2);

        assert!(
            sim > 0.9,
            "Similar sine waves should have similarity > 0.9, got: {}",
            sim
        );
    }

    #[test]
    fn test_shape_different() {
        // Sine wave vs sawtooth (very different derivative profiles)
        let y_sine: Vec<f64> = (0..500)
            .map(|i| (2.0 * PI * i as f64 / 100.0).sin())
            .collect();
        // Random-ish noisy data (completely different shape)
        let y_noise: Vec<f64> = (0..500)
            .map(|i| {
                // Deterministic pseudo-random using simple hash
                let x = (i as f64 * 127.1 + 311.7).sin() * 43758.5453;
                x - x.floor()
            })
            .collect();

        let v1 = compute_shape_vector(&y_sine, 32);
        let v2 = compute_shape_vector(&y_noise, 32);
        let sim = shape_similarity(&v1, &v2);

        assert!(
            sim < 0.6,
            "Sine vs noise should have similarity < 0.6, got: {}",
            sim
        );
    }

    #[test]
    fn test_shape_vector_length() {
        let y: Vec<f64> = (0..100).map(|i| i as f64).collect();

        let v16 = compute_shape_vector(&y, 16);
        assert_eq!(v16.len(), 16, "Shape vector should have 16 dimensions");

        let v32 = compute_shape_vector(&y, 32);
        assert_eq!(v32.len(), 32, "Shape vector should have 32 dimensions");
    }
}
