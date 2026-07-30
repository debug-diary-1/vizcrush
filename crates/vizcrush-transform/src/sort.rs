use wasm_bindgen::prelude::*;

/// Radix sort on Float64 arrays.
///
/// Converts f64 to sortable u64 representation, performs radix sort,
/// then converts back. O(n) time complexity.
///
/// # Arguments
/// * `data` - Input array to sort.
/// * `descending` - If true, sort in descending order.
///
/// # Returns
/// Sorted array.
#[wasm_bindgen]
pub fn radix_sort(data: &[f64], descending: bool) -> Vec<f64> {
    if data.len() <= 1 {
        return data.to_vec();
    }

    // Convert f64 to sortable u64 representation
    let mut keys: Vec<u64> = data.iter().map(|&v| f64_to_sortable_u64(v)).collect();

    // LSD radix sort — after 8 passes (even), result is in `keys`
    radix_sort_u64(&mut keys);

    // Convert back — descending iterates in reverse (no .reverse() allocation)
    if descending {
        keys.iter().rev().map(|&k| sortable_u64_to_f64(k)).collect()
    } else {
        keys.iter().map(|&k| sortable_u64_to_f64(k)).collect()
    }
}

/// Convert f64 to a u64 that sorts in the same order.
/// Positive floats: flip the sign bit.
/// Negative floats: flip all bits (so more negative = smaller u64).
#[inline]
fn f64_to_sortable_u64(v: f64) -> u64 {
    let bits = v.to_bits();
    if bits >> 63 == 1 {
        // Negative: flip all bits
        !bits
    } else {
        // Positive: flip sign bit
        bits ^ (1u64 << 63)
    }
}

#[inline]
fn sortable_u64_to_f64(k: u64) -> f64 {
    let bits = if k >> 63 == 0 {
        // Was negative: flip all bits back
        !k
    } else {
        // Was positive: flip sign bit back
        k ^ (1u64 << 63)
    };
    f64::from_bits(bits)
}

/// LSD radix sort on u64 with 8-bit radix using ping-pong buffers.
/// After 8 passes (even swaps), the sorted result is in `data`.
#[inline]
fn radix_sort_u64(data: &mut Vec<u64>) {
    let n = data.len();
    let mut buffer = vec![0u64; n];

    // After 8 passes with swap, the result ping-pongs:
    //   pass 0: data -> buffer, swap => data has result of pass 0
    //   pass 1: data -> buffer, swap => data has result of pass 1
    //   ...
    // After an even number of swaps the result is in `data`.
    // 8 passes = 8 swaps => result is back in `data`. So we're good.

    for byte_idx in 0..8 {
        let shift = byte_idx * 8;

        // Count occurrences
        let mut counts = [0usize; 256];
        for &val in data.iter() {
            let digit = ((val >> shift) & 0xFF) as usize;
            counts[digit] += 1;
        }

        // Prefix sum
        let mut offsets = [0usize; 256];
        for i in 1..256 {
            offsets[i] = offsets[i - 1] + counts[i - 1];
        }

        // Scatter into buffer
        for &val in data.iter() {
            let digit = ((val >> shift) & 0xFF) as usize;
            buffer[offsets[digit]] = val;
            offsets[digit] += 1;
        }

        // Ping-pong: swap data and buffer so next pass reads from the latest result
        std::mem::swap(data, &mut buffer);
    }

    // After 8 swaps the sorted result is in `data` (even number of swaps).
}

/// Sort by key array: reorders `data` according to sorted order of `keys`.
#[wasm_bindgen]
pub fn sort_by_keys(data: &[f64], keys: &[f64]) -> Vec<f64> {
    assert_eq!(
        data.len(),
        keys.len(),
        "data and keys must have equal length"
    );

    let mut indices: Vec<usize> = (0..keys.len()).collect();
    indices.sort_unstable_by(|&a, &b| {
        keys[a]
            .partial_cmp(&keys[b])
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    indices.iter().map(|&i| data[i]).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_radix_sort_basic() {
        let data = vec![5.0, 3.0, 1.0, 4.0, 2.0];
        let result = radix_sort(&data, false);
        assert_eq!(result, vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn test_radix_sort_descending() {
        let data = vec![5.0, 3.0, 1.0, 4.0, 2.0];
        let result = radix_sort(&data, true);
        assert_eq!(result, vec![5.0, 4.0, 3.0, 2.0, 1.0]);
    }

    #[test]
    fn test_radix_sort_negative() {
        let data = vec![-3.0, 1.0, -1.0, 0.0, 2.0];
        let result = radix_sort(&data, false);
        assert_eq!(result, vec![-3.0, -1.0, 0.0, 1.0, 2.0]);
    }

    #[test]
    fn test_sort_by_keys() {
        let data = vec![10.0, 20.0, 30.0];
        let keys = vec![3.0, 1.0, 2.0];
        let result = sort_by_keys(&data, &keys);
        assert_eq!(result, vec![20.0, 30.0, 10.0]);
    }
}
