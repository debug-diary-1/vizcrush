use wasm_bindgen::prelude::*;

/// Extract a viewport slice of paired x/y data without copying the full array.
///
/// Returns only the points where x is within [x_min, x_max].
///
/// # Returns
/// Interleaved [x0, y0, x1, y1, ...] of matching points.
#[wasm_bindgen]
pub fn filter_range(x: &[f64], y: &[f64], x_min: f64, x_max: f64) -> Vec<f64> {
    assert_eq!(x.len(), y.len(), "x and y must have equal length");

    let mut result = Vec::new();
    for i in 0..x.len() {
        if x[i] >= x_min && x[i] <= x_max {
            result.push(x[i]);
            result.push(y[i]);
        }
    }
    result
}

/// Binary search-based filter for sorted x arrays. Much faster for large datasets.
#[wasm_bindgen]
pub fn filter_range_sorted(x: &[f64], y: &[f64], x_min: f64, x_max: f64) -> Vec<f64> {
    assert_eq!(x.len(), y.len(), "x and y must have equal length");

    if x.is_empty() {
        return vec![];
    }

    // Binary search for start
    let start = match x.binary_search_by(|v| v.partial_cmp(&x_min).unwrap()) {
        Ok(i) => i,
        Err(i) => i,
    };

    // Binary search for end
    let end = match x.binary_search_by(|v| v.partial_cmp(&x_max).unwrap()) {
        Ok(i) => i + 1, // include the matching element
        Err(i) => i,
    };

    let len = end.saturating_sub(start);
    let mut result = Vec::with_capacity(len * 2);
    for i in start..end.min(x.len()) {
        result.push(x[i]);
        result.push(y[i]);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_range() {
        let x = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let y = vec![10.0, 20.0, 30.0, 40.0, 50.0];
        let result = filter_range(&x, &y, 2.0, 4.0);
        assert_eq!(result, vec![2.0, 20.0, 3.0, 30.0, 4.0, 40.0]);
    }

    #[test]
    fn test_filter_range_sorted() {
        let x = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let y = vec![10.0, 20.0, 30.0, 40.0, 50.0];
        let result = filter_range_sorted(&x, &y, 2.0, 4.0);
        assert_eq!(result, vec![2.0, 20.0, 3.0, 30.0, 4.0, 40.0]);
    }

    #[test]
    fn test_filter_range_empty() {
        let x = vec![1.0, 2.0, 3.0];
        let y = vec![10.0, 20.0, 30.0];
        let result = filter_range(&x, &y, 5.0, 10.0);
        assert!(result.is_empty());
    }
}
