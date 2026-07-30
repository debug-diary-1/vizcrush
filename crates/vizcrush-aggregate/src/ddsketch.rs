use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

/// DDSketch: relative-error quantile sketch.
///
/// Provides quantile estimates with a relative error guarantee of alpha.
/// Based on the algorithm by Masson, Rim, and Lee.
///
/// Reference: https://arxiv.org/abs/1908.10693
#[wasm_bindgen]
pub struct DDSketch {
    relative_accuracy: f64,
    gamma: f64,
    ln_gamma: f64,
    positive_buckets: BTreeMap<i32, u64>,
    negative_buckets: BTreeMap<i32, u64>,
    zero_count: u64,
    total_count: u64,
    min_val: f64,
    max_val: f64,
}

#[wasm_bindgen]
impl DDSketch {
    #[wasm_bindgen(constructor)]
    pub fn new(relative_accuracy: f64) -> Self {
        let alpha = if relative_accuracy <= 0.0 || relative_accuracy >= 1.0 {
            0.01
        } else {
            relative_accuracy
        };
        let gamma = (1.0 + alpha) / (1.0 - alpha);
        let ln_gamma = gamma.ln();
        Self {
            relative_accuracy: alpha,
            gamma,
            ln_gamma,
            positive_buckets: BTreeMap::new(),
            negative_buckets: BTreeMap::new(),
            zero_count: 0,
            total_count: 0,
            min_val: f64::INFINITY,
            max_val: f64::NEG_INFINITY,
        }
    }

    /// Add a single value.
    pub fn add(&mut self, value: f64) {
        if !value.is_finite() {
            return;
        }
        self.total_count += 1;
        if value < self.min_val {
            self.min_val = value;
        }
        if value > self.max_val {
            self.max_val = value;
        }

        if value > 0.0 {
            let idx = self.bucket_index(value);
            *self.positive_buckets.entry(idx).or_insert(0) += 1;
        } else if value < 0.0 {
            let idx = self.bucket_index(-value);
            *self.negative_buckets.entry(idx).or_insert(0) += 1;
        } else {
            self.zero_count += 1;
        }
    }

    /// Add a batch of values.
    pub fn add_batch(&mut self, values: &[f64]) {
        for &v in values {
            self.add(v);
        }
    }

    /// Estimate the value at quantile q (0.0 to 1.0).
    pub fn quantile(&self, q: f64) -> f64 {
        if self.total_count == 0 {
            return f64::NAN;
        }
        let q = q.clamp(0.0, 1.0);
        if q == 0.0 {
            return self.min_val;
        }
        if q == 1.0 {
            return self.max_val;
        }

        let rank = (q * self.total_count as f64).ceil() as u64;
        let mut running = 0u64;

        // Walk negative buckets in reverse (most negative first)
        for (&idx, &count) in self.negative_buckets.iter().rev() {
            running += count;
            if running >= rank {
                return -self.bucket_value(idx);
            }
        }

        // Zero bucket
        running += self.zero_count;
        if running >= rank {
            return 0.0;
        }

        // Walk positive buckets
        for (&idx, &count) in &self.positive_buckets {
            running += count;
            if running >= rank {
                return self.bucket_value(idx);
            }
        }

        self.max_val
    }

    /// Estimate percentiles (0-100 scale).
    pub fn percentiles(&self, pcts: &[f64]) -> Vec<f64> {
        pcts.iter().map(|&p| self.quantile(p / 100.0)).collect()
    }

    #[wasm_bindgen(getter)]
    pub fn relative_accuracy(&self) -> f64 {
        self.relative_accuracy
    }

    #[wasm_bindgen(getter)]
    pub fn count(&self) -> f64 {
        self.total_count as f64
    }

    #[wasm_bindgen(getter)]
    pub fn min(&self) -> f64 {
        self.min_val
    }

    #[wasm_bindgen(getter)]
    pub fn max(&self) -> f64 {
        self.max_val
    }
}

impl DDSketch {
    fn bucket_index(&self, v: f64) -> i32 {
        (v.ln() / self.ln_gamma).ceil() as i32
    }

    fn bucket_value(&self, idx: i32) -> f64 {
        self.gamma.powi(idx) * (2.0 / (1.0 + self.gamma))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ddsketch_basic() {
        let mut dd = DDSketch::new(0.01);
        for i in 1..=100 {
            dd.add(i as f64);
        }
        let p50 = dd.quantile(0.5);
        assert!((p50 - 50.0).abs() < 5.0, "p50 = {p50}, expected ~50");
        let p90 = dd.quantile(0.9);
        assert!((p90 - 90.0).abs() < 5.0, "p90 = {p90}, expected ~90");
    }

    #[test]
    fn test_ddsketch_empty() {
        let dd = DDSketch::new(0.01);
        assert!(dd.quantile(0.5).is_nan());
        assert_eq!(dd.count(), 0.0);
    }

    #[test]
    fn test_ddsketch_nan() {
        let mut dd = DDSketch::new(0.01);
        dd.add(f64::NAN);
        dd.add(f64::INFINITY);
        dd.add(10.0);
        assert_eq!(dd.count(), 1.0);
    }

    #[test]
    fn test_ddsketch_negative() {
        let mut dd = DDSketch::new(0.01);
        for i in -50..=50 {
            dd.add(i as f64);
        }
        assert_eq!(dd.count(), 101.0);
        assert_eq!(dd.min(), -50.0);
        assert_eq!(dd.max(), 50.0);
        let p50 = dd.quantile(0.5);
        assert!(p50.abs() < 5.0, "p50 = {p50}, expected ~0");
    }

    #[test]
    fn test_ddsketch_large() {
        let mut dd = DDSketch::new(0.01);
        for i in 1..=10_000 {
            dd.add(i as f64);
        }
        let p50 = dd.quantile(0.5);
        // With 1% relative accuracy, p50 should be within 1% of 5000
        assert!((p50 - 5000.0).abs() < 500.0, "p50 = {p50}, expected ~5000");
        let p99 = dd.quantile(0.99);
        assert!((p99 - 9900.0).abs() < 500.0, "p99 = {p99}, expected ~9900");
    }

    #[test]
    fn test_ddsketch_percentiles() {
        let mut dd = DDSketch::new(0.01);
        for i in 1..=100 {
            dd.add(i as f64);
        }
        let pcts = dd.percentiles(&[25.0, 50.0, 75.0]);
        assert_eq!(pcts.len(), 3);
        assert!((pcts[0] - 25.0).abs() < 5.0, "p25 = {}", pcts[0]);
        assert!((pcts[1] - 50.0).abs() < 5.0, "p50 = {}", pcts[1]);
        assert!((pcts[2] - 75.0).abs() < 5.0, "p75 = {}", pcts[2]);
    }
}
