use serde::Serialize;
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

fn is_monotonically_increasing(x: &[f64]) -> bool {
    if x.len() < 2 {
        return true;
    }
    x.windows(2).all(|w| w[1] >= w[0])
}

#[derive(Serialize)]
struct StreamingConfig {
    window_size: usize,
    update_interval: usize,
}

#[derive(Serialize)]
struct AutoConfig {
    algorithm: String,
    target_points: usize,
    bin_resolution: usize,
    spatial_index: String,
    streaming: Option<StreamingConfig>,
    estimated_speedup: f64,
    reasoning: String,
}

/// Analyze data and return a JSON string with recommended vizcrush configuration.
///
/// Selects the optimal algorithm, target point count, spatial indexing strategy,
/// and streaming parameters based on data characteristics.
#[wasm_bindgen]
pub fn auto_configure(x: &[f64], y: &[f64], screen_width: usize) -> String {
    let n = x.len();
    if n == 0 {
        return "{}".to_string();
    }

    let m = mean(y);
    let sd = stddev(y, m);

    // Count spikes
    let spikes = if sd > f64::EPSILON {
        y.iter().filter(|v| (*v - m).abs() > 2.0 * sd).count()
    } else {
        0
    };
    let spike_ratio = spikes as f64 / n as f64;

    let is_timeseries = is_monotonically_increasing(x);

    // Select algorithm
    let algorithm = if !is_timeseries {
        "m4".to_string()
    } else if spike_ratio > 0.05 {
        "minmax_lttb".to_string()
    } else {
        "lttb".to_string()
    };

    // Target points: screen_width, or 2x for retina
    let target_points = screen_width;

    // Bin resolution for scatter data
    let bin_resolution = if !is_timeseries && n > 50_000 {
        // sqrt(n) capped at reasonable grid size
        let bins = (n as f64).sqrt().ceil() as usize;
        bins.clamp(50, 500)
    } else {
        0
    };

    // Spatial index recommendation
    let spatial_index = if n > 100_000 {
        "quadtree".to_string()
    } else {
        "none".to_string()
    };

    // Streaming detection: check if x values are evenly spaced (typical of streaming data)
    let streaming = if is_timeseries && n > 1000 {
        let diffs: Vec<f64> = x.windows(2).map(|w| w[1] - w[0]).collect();
        let diff_mean = mean(&diffs);
        let diff_sd = stddev(&diffs, diff_mean);
        let is_evenly_spaced = diff_sd < diff_mean * 0.1;

        if is_evenly_spaced {
            Some(StreamingConfig {
                window_size: target_points * 4,
                update_interval: target_points / 10,
            })
        } else {
            None
        }
    } else {
        None
    };

    let estimated_speedup = if target_points > 0 {
        n as f64 / target_points as f64
    } else {
        1.0
    };

    // Build reasoning
    let mut reasons = Vec::new();

    if is_timeseries {
        reasons.push("Data is monotonically increasing in x (time-series)".to_string());
    } else {
        reasons.push("Data is non-monotonic in x (scatter/general)".to_string());
    }

    if spike_ratio > 0.05 {
        reasons.push(format!(
            "{:.1}% of points are spikes, using minmax_lttb to preserve extremes",
            spike_ratio * 100.0
        ));
    }

    if bin_resolution > 0 {
        reasons.push(format!(
            "Large scatter dataset ({}pts), recommending bin2d with {} bins",
            n, bin_resolution
        ));
    }

    if spatial_index != "none" {
        reasons.push(format!(
            "Dataset has {} points, spatial indexing recommended for interactive queries",
            n
        ));
    }

    reasons.push(format!(
        "Estimated {:.1}x speedup ({} points to {})",
        estimated_speedup, n, target_points
    ));

    let result = AutoConfig {
        algorithm,
        target_points,
        bin_resolution,
        spatial_index,
        streaming,
        estimated_speedup,
        reasoning: reasons.join(". ") + ".",
    };

    serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auto_timeseries() {
        // Monotonic x → should recommend lttb
        let x: Vec<f64> = (0..1000).map(|i| i as f64).collect();
        let y: Vec<f64> = x.iter().map(|xi| (xi * 0.01).sin()).collect();

        let json = auto_configure(&x, &y, 800);
        assert!(
            json.contains("\"algorithm\":\"lttb\""),
            "Expected lttb for smooth timeseries, got: {}",
            json
        );
    }

    #[test]
    fn test_auto_spiky() {
        // Monotonic x with many spikes → should recommend minmax_lttb
        let x: Vec<f64> = (0..1000).map(|i| i as f64).collect();
        let y: Vec<f64> = (0..1000)
            .map(|i| if i % 10 == 0 { 100.0 } else { 0.0 })
            .collect();

        let json = auto_configure(&x, &y, 800);
        assert!(
            json.contains("\"algorithm\":\"minmax_lttb\""),
            "Expected minmax_lttb for spiky data, got: {}",
            json
        );
    }

    #[test]
    fn test_auto_scatter() {
        // Non-monotonic x with large dataset → should recommend bin2d (bin_resolution > 0)
        let n = 60_000;
        let x: Vec<f64> = (0..n).map(|i| ((i as f64) * 0.1).sin() * 100.0).collect();
        let y: Vec<f64> = (0..n).map(|i| ((i as f64) * 0.07).cos() * 100.0).collect();

        let json = auto_configure(&x, &y, 800);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(
            parsed["algorithm"].as_str().unwrap(),
            "m4",
            "Expected m4 for scatter data"
        );
        assert!(
            parsed["bin_resolution"].as_u64().unwrap() > 0,
            "Expected non-zero bin_resolution for large scatter"
        );
    }
}
