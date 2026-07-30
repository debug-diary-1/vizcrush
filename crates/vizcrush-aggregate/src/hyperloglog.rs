use wasm_bindgen::prelude::*;

/// HyperLogLog++: probabilistic cardinality estimation.
///
/// Estimates the number of distinct elements in a stream using
/// sub-linear space. Provides typical error of ~1.04/sqrt(m).
///
/// Reference: Flajolet, Fusy, Gandouet, Meunier (2007);
/// Heule, Nunkesser, Hall — "HyperLogLog in Practice" (2013)
#[wasm_bindgen]
pub struct HyperLogLog {
    precision: u8,
    registers: Vec<u8>,
}

#[wasm_bindgen]
impl HyperLogLog {
    #[wasm_bindgen(constructor)]
    pub fn new(precision: u8) -> Self {
        let p = if !(4..=18).contains(&precision) {
            14
        } else {
            precision
        };
        let m = 1usize << p;
        Self {
            precision: p,
            registers: vec![0u8; m],
        }
    }

    /// Add a single value.
    pub fn add(&mut self, value: f64) {
        if !value.is_finite() {
            return;
        }
        let hash = Self::hash(value.to_bits());
        let p = self.precision as u32;
        let bucket = (hash >> (64 - p)) as usize;
        let remaining = (hash << p) | (1u64 << (p - 1)); // ensure non-zero
        let rank = (remaining.leading_zeros() + 1) as u8;
        if rank > self.registers[bucket] {
            self.registers[bucket] = rank;
        }
    }

    /// Add a batch of values.
    pub fn add_batch(&mut self, values: &[f64]) {
        for &v in values {
            self.add(v);
        }
    }

    /// Estimate the number of distinct values.
    pub fn estimate(&self) -> f64 {
        let m = self.registers.len() as f64;
        let alpha_m = if m >= 128.0 {
            0.7213 / (1.0 + 1.079 / m)
        } else if m >= 64.0 {
            0.709
        } else if m >= 32.0 {
            0.697
        } else {
            0.673
        };

        let sum: f64 = self
            .registers
            .iter()
            .map(|&r| 2.0_f64.powi(-(r as i32)))
            .sum();

        let raw = alpha_m * m * m / sum;

        // Small range correction
        if raw <= 2.5 * m {
            let zeros = self.registers.iter().filter(|&&r| r == 0).count() as f64;
            if zeros > 0.0 {
                return m * (m / zeros).ln();
            }
        }

        // Large range correction (for 32-bit hash, not needed for 64-bit)
        raw
    }

    #[wasm_bindgen(getter)]
    pub fn precision(&self) -> u8 {
        self.precision
    }

    #[wasm_bindgen(getter)]
    pub fn std_error(&self) -> f64 {
        let m = self.registers.len() as f64;
        1.04 / m.sqrt()
    }
}

impl HyperLogLog {
    fn hash(mut h: u64) -> u64 {
        h ^= h >> 33;
        h = h.wrapping_mul(0xff51afd7ed558ccd);
        h ^= h >> 33;
        h = h.wrapping_mul(0xc4ceb9fe1a85ec53);
        h ^= h >> 33;
        h
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hll_basic() {
        let mut hll = HyperLogLog::new(14);
        for i in 0..1000 {
            hll.add(i as f64);
        }
        let est = hll.estimate();
        // Should be within ~10% for 1000 distinct values at p=14
        assert!(
            (est - 1000.0).abs() < 200.0,
            "estimate = {est}, expected ~1000"
        );
    }

    #[test]
    fn test_hll_empty() {
        let hll = HyperLogLog::new(14);
        let est = hll.estimate();
        assert_eq!(est, 0.0);
    }

    #[test]
    fn test_hll_nan() {
        let mut hll = HyperLogLog::new(14);
        hll.add(f64::NAN);
        hll.add(f64::INFINITY);
        hll.add(1.0);
        // Only 1 was added
        let est = hll.estimate();
        assert!(est > 0.0);
    }

    #[test]
    fn test_hll_duplicates() {
        let mut hll = HyperLogLog::new(14);
        for _ in 0..10_000 {
            hll.add(42.0);
        }
        let est = hll.estimate();
        // Should estimate ~1 distinct value
        assert!(est < 10.0, "estimate = {est}, expected ~1");
    }

    #[test]
    fn test_hll_large() {
        let mut hll = HyperLogLog::new(14);
        for i in 0..10_000 {
            hll.add(i as f64);
        }
        let est = hll.estimate();
        // At p=14, std error ~= 0.008, so 10K should be within ~15%
        assert!(
            (est - 10_000.0).abs() < 2000.0,
            "estimate = {est}, expected ~10000"
        );
    }

    #[test]
    fn test_hll_std_error() {
        let hll = HyperLogLog::new(14);
        let se = hll.std_error();
        // 1.04 / sqrt(2^14) = 1.04 / 128 ≈ 0.008125
        assert!(
            (se - 0.008125).abs() < 0.001,
            "std_error = {se}, expected ~0.008"
        );
    }

    #[test]
    fn test_hll_precision_bounds() {
        let hll = HyperLogLog::new(3); // below min, should clamp to 14
        assert_eq!(hll.precision(), 14);

        let hll = HyperLogLog::new(20); // above max, should clamp to 14
        assert_eq!(hll.precision(), 14);

        let hll = HyperLogLog::new(10); // valid
        assert_eq!(hll.precision(), 10);
    }
}
