use wasm_bindgen::prelude::*;

/// How often (in evictions) to do a full recomputation of mean/m2 from the
/// buffer to prevent floating-point drift.
const RECOMPUTE_INTERVAL: u64 = 10_000;

/// Streaming statistics accumulator with a fixed-size rolling window.
///
/// Maintains min/max/mean/stddev over the most recent `window_size` values.
/// Uses Welford's algorithm for online variance, with periodic full
/// recomputation every 10,000 evictions to prevent drift.
#[wasm_bindgen]
pub struct StreamingAccumulator {
    window_size: usize,
    buffer: Vec<f64>,
    head: usize,
    count: usize,
    // Running Welford state
    mean: f64,
    m2: f64,
    min_val: f64,
    max_val: f64,
    // Drift-prevention counter: incremented on each eviction
    eviction_count: u64,
}

#[wasm_bindgen]
impl StreamingAccumulator {
    #[wasm_bindgen(constructor)]
    pub fn new(window_size: usize) -> Self {
        Self {
            window_size,
            buffer: vec![0.0; window_size],
            head: 0,
            count: 0,
            mean: 0.0,
            m2: 0.0,
            min_val: f64::INFINITY,
            max_val: f64::NEG_INFINITY,
            eviction_count: 0,
        }
    }

    /// Push a single value into the rolling window.
    pub fn push(&mut self, value: f64) {
        if !value.is_finite() {
            return;
        }

        let was_full = self.count >= self.window_size;
        let old = if was_full {
            Some(self.buffer[self.head])
        } else {
            None
        };

        // Write new value to buffer first, then update stats
        self.buffer[self.head] = value;
        self.head = (self.head + 1) % self.window_size;
        if !was_full {
            self.count += 1;
        }

        if let Some(old_val) = old {
            self.remove_from_stats(old_val);
        }
        self.add_to_stats(value);
    }

    /// Push a batch of values.
    pub fn push_batch(&mut self, values: &[f64]) {
        for &v in values {
            self.push(v);
        }
    }

    fn add_to_stats(&mut self, value: f64) {
        if value < self.min_val {
            self.min_val = value;
        }
        if value > self.max_val {
            self.max_val = value;
        }
        // For simplicity in the streaming case, we recompute from buffer
        // when min/max is evicted. The mean/variance use online updates.
        let n = self.count as f64;
        let delta = value - self.mean;
        self.mean += delta / n;
        let delta2 = value - self.mean;
        self.m2 += delta * delta2;
    }

    fn remove_from_stats(&mut self, old: f64) {
        self.eviction_count += 1;

        if self.count <= 1 {
            self.mean = 0.0;
            self.m2 = 0.0;
            self.min_val = f64::INFINITY;
            self.max_val = f64::NEG_INFINITY;
            return;
        }

        let n = self.count as f64;
        let delta = old - self.mean;
        self.mean = (self.mean * n - old) / (n - 1.0);
        let delta2 = old - self.mean;
        self.m2 -= delta * delta2;
        if self.m2 < 0.0 {
            self.m2 = 0.0;
        }

        // Recompute min/max if the evicted value was an extreme
        if old <= self.min_val || old >= self.max_val {
            self.recompute_minmax();
        }

        // Periodic full recomputation of mean/m2 to prevent drift
        if self.eviction_count.is_multiple_of(RECOMPUTE_INTERVAL) {
            self.recompute_mean_m2();
        }
    }

    fn recompute_minmax(&mut self) {
        self.min_val = f64::INFINITY;
        self.max_val = f64::NEG_INFINITY;
        let len = self.count.min(self.window_size);
        for i in 0..len {
            let idx = if self.count >= self.window_size {
                (self.head + i) % self.window_size
            } else {
                i
            };
            let v = self.buffer[idx];
            if v < self.min_val {
                self.min_val = v;
            }
            if v > self.max_val {
                self.max_val = v;
            }
        }
    }

    /// Full recomputation of mean and m2 from the buffer using Welford's
    /// algorithm. Called periodically to prevent floating-point drift.
    fn recompute_mean_m2(&mut self) {
        let len = self.count.min(self.window_size);
        if len == 0 {
            self.mean = 0.0;
            self.m2 = 0.0;
            return;
        }

        let mut new_mean = 0.0;
        let mut new_m2 = 0.0;
        let mut n = 0u64;

        for i in 0..len {
            let idx = if self.count >= self.window_size {
                (self.head + i) % self.window_size
            } else {
                i
            };
            let v = self.buffer[idx];
            n += 1;
            let delta = v - new_mean;
            new_mean += delta / n as f64;
            let delta2 = v - new_mean;
            new_m2 += delta * delta2;
        }

        self.mean = new_mean;
        self.m2 = new_m2;
    }

    #[wasm_bindgen(getter)]
    pub fn length(&self) -> usize {
        self.count
    }

    #[wasm_bindgen(getter)]
    pub fn mean(&self) -> f64 {
        self.mean
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
    pub fn std_dev(&self) -> f64 {
        if self.count < 2 {
            return 0.0;
        }
        (self.m2 / (self.count - 1) as f64).sqrt()
    }

    #[wasm_bindgen(getter)]
    pub fn variance(&self) -> f64 {
        if self.count < 2 {
            return 0.0;
        }
        self.m2 / (self.count - 1) as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_streaming_basic() {
        let mut acc = StreamingAccumulator::new(5);
        for i in 1..=5 {
            acc.push(i as f64);
        }
        assert_eq!(acc.length(), 5);
        assert_eq!(acc.mean(), 3.0);
        assert_eq!(acc.min(), 1.0);
        assert_eq!(acc.max(), 5.0);
    }

    #[test]
    fn test_streaming_overflow() {
        let mut acc = StreamingAccumulator::new(3);
        acc.push(1.0);
        acc.push(2.0);
        acc.push(3.0);
        acc.push(10.0); // evicts 1.0
        assert_eq!(acc.length(), 3);
        assert_eq!(acc.min(), 2.0);
        assert_eq!(acc.max(), 10.0);
    }
}
