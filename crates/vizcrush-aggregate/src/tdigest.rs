use wasm_bindgen::prelude::*;

/// T-Digest: approximate quantile estimation for streaming/massive datasets.
///
/// Based on the algorithm by Ted Dunning. Provides O(1) amortized insertion
/// and accurate percentile estimates with bounded memory usage.
///
/// Reference: https://arxiv.org/abs/1902.04023
const DEFAULT_COMPRESSION: f64 = 100.0;

#[derive(Clone, Debug)]
struct Centroid {
    mean: f64,
    weight: f64,
}

#[wasm_bindgen]
pub struct TDigest {
    centroids: Vec<Centroid>,
    compression: f64,
    total_weight: f64,
    buffer: Vec<f64>,
    buffer_limit: usize,
    min_val: f64,
    max_val: f64,
    /// Toggle for alternating merge direction to prevent left-tail bias.
    reverse_compress: bool,
}

#[wasm_bindgen]
impl TDigest {
    #[wasm_bindgen(constructor)]
    pub fn new(compression: f64) -> Self {
        let comp = if compression <= 0.0 {
            DEFAULT_COMPRESSION
        } else {
            compression
        };
        Self {
            centroids: Vec::new(),
            compression: comp,
            total_weight: 0.0,
            buffer: Vec::new(),
            buffer_limit: (comp * 5.0) as usize,
            min_val: f64::INFINITY,
            max_val: f64::NEG_INFINITY,
            reverse_compress: false,
        }
    }

    /// Add a single value to the digest.
    pub fn add(&mut self, value: f64) {
        if !value.is_finite() {
            return;
        }

        if value < self.min_val {
            self.min_val = value;
        }
        if value > self.max_val {
            self.max_val = value;
        }

        self.buffer.push(value);
        if self.buffer.len() >= self.buffer_limit {
            self.flush();
        }
    }

    /// Add a batch of values.
    pub fn add_batch(&mut self, values: &[f64]) {
        for &v in values {
            self.add(v);
        }
    }

    /// Estimate the value at the given quantile (0.0 to 1.0).
    pub fn quantile(&mut self, q: f64) -> f64 {
        self.flush();

        if self.centroids.is_empty() {
            return f64::NAN;
        }

        let q = q.clamp(0.0, 1.0);

        if q == 0.0 {
            return self.min_val;
        }
        if q == 1.0 {
            return self.max_val;
        }

        let target = q * self.total_weight;
        let mut cumulative = 0.0;

        for i in 0..self.centroids.len() {
            let half = self.centroids[i].weight / 2.0;

            if cumulative + half >= target {
                // Interpolate within this centroid
                if i == 0 {
                    // First centroid -- interpolate from min
                    let inner = target / half;
                    return self.min_val + inner * (self.centroids[0].mean - self.min_val);
                }

                let prev_mean = self.centroids[i - 1].mean;
                let prev_half = self.centroids[i - 1].weight / 2.0;
                let gap = cumulative - prev_half;
                let span = half + prev_half;

                if span <= 0.0 {
                    return self.centroids[i].mean;
                }

                let frac = (target - gap) / span;
                return prev_mean + frac * (self.centroids[i].mean - prev_mean);
            }

            cumulative += self.centroids[i].weight;
        }

        self.max_val
    }

    /// Estimate percentiles (0-100 scale, converted internally).
    pub fn percentiles(&mut self, pcts: &[f64]) -> Vec<f64> {
        pcts.iter().map(|&p| self.quantile(p / 100.0)).collect()
    }

    #[wasm_bindgen(getter)]
    pub fn count(&self) -> f64 {
        self.total_weight + self.buffer.len() as f64
    }

    #[wasm_bindgen(getter)]
    pub fn min(&self) -> f64 {
        self.min_val
    }

    #[wasm_bindgen(getter)]
    pub fn max(&self) -> f64 {
        self.max_val
    }

    /// Number of centroids (measure of digest size).
    pub fn centroid_count(&self) -> usize {
        self.centroids.len()
    }
}

impl TDigest {
    fn flush(&mut self) {
        if self.buffer.is_empty() {
            return;
        }

        // Sort buffer
        self.buffer
            .sort_unstable_by(|a, b| a.partial_cmp(b).unwrap());

        // Merge buffer into centroids
        let mut new_centroids = Vec::with_capacity(self.centroids.len() + self.buffer.len());
        let mut ci = 0;
        let mut bi = 0;

        while ci < self.centroids.len() && bi < self.buffer.len() {
            if self.centroids[ci].mean <= self.buffer[bi] {
                new_centroids.push(self.centroids[ci].clone());
                ci += 1;
            } else {
                new_centroids.push(Centroid {
                    mean: self.buffer[bi],
                    weight: 1.0,
                });
                bi += 1;
            }
        }

        while ci < self.centroids.len() {
            new_centroids.push(self.centroids[ci].clone());
            ci += 1;
        }

        while bi < self.buffer.len() {
            new_centroids.push(Centroid {
                mean: self.buffer[bi],
                weight: 1.0,
            });
            bi += 1;
        }

        self.total_weight += self.buffer.len() as f64;
        self.buffer.clear();

        // Compress with alternating direction to prevent systematic left-tail bias
        self.centroids = self.compress(new_centroids);

        // Toggle direction for next flush
        self.reverse_compress = !self.reverse_compress;
    }

    fn compress(&self, sorted: Vec<Centroid>) -> Vec<Centroid> {
        if sorted.is_empty() {
            return sorted;
        }

        if self.reverse_compress {
            // Reverse pass: iterate from right to left, then reverse the result
            self.compress_forward(sorted.into_iter().rev().collect())
                .into_iter()
                .rev()
                .collect()
        } else {
            // Forward pass: iterate left to right (original behavior)
            self.compress_forward(sorted)
        }
    }

    fn compress_forward(&self, sorted: Vec<Centroid>) -> Vec<Centroid> {
        if sorted.is_empty() {
            return sorted;
        }

        let mut result = Vec::with_capacity(sorted.len());
        let mut current = sorted[0].clone();
        let mut cumulative = 0.0;

        #[allow(clippy::needless_range_loop)]
        for i in 1..sorted.len() {
            let proposed_weight = current.weight + sorted[i].weight;
            let q = (cumulative + proposed_weight / 2.0) / self.total_weight;
            let limit = 4.0 * self.total_weight * q * (1.0 - q) / self.compression;

            if proposed_weight <= limit {
                // Merge
                let new_mean = (current.mean * current.weight + sorted[i].mean * sorted[i].weight)
                    / proposed_weight;
                current = Centroid {
                    mean: new_mean,
                    weight: proposed_weight,
                };
            } else {
                cumulative += current.weight;
                result.push(current);
                current = sorted[i].clone();
            }
        }

        result.push(current);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tdigest_basic() {
        let mut td = TDigest::new(100.0);
        for i in 0..=100 {
            td.add(i as f64);
        }

        let p50 = td.quantile(0.5);
        assert!((p50 - 50.0).abs() < 5.0, "p50 = {p50}, expected ~50");

        let p25 = td.quantile(0.25);
        assert!((p25 - 25.0).abs() < 5.0, "p25 = {p25}, expected ~25");

        let p75 = td.quantile(0.75);
        assert!((p75 - 75.0).abs() < 5.0, "p75 = {p75}, expected ~75");
    }

    #[test]
    fn test_tdigest_large() {
        let mut td = TDigest::new(100.0);
        for i in 0..10_000 {
            td.add(i as f64);
        }

        let p50 = td.quantile(0.5);
        assert!((p50 - 5000.0).abs() < 200.0, "p50 = {p50}, expected ~5000");

        let p99 = td.quantile(0.99);
        assert!((p99 - 9900.0).abs() < 200.0, "p99 = {p99}, expected ~9900");

        // Should use bounded memory
        assert!(
            td.centroid_count() < 500,
            "too many centroids: {}",
            td.centroid_count()
        );
    }

    #[test]
    fn test_tdigest_empty() {
        let mut td = TDigest::new(100.0);
        assert!(td.quantile(0.5).is_nan());
    }

    #[test]
    fn test_tdigest_extremes() {
        let mut td = TDigest::new(100.0);
        for i in 0..100 {
            td.add(i as f64);
        }
        assert_eq!(td.quantile(0.0), 0.0);
        assert_eq!(td.quantile(1.0), 99.0);
    }
}
