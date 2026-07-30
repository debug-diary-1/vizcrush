use wasm_bindgen::prelude::*;

/// KLL Sketch: space-efficient approximate quantile estimation.
///
/// Uses a multi-level compaction scheme to maintain a compact summary
/// of the data distribution. Provides rank-error guarantees with
/// significantly less memory than exact methods.
///
/// Reference: Karnin, Lang, Liberty — "Optimal Quantile Approximation in Streams" (2016)
#[wasm_bindgen]
pub struct KllSketch {
    k: usize,
    levels: Vec<Vec<f64>>,
    total_count: u64,
    min_val: f64,
    max_val: f64,
    compact_offset: usize, // alternates 0/1 to avoid systematic bias
}

#[wasm_bindgen]
impl KllSketch {
    #[wasm_bindgen(constructor)]
    pub fn new(k: usize) -> Self {
        let k = if k == 0 { 200 } else { k };
        Self {
            k,
            compact_offset: 0,
            levels: vec![Vec::new()],
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
        self.levels[0].push(value);

        if self.levels[0].len() >= 2 * self.k {
            self.compact_level(0);
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

        let items = self.weighted_items();
        if items.is_empty() {
            return f64::NAN;
        }

        let total_weight: u64 = items.iter().map(|&(_, w)| w).sum();
        let target = (q * total_weight as f64).ceil() as u64;
        let mut running = 0u64;

        for &(val, weight) in &items {
            running += weight;
            if running >= target {
                return val;
            }
        }

        self.max_val
    }

    /// Estimate the rank of a value (fraction of values <= v).
    pub fn rank(&self, value: f64) -> f64 {
        if self.total_count == 0 {
            return f64::NAN;
        }

        let items = self.weighted_items();
        let total_weight: u64 = items.iter().map(|&(_, w)| w).sum();
        let mut count = 0u64;

        for &(val, weight) in &items {
            if val <= value {
                count += weight;
            }
        }

        count as f64 / total_weight as f64
    }

    /// Compute CDF at the given split points.
    pub fn cdf(&self, split_points: &[f64]) -> Vec<f64> {
        split_points.iter().map(|&v| self.rank(v)).collect()
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

    #[wasm_bindgen(getter)]
    pub fn num_retained(&self) -> usize {
        self.levels.iter().map(|l| l.len()).sum()
    }
}

impl KllSketch {
    fn compact_level(&mut self, level: usize) {
        // Sort the level
        self.levels[level].sort_unstable_by(|a, b| a.partial_cmp(b).unwrap());

        // Keep every other element, alternating start offset to avoid bias
        let offset = self.compact_offset;
        self.compact_offset ^= 1; // alternate 0/1 each compaction
        let survivors: Vec<f64> = self.levels[level]
            .iter()
            .enumerate()
            .filter(|(i, _)| i % 2 == offset)
            .map(|(_, &v)| v)
            .collect();

        self.levels[level].clear();

        // Ensure next level exists
        if level + 1 >= self.levels.len() {
            self.levels.push(Vec::new());
        }

        // Push survivors up
        self.levels[level + 1].extend(survivors);

        // Recursively compact if upper level overflows
        let cap = self.level_capacity(level + 1);
        if self.levels[level + 1].len() >= cap {
            self.compact_level(level + 1);
        }
    }

    fn level_capacity(&self, level: usize) -> usize {
        // Simplified: use k for all levels, compact when full
        // Higher levels have slightly smaller capacity
        let cap = self.k >> level.min(10);
        if cap < 4 {
            4
        } else {
            cap
        }
    }

    fn weighted_items(&self) -> Vec<(f64, u64)> {
        let mut items = Vec::new();
        for (level, values) in self.levels.iter().enumerate() {
            let weight = 1u64 << level;
            for &v in values {
                items.push((v, weight));
            }
        }
        items.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        items
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kll_basic() {
        let mut kll = KllSketch::new(200);
        for i in 0..=100 {
            kll.add(i as f64);
        }

        let p50 = kll.quantile(0.5);
        assert!((p50 - 50.0).abs() < 10.0, "p50 = {p50}, expected ~50");

        let p25 = kll.quantile(0.25);
        assert!((p25 - 25.0).abs() < 10.0, "p25 = {p25}, expected ~25");

        assert_eq!(kll.count(), 101.0);
    }

    #[test]
    fn test_kll_empty() {
        let kll = KllSketch::new(200);
        assert!(kll.quantile(0.5).is_nan());
        assert!(kll.rank(10.0).is_nan());
        assert_eq!(kll.count(), 0.0);
    }

    #[test]
    fn test_kll_nan() {
        let mut kll = KllSketch::new(200);
        kll.add(f64::NAN);
        kll.add(f64::INFINITY);
        kll.add(5.0);
        assert_eq!(kll.count(), 1.0);
        assert_eq!(kll.min(), 5.0);
        assert_eq!(kll.max(), 5.0);
    }

    #[test]
    fn test_kll_rank() {
        let mut kll = KllSketch::new(200);
        for i in 0..100 {
            kll.add(i as f64);
        }
        let r = kll.rank(50.0);
        assert!((r - 0.51).abs() < 0.15, "rank(50) = {r}, expected ~0.51");
    }

    #[test]
    fn test_kll_cdf() {
        let mut kll = KllSketch::new(200);
        for i in 0..100 {
            kll.add(i as f64);
        }
        let cdf = kll.cdf(&[0.0, 50.0, 99.0]);
        assert_eq!(cdf.len(), 3);
        assert!(cdf[0] > 0.0, "cdf[0] = {}", cdf[0]);
        assert!(cdf[2] >= 0.9, "cdf[2] = {}", cdf[2]);
    }

    #[test]
    fn test_kll_large() {
        let mut kll = KllSketch::new(200);
        for i in 0..10_000 {
            kll.add(i as f64);
        }
        assert_eq!(kll.count(), 10_000.0);
        assert_eq!(kll.min(), 0.0);
        assert_eq!(kll.max(), 9999.0);

        let p50 = kll.quantile(0.5);
        assert!((p50 - 5000.0).abs() < 1000.0, "p50 = {p50}, expected ~5000");

        // Should use bounded memory
        assert!(
            kll.num_retained() < 5000,
            "too many retained: {}",
            kll.num_retained()
        );
    }

    #[test]
    fn test_kll_extremes() {
        let mut kll = KllSketch::new(200);
        for i in 0..100 {
            kll.add(i as f64);
        }
        assert_eq!(kll.quantile(0.0), 0.0);
        assert_eq!(kll.quantile(1.0), 99.0);
    }
}
