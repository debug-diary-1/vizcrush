use serde::Serialize;
use wasm_bindgen::prelude::*;

fn median_sorted(sorted: &[f64]) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return 0.0;
    }
    if n.is_multiple_of(2) {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    } else {
        sorted[n / 2]
    }
}

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

fn skewness(data: &[f64], m: f64, sd: f64) -> f64 {
    if data.len() < 3 || sd < f64::EPSILON {
        return 0.0;
    }
    let n = data.len() as f64;
    let sum_cubed: f64 = data.iter().map(|v| ((v - m) / sd).powi(3)).sum();
    sum_cubed / n
}

fn kurtosis(data: &[f64], m: f64, sd: f64) -> f64 {
    if data.len() < 4 || sd < f64::EPSILON {
        return 0.0;
    }
    let n = data.len() as f64;
    let sum_fourth: f64 = data.iter().map(|v| ((v - m) / sd).powi(4)).sum();
    sum_fourth / n - 3.0 // excess kurtosis
}

/// Simple linear regression: returns (slope, intercept).
fn linear_regression(x: &[f64], y: &[f64]) -> (f64, f64) {
    let n = x.len() as f64;
    if n < 2.0 {
        return (0.0, 0.0);
    }
    let mx = mean(x);
    let my = mean(y);
    let num: f64 = x
        .iter()
        .zip(y.iter())
        .map(|(xi, yi)| (xi - mx) * (yi - my))
        .sum();
    let den: f64 = x.iter().map(|xi| (xi - mx).powi(2)).sum();
    if den.abs() < f64::EPSILON {
        return (0.0, my);
    }
    let slope = num / den;
    let intercept = my - slope * mx;
    (slope, intercept)
}

/// Estimate periodicity using autocorrelation. Returns the dominant period length, or 0 if none.
fn detect_periodicity(y: &[f64]) -> usize {
    let n = y.len();
    if n < 10 {
        return 0;
    }
    let m = mean(y);
    let var: f64 = y.iter().map(|v| (v - m).powi(2)).sum();
    if var < f64::EPSILON {
        return 0;
    }

    let max_lag = n / 2;
    let mut best_lag = 0;
    let mut prev_corr = 1.0_f64;
    let mut descending = false;

    for lag in 1..max_lag {
        let corr: f64 = (0..n - lag)
            .map(|i| (y[i] - m) * (y[i + lag] - m))
            .sum::<f64>()
            / var;

        // Look for first peak after initial descent
        if corr < prev_corr {
            descending = true;
        } else if descending && corr > 0.3 {
            best_lag = lag;
            break; // Take the first significant peak
        }
        prev_corr = corr;
    }

    best_lag
}

#[derive(Serialize)]
struct RangeInfo {
    min: f64,
    max: f64,
    span: f64,
}

#[derive(Serialize)]
struct DistributionInfo {
    mean: f64,
    median: f64,
    stddev: f64,
    skewness: f64,
    kurtosis: f64,
}

#[derive(Serialize)]
struct TimeseriesSummary {
    trend: String,
    trend_slope: f64,
    range: RangeInfo,
    distribution: DistributionInfo,
    spikes: usize,
    periodicity: usize,
    summary: String,
}

/// Summarize a time-series dataset. Returns a JSON string with trend, distribution,
/// spike count, periodicity, and a human-readable summary.
#[wasm_bindgen]
pub fn summarize_timeseries(x: &[f64], y: &[f64]) -> String {
    let n = y.len();
    if n == 0 {
        return "{}".to_string();
    }

    let (slope, _) = linear_regression(x, y);
    let m = mean(y);
    let sd = stddev(y, m);

    let mut sorted_y = y.to_vec();
    sorted_y.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let med = median_sorted(&sorted_y);

    let y_min = sorted_y[0];
    let y_max = sorted_y[n - 1];

    // Count spikes: values > 2 stddev from mean
    let spikes = if sd > f64::EPSILON {
        y.iter().filter(|v| (*v - m).abs() > 2.0 * sd).count()
    } else {
        0
    };

    // Determine trend using R-squared of linear fit
    let spike_ratio = spikes as f64 / n as f64;

    // Compute R-squared to measure how well a linear trend explains the data
    let ss_res: f64 = x
        .iter()
        .zip(y.iter())
        .map(|(xi, yi)| {
            let predicted = slope * xi + (m - slope * mean(x));
            (yi - predicted).powi(2)
        })
        .sum();
    let ss_tot: f64 = y.iter().map(|yi| (yi - m).powi(2)).sum();
    let r_squared = if ss_tot > f64::EPSILON {
        1.0 - ss_res / ss_tot
    } else {
        0.0
    };

    let trend = if spike_ratio > 0.1 {
        "volatile".to_string()
    } else if r_squared > 0.3 && slope.abs() > f64::EPSILON {
        if slope > 0.0 {
            "increasing".to_string()
        } else {
            "decreasing".to_string()
        }
    } else {
        "stable".to_string()
    };

    let sk = skewness(y, m, sd);
    let kt = kurtosis(y, m, sd);
    let period = detect_periodicity(y);

    let volatility_desc = if sd > m.abs() * 0.5 {
        "High"
    } else if sd > m.abs() * 0.2 {
        "Moderate"
    } else {
        "Low"
    };

    let trend_desc = match trend.as_str() {
        "increasing" => "Upward trend",
        "decreasing" => "Downward trend",
        "volatile" => "Volatile pattern",
        _ => "Stable trend",
    };

    let summary_text = format!(
        "{} with {} spike events. Mean {:.1}, range [{:.1}, {:.1}]. {} volatility (stddev {:.1}).",
        trend_desc, spikes, m, y_min, y_max, volatility_desc, sd
    );

    let result = TimeseriesSummary {
        trend,
        trend_slope: slope,
        range: RangeInfo {
            min: y_min,
            max: y_max,
            span: y_max - y_min,
        },
        distribution: DistributionInfo {
            mean: m,
            median: med,
            stddev: sd,
            skewness: sk,
            kurtosis: kt,
        },
        spikes,
        periodicity: period,
        summary: summary_text,
    };

    serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

fn pearson_correlation(x: &[f64], y: &[f64]) -> f64 {
    let n = x.len();
    if n < 2 {
        return 0.0;
    }
    let mx = mean(x);
    let my = mean(y);
    let num: f64 = x
        .iter()
        .zip(y.iter())
        .map(|(xi, yi)| (xi - mx) * (yi - my))
        .sum();
    let den_x: f64 = x.iter().map(|xi| (xi - mx).powi(2)).sum::<f64>().sqrt();
    let den_y: f64 = y.iter().map(|yi| (yi - my).powi(2)).sum::<f64>().sqrt();
    if den_x < f64::EPSILON || den_y < f64::EPSILON {
        return 0.0;
    }
    num / (den_x * den_y)
}

/// Estimate cluster count using grid-based density analysis.
fn estimate_clusters(x: &[f64], y: &[f64]) -> usize {
    let n = x.len();
    if n < 4 {
        return 1;
    }

    let x_min = x.iter().cloned().fold(f64::INFINITY, f64::min);
    let x_max = x.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let y_min = y.iter().cloned().fold(f64::INFINITY, f64::min);
    let y_max = y.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

    let x_range = x_max - x_min;
    let y_range = y_max - y_min;

    if x_range < f64::EPSILON || y_range < f64::EPSILON {
        return 1;
    }

    // Use a coarse grid to find dense regions, then count connected components
    let grid_size = 10usize;
    let mut grid = vec![vec![0usize; grid_size]; grid_size];

    for i in 0..n {
        let gx = ((x[i] - x_min) / x_range * (grid_size - 1) as f64).round() as usize;
        let gy = ((y[i] - y_min) / y_range * (grid_size - 1) as f64).round() as usize;
        let gx = gx.min(grid_size - 1);
        let gy = gy.min(grid_size - 1);
        grid[gx][gy] += 1;
    }

    // Threshold: cells with more than average points are "occupied"
    let total_occupied: usize = grid
        .iter()
        .flat_map(|r| r.iter())
        .filter(|&&c| c > 0)
        .count();
    if total_occupied == 0 {
        return 1;
    }
    let avg_per_cell = n / total_occupied.max(1);
    let threshold = (avg_per_cell / 2).max(1);

    // Count connected components using flood fill on occupied cells
    let mut visited = vec![vec![false; grid_size]; grid_size];
    let mut clusters = 0;

    for i in 0..grid_size {
        for j in 0..grid_size {
            if grid[i][j] >= threshold && !visited[i][j] {
                clusters += 1;
                // Flood fill
                let mut stack = vec![(i, j)];
                while let Some((ci, cj)) = stack.pop() {
                    if visited[ci][cj] {
                        continue;
                    }
                    visited[ci][cj] = true;
                    // Check 8 neighbors
                    for di in -1i32..=1 {
                        for dj in -1i32..=1 {
                            if di == 0 && dj == 0 {
                                continue;
                            }
                            let ni = ci as i32 + di;
                            let nj = cj as i32 + dj;
                            if ni >= 0 && ni < grid_size as i32 && nj >= 0 && nj < grid_size as i32
                            {
                                let ni = ni as usize;
                                let nj = nj as usize;
                                if grid[ni][nj] >= threshold && !visited[ni][nj] {
                                    stack.push((ni, nj));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    clusters.max(1)
}

#[derive(Serialize)]
struct DensityHotspot {
    x_center: f64,
    y_center: f64,
    count: usize,
}

#[derive(Serialize)]
struct ScatterSummary {
    correlation: f64,
    clusters: usize,
    density_hotspots: Vec<DensityHotspot>,
    outlier_count: usize,
    summary: String,
}

/// Summarize a scatter plot dataset. Returns a JSON string with correlation,
/// cluster count, density hotspots, outlier count, and a human-readable summary.
#[wasm_bindgen]
pub fn summarize_scatter(x: &[f64], y: &[f64]) -> String {
    let n = x.len();
    if n == 0 {
        return "{}".to_string();
    }

    let corr = pearson_correlation(x, y);
    let clusters = estimate_clusters(x, y);

    let mx = mean(x);
    let my = mean(y);
    let sx = stddev(x, mx);
    let sy = stddev(y, my);

    // Count outliers: beyond 2 stddev in BOTH dimensions
    let outlier_count = if sx > f64::EPSILON && sy > f64::EPSILON {
        (0..n)
            .filter(|&i| (x[i] - mx).abs() > 2.0 * sx && (y[i] - my).abs() > 2.0 * sy)
            .count()
    } else {
        0
    };

    // Find density hotspots using a simple grid approach
    let hotspots = compute_density_hotspots(x, y, 3);

    let corr_desc = if corr.abs() > 0.7 {
        if corr > 0.0 {
            "strong positive"
        } else {
            "strong negative"
        }
    } else if corr.abs() > 0.3 {
        if corr > 0.0 {
            "moderate positive"
        } else {
            "moderate negative"
        }
    } else {
        "weak"
    };

    let summary_text = format!(
        "{} correlation (r={:.3}). {} estimated clusters, {} outliers detected.",
        corr_desc
            .chars()
            .next()
            .unwrap()
            .to_uppercase()
            .collect::<String>()
            + &corr_desc[1..],
        corr,
        clusters,
        outlier_count
    );

    let result = ScatterSummary {
        correlation: corr,
        clusters,
        density_hotspots: hotspots,
        outlier_count,
        summary: summary_text,
    };

    serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

fn compute_density_hotspots(x: &[f64], y: &[f64], top_k: usize) -> Vec<DensityHotspot> {
    let n = x.len();
    if n == 0 {
        return Vec::new();
    }

    let x_min = x.iter().cloned().fold(f64::INFINITY, f64::min);
    let x_max = x.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let y_min = y.iter().cloned().fold(f64::INFINITY, f64::min);
    let y_max = y.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

    let x_range = x_max - x_min;
    let y_range = y_max - y_min;

    if x_range < f64::EPSILON || y_range < f64::EPSILON {
        return vec![DensityHotspot {
            x_center: mean(x),
            y_center: mean(y),
            count: n,
        }];
    }

    // Use a 10x10 grid
    let grid_size = 10usize;
    let mut grid = vec![vec![(0usize, 0.0f64, 0.0f64); grid_size]; grid_size];

    for i in 0..n {
        let gx = ((x[i] - x_min) / x_range * (grid_size - 1) as f64).round() as usize;
        let gy = ((y[i] - y_min) / y_range * (grid_size - 1) as f64).round() as usize;
        let gx = gx.min(grid_size - 1);
        let gy = gy.min(grid_size - 1);
        grid[gx][gy].0 += 1;
        grid[gx][gy].1 += x[i];
        grid[gx][gy].2 += y[i];
    }

    // Flatten and sort by count
    let mut cells: Vec<(usize, f64, f64)> = Vec::new();
    for row in &grid {
        for &(count, sum_x, sum_y) in row {
            if count > 0 {
                cells.push((count, sum_x / count as f64, sum_y / count as f64));
            }
        }
    }
    cells.sort_by_key(|b| std::cmp::Reverse(b.0));

    cells
        .into_iter()
        .take(top_k)
        .map(|(count, xc, yc)| DensityHotspot {
            x_center: xc,
            y_center: yc,
            count,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_summarize_uptrend() {
        let x: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let y: Vec<f64> = x.iter().map(|xi| xi * 2.0 + 5.0).collect();

        let json = summarize_timeseries(&x, &y);
        assert!(
            json.contains("\"trend\":\"increasing\""),
            "Expected increasing trend, got: {}",
            json
        );
    }

    #[test]
    fn test_summarize_scatter() {
        // Create 3 clusters
        let mut x = Vec::new();
        let mut y = Vec::new();
        for i in 0..30 {
            // Cluster 1 around (0, 0)
            x.push(0.0 + (i as f64) * 0.01);
            y.push(0.0 + (i as f64) * 0.01);
            // Cluster 2 around (10, 10)
            x.push(10.0 + (i as f64) * 0.01);
            y.push(10.0 + (i as f64) * 0.01);
            // Cluster 3 around (0, 10)
            x.push(0.0 + (i as f64) * 0.01);
            y.push(10.0 + (i as f64) * 0.01);
        }

        let json = summarize_scatter(&x, &y);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        let clusters = parsed["clusters"].as_u64().unwrap();
        assert!(
            clusters >= 2,
            "Should detect multiple clusters, got: {}",
            clusters
        );
    }

    #[test]
    fn test_summarize_volatile() {
        let x: Vec<f64> = (0..200).map(|i| i as f64).collect();
        // Create volatile data with many spikes
        let y: Vec<f64> = (0..200)
            .map(|i| {
                if i % 5 == 0 {
                    100.0 * if i % 10 == 0 { 1.0 } else { -1.0 }
                } else {
                    0.0
                }
            })
            .collect();

        let json = summarize_timeseries(&x, &y);
        assert!(
            json.contains("\"trend\":\"volatile\""),
            "Expected volatile trend, got: {}",
            json
        );
    }
}
