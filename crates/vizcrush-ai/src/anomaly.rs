use wasm_bindgen::prelude::*;

/// Compute the median of a slice (non-destructive, allocates a sorted copy).
fn median(data: &[f64]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    let mut sorted: Vec<f64> = data.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = sorted.len();
    if n.is_multiple_of(2) {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    } else {
        sorted[n / 2]
    }
}

/// Detect anomalies in time-series data using the modified Z-score method (MAD).
///
/// Returns interleaved `[index, value, z_score, ...]` for each detected anomaly.
/// `sensitivity` controls the threshold; typical default is 3.0 (3-sigma equivalent).
#[wasm_bindgen]
pub fn detect_anomalies(y: &[f64], sensitivity: f64) -> Vec<f64> {
    if y.is_empty() {
        return Vec::new();
    }

    let med = median(y);

    // Compute absolute deviations from median
    let abs_devs: Vec<f64> = y.iter().map(|v| (v - med).abs()).collect();
    let mad = median(&abs_devs);

    // Avoid division by zero: if MAD is 0, use a tiny epsilon or flag nothing
    if mad < f64::EPSILON {
        return Vec::new();
    }

    // 0.6745 is the normal distribution constant for MAD-based Z-scores
    let consistency_constant = 0.6745;

    let mut result = Vec::new();
    for (i, &val) in y.iter().enumerate() {
        let modified_z = (val - med).abs() / (mad / consistency_constant);
        if modified_z > sensitivity {
            result.push(i as f64);
            result.push(val);
            result.push(modified_z);
        }
    }

    result
}

/// Detect changepoints in time-series data using the CUSUM (cumulative sum) method.
///
/// Returns indices where significant distribution shifts occur.
/// `min_segment` is the minimum number of points between detected changepoints (default 50).
#[wasm_bindgen]
pub fn detect_changepoints(y: &[f64], min_segment: usize) -> Vec<f64> {
    if y.len() < min_segment * 2 {
        return Vec::new();
    }

    let n = y.len();
    let global_mean: f64 = y.iter().sum::<f64>() / n as f64;
    let global_std = {
        let variance = y.iter().map(|v| (v - global_mean).powi(2)).sum::<f64>() / n as f64;
        variance.sqrt()
    };

    if global_std < f64::EPSILON {
        return Vec::new();
    }

    // Compute CUSUM
    let mut s_pos = vec![0.0f64; n];
    let mut s_neg = vec![0.0f64; n];
    // Drift parameter: half a standard deviation
    let drift = 0.5 * global_std;
    // Threshold for detecting a change
    let threshold = 4.0 * global_std;

    let mut changepoints = Vec::new();
    let mut last_cp: usize = 0;

    for i in 1..n {
        let z = y[i] - global_mean;
        s_pos[i] = (s_pos[i - 1] + z - drift).max(0.0);
        s_neg[i] = (s_neg[i - 1] - z - drift).max(0.0);

        if (s_pos[i] > threshold || s_neg[i] > threshold) && (i - last_cp) >= min_segment {
            changepoints.push(i as f64);
            // Reset CUSUM after detecting a changepoint
            s_pos[i] = 0.0;
            s_neg[i] = 0.0;
            last_cp = i;
        }
    }

    changepoints
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anomaly_spike() {
        // Normal data with clear outliers
        let mut data: Vec<f64> = (0..100).map(|i| (i as f64 * 0.1).sin()).collect();
        // Inject obvious spikes
        data[25] = 50.0;
        data[75] = -50.0;

        let result = detect_anomalies(&data, 3.0);
        // Results are interleaved [index, value, z_score, ...]
        assert!(!result.is_empty(), "Should detect anomalies");

        // Extract detected indices
        let indices: Vec<f64> = result.chunks(3).map(|c| c[0]).collect();
        assert!(indices.contains(&25.0), "Should detect spike at index 25");
        assert!(indices.contains(&75.0), "Should detect spike at index 75");
    }

    #[test]
    fn test_anomaly_no_false_positives() {
        // Smooth sinusoidal data with no outliers
        let data: Vec<f64> = (0..200).map(|i| (i as f64 * 0.05).sin()).collect();

        let result = detect_anomalies(&data, 3.5);
        assert!(result.is_empty(), "Smooth data should have no anomalies");
    }

    #[test]
    fn test_changepoint() {
        // Data that shifts mean halfway through
        let mut data = Vec::new();
        data.extend(std::iter::repeat_n(10.0, 200));
        data.extend(std::iter::repeat_n(50.0, 200));
        // Add small noise to make stats meaningful
        for (i, v) in data.iter_mut().enumerate() {
            *v += (i as f64 * 0.37).sin() * 0.5;
        }

        let cps = detect_changepoints(&data, 50);
        assert!(!cps.is_empty(), "Should detect at least one changepoint");

        // The changepoint should be near index 200
        let has_near_200 = cps.iter().any(|&cp| (cp - 200.0).abs() < 60.0);
        assert!(
            has_near_200,
            "Changepoint should be near index 200, got: {:?}",
            cps
        );
    }
}
