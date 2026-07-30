use wasm_bindgen::prelude::*;

/// Count-Min Sketch: sub-linear frequency estimation.
///
/// Estimates the frequency of elements in a stream using a 2D array
/// of counters with multiple hash functions. Provides an upper bound
/// on the true count with high probability.
///
/// Reference: Cormode, Muthukrishnan — "An Improved Data Stream Summary:
/// The Count-Min Sketch and its Applications" (2005)
#[wasm_bindgen]
pub struct CountMinSketch {
    width: usize,
    depth: usize,
    table: Vec<u64>,
    hash_seeds: Vec<u64>,
    total_count: u64,
}

#[wasm_bindgen]
impl CountMinSketch {
    #[wasm_bindgen(constructor)]
    pub fn new(width: usize, depth: usize) -> Self {
        let width = if width == 0 { 1024 } else { width };
        let depth = if depth == 0 { 5 } else { depth };

        // Generate deterministic seeds
        let mut seeds = Vec::with_capacity(depth);
        let mut seed = 0x517cc1b727220a95u64;
        for _ in 0..depth {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seeds.push(seed);
        }

        Self {
            width,
            depth,
            table: vec![0u64; width * depth],
            hash_seeds: seeds,
            total_count: 0,
        }
    }

    /// Add a single value with count 1.
    pub fn add(&mut self, value: f64) {
        if !value.is_finite() {
            return;
        }
        self.add_with_count(value, 1);
    }

    /// Add a single value with a specified count.
    pub fn add_with_count(&mut self, value: f64, count: u64) {
        if !value.is_finite() {
            return;
        }
        let bits = value.to_bits();
        self.total_count += count;

        for d in 0..self.depth {
            let idx = self.hash(bits, d);
            self.table[d * self.width + idx] += count;
        }
    }

    /// Add a batch of values, each with count 1.
    pub fn add_batch(&mut self, values: &[f64]) {
        for &v in values {
            self.add(v);
        }
    }

    /// Estimate the frequency of a value (returns upper bound).
    pub fn estimate(&self, value: f64) -> u64 {
        if !value.is_finite() {
            return 0;
        }
        let bits = value.to_bits();
        let mut min_count = u64::MAX;

        for d in 0..self.depth {
            let idx = self.hash(bits, d);
            let count = self.table[d * self.width + idx];
            if count < min_count {
                min_count = count;
            }
        }

        min_count
    }

    #[wasm_bindgen(getter)]
    pub fn count(&self) -> f64 {
        self.total_count as f64
    }

    #[wasm_bindgen(getter)]
    pub fn width(&self) -> usize {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn depth(&self) -> usize {
        self.depth
    }
}

impl CountMinSketch {
    fn hash(&self, bits: u64, d: usize) -> usize {
        // Murmur3-style mixing to spread sequential f64 bit representations
        let mut h = bits;
        h ^= h >> 33;
        h = h.wrapping_mul(0xff51afd7ed558ccd);
        h ^= h >> 33;
        h = h.wrapping_mul(0xc4ceb9fe1a85ec53);
        h ^= h >> 33;
        // Per-depth differentiation via seed
        h = h.wrapping_mul(self.hash_seeds[d]);
        ((h >> 32) as usize) % self.width
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_countmin_basic() {
        let mut cm = CountMinSketch::new(1024, 5);
        for _ in 0..100 {
            cm.add(42.0);
        }
        let est = cm.estimate(42.0);
        assert_eq!(est, 100, "estimate = {est}, expected 100");
    }

    #[test]
    fn test_countmin_empty() {
        let cm = CountMinSketch::new(1024, 5);
        assert_eq!(cm.estimate(42.0), 0);
        assert_eq!(cm.count(), 0.0);
    }

    #[test]
    fn test_countmin_nan() {
        let mut cm = CountMinSketch::new(1024, 5);
        cm.add(f64::NAN);
        cm.add(f64::INFINITY);
        cm.add(1.0);
        assert_eq!(cm.count(), 1.0);
        assert_eq!(cm.estimate(f64::NAN), 0);
    }

    #[test]
    fn test_countmin_with_count() {
        let mut cm = CountMinSketch::new(1024, 5);
        cm.add_with_count(7.0, 50);
        assert_eq!(cm.estimate(7.0), 50);
        assert_eq!(cm.count(), 50.0);
    }

    #[test]
    fn test_countmin_multiple_values() {
        let mut cm = CountMinSketch::new(1024, 5);
        for i in 0..100 {
            for _ in 0..(i + 1) {
                cm.add(i as f64);
            }
        }
        // Most frequent value (99) added 100 times
        let est = cm.estimate(99.0);
        assert!(est >= 100, "estimate for 99 = {est}, expected >= 100");
        // Least frequent value (0) added 1 time; estimate is an upper bound
        let est0 = cm.estimate(0.0);
        assert!(est0 >= 1, "estimate for 0 = {est0}, expected >= 1");
    }

    #[test]
    fn test_countmin_large() {
        let mut cm = CountMinSketch::new(2048, 5);
        for i in 0..10_000 {
            cm.add(i as f64);
        }
        assert_eq!(cm.count(), 10_000.0);

        // Each value added once; estimate should be close to 1
        // With width 2048 and 10K items, some overcounting expected
        let est = cm.estimate(5000.0);
        assert!(
            (1..20).contains(&est),
            "estimate = {est}, expected close to 1"
        );
    }

    #[test]
    fn test_countmin_defaults() {
        let cm = CountMinSketch::new(0, 0);
        assert_eq!(cm.width(), 1024);
        assert_eq!(cm.depth(), 5);
    }
}
