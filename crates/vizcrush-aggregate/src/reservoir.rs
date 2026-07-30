use wasm_bindgen::prelude::*;

/// Reservoir Sampling using Vitter's Algorithm R.
///
/// Maintains a uniform random sample of k items from a stream of unknown length.
/// Each item in the stream has an equal probability of being in the sample.
#[wasm_bindgen]
pub struct ReservoirSampler {
    k: usize,
    reservoir: Vec<f64>,
    count: u64,
    rng_state: u64,
}

#[wasm_bindgen]
impl ReservoirSampler {
    #[wasm_bindgen(constructor)]
    pub fn new(k: usize) -> Self {
        let k = if k == 0 { 1 } else { k };
        Self {
            k,
            reservoir: Vec::with_capacity(k),
            count: 0,
            rng_state: (k as u64).wrapping_add(0xdeadbeef),
        }
    }

    /// Add a single value to the stream.
    pub fn add(&mut self, value: f64) {
        if !value.is_finite() {
            return;
        }
        self.count += 1;
        if self.reservoir.len() < self.k {
            self.reservoir.push(value);
        } else {
            let j = self.next_rand() % self.count;
            if (j as usize) < self.k {
                self.reservoir[j as usize] = value;
            }
        }
    }

    /// Add a batch of values.
    pub fn add_batch(&mut self, values: &[f64]) {
        for &v in values {
            self.add(v);
        }
    }

    /// Return a clone of the current reservoir sample.
    pub fn sample(&self) -> Vec<f64> {
        self.reservoir.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn count(&self) -> f64 {
        self.count as f64
    }

    #[wasm_bindgen(getter)]
    pub fn capacity(&self) -> usize {
        self.k
    }
}

impl ReservoirSampler {
    fn next_rand(&mut self) -> u64 {
        let mut x = self.rng_state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng_state = x;
        x
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reservoir_basic() {
        let mut rs = ReservoirSampler::new(5);
        for i in 0..5 {
            rs.add(i as f64);
        }
        assert_eq!(rs.sample().len(), 5);
        assert_eq!(rs.count(), 5.0);
    }

    #[test]
    fn test_reservoir_overflow() {
        let mut rs = ReservoirSampler::new(10);
        for i in 0..1000 {
            rs.add(i as f64);
        }
        assert_eq!(rs.sample().len(), 10);
        assert_eq!(rs.count(), 1000.0);
    }

    #[test]
    fn test_reservoir_empty() {
        let rs = ReservoirSampler::new(5);
        assert_eq!(rs.sample().len(), 0);
        assert_eq!(rs.count(), 0.0);
    }

    #[test]
    fn test_reservoir_nan() {
        let mut rs = ReservoirSampler::new(5);
        rs.add(f64::NAN);
        rs.add(f64::INFINITY);
        rs.add(1.0);
        assert_eq!(rs.sample().len(), 1);
        assert_eq!(rs.count(), 1.0);
    }

    #[test]
    fn test_reservoir_large() {
        let mut rs = ReservoirSampler::new(100);
        for i in 0..10_000 {
            rs.add(i as f64);
        }
        assert_eq!(rs.sample().len(), 100);
        assert_eq!(rs.count(), 10_000.0);
        // All samples should be in range
        for &v in rs.sample().iter() {
            assert!((0.0..10_000.0).contains(&v));
        }
    }
}
