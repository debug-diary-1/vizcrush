use wasm_bindgen::prelude::*;

/// Quantile normalize a flat row-major matrix (n_rows x n_cols).
///
/// Each column is a distribution. After normalization, all columns
/// share the same distribution (the average distribution).
///
/// # Arguments
/// * `data` - Flat row-major matrix of size n_rows * n_cols.
/// * `n_cols` - Number of columns.
///
/// # Returns
/// Quantile-normalized matrix in flat row-major layout.
#[wasm_bindgen]
pub fn quantile_normalize(data: &[f64], n_cols: usize) -> Vec<f64> {
    if n_cols == 0 || data.is_empty() {
        return vec![];
    }
    let n_rows = data.len() / n_cols;
    if n_rows == 0 {
        return vec![];
    }

    // 1. For each column, create (value, original_row_index) pairs and sort by value.
    //    NaN values sort to the end so they do not corrupt rank means.
    let mut columns: Vec<Vec<(f64, usize)>> = (0..n_cols)
        .map(|c| (0..n_rows).map(|r| (data[r * n_cols + c], r)).collect())
        .collect();

    for col in &mut columns {
        col.sort_by(|a, b| match (a.0.is_nan(), b.0.is_nan()) {
            (true, true) => std::cmp::Ordering::Equal,
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            (false, false) => a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal),
        });
    }

    // 2. Compute rank means: for each rank position, average across columns.
    //    If any column has NaN at a given rank, the mean for that rank is NaN.
    let mut rank_means = vec![0.0; n_rows];
    for rank in 0..n_rows {
        let mut sum = 0.0f64;
        let mut has_nan = false;
        for col in &columns {
            let v = col[rank].0;
            if v.is_nan() {
                has_nan = true;
                break;
            }
            sum += v;
        }
        rank_means[rank] = if has_nan {
            f64::NAN
        } else {
            sum / n_cols as f64
        };
    }

    // 3. Assign: for each column, the element at rank r gets rank_means[r].
    let mut result = vec![0.0; data.len()];
    for c in 0..n_cols {
        for rank in 0..n_rows {
            let original_row = columns[c][rank].1;
            result[original_row * n_cols + c] = rank_means[rank];
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quantile_normalize_2x3() {
        // 2 rows, 3 columns (row-major):
        //   col0  col1  col2
        // r0:  5     4     3
        // r1:  2     1     4
        //
        // Sorted columns:
        //   col0: [(2,1),(5,0)]  col1: [(1,1),(4,0)]  col2: [(3,0),(4,1)]
        //
        // Rank 0 mean: (2+1+3)/3 = 2.0
        // Rank 1 mean: (5+4+4)/3 = 13/3 ≈ 4.333...
        //
        // Assignments:
        //   col0: row1 gets 2.0, row0 gets 13/3
        //   col1: row1 gets 2.0, row0 gets 13/3
        //   col2: row0 gets 2.0, row1 gets 13/3
        //
        // Result (row-major):
        //   r0: 13/3, 13/3, 2.0
        //   r1: 2.0,  2.0,  13/3
        let data = vec![5.0, 4.0, 3.0, 2.0, 1.0, 4.0];
        let result = quantile_normalize(&data, 3);
        let expected_high = 13.0 / 3.0;
        let expected_low = 2.0;

        assert!((result[0] - expected_high).abs() < 1e-12);
        assert!((result[1] - expected_high).abs() < 1e-12);
        assert!((result[2] - expected_low).abs() < 1e-12);
        assert!((result[3] - expected_low).abs() < 1e-12);
        assert!((result[4] - expected_low).abs() < 1e-12);
        assert!((result[5] - expected_high).abs() < 1e-12);
    }

    #[test]
    fn test_single_column_identity() {
        // With a single column, quantile normalization is identity.
        let data = vec![10.0, 20.0, 30.0];
        let result = quantile_normalize(&data, 1);
        assert_eq!(result, vec![10.0, 20.0, 30.0]);
    }

    #[test]
    fn test_identical_columns_stay_identical() {
        // Two identical columns should remain identical after normalization.
        let data = vec![3.0, 3.0, 1.0, 1.0, 2.0, 2.0];
        let result = quantile_normalize(&data, 2);
        // Each pair in a row should be equal
        assert_eq!(result[0], result[1]);
        assert_eq!(result[2], result[3]);
        assert_eq!(result[4], result[5]);
        // Values should be the same as originals since columns are identical
        assert_eq!(result[0], 3.0);
        assert_eq!(result[2], 1.0);
        assert_eq!(result[4], 2.0);
    }

    #[test]
    fn test_empty_input() {
        let result = quantile_normalize(&[], 3);
        assert!(result.is_empty());
    }

    #[test]
    fn test_zero_cols() {
        let result = quantile_normalize(&[1.0, 2.0], 0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_nan_handling() {
        // NaN should sort to end and produce NaN in rank means for that rank.
        let data = vec![
            1.0,
            2.0, // row 0
            f64::NAN,
            4.0, // row 1
        ];
        let result = quantile_normalize(&data, 2);
        // col0 sorted: [(1.0, r0), (NaN, r1)]
        // col1 sorted: [(2.0, r0), (4.0, r1)]
        // rank 0 mean: (1.0 + 2.0)/2 = 1.5
        // rank 1 mean: NaN (because col0 has NaN)
        assert!((result[0] - 1.5).abs() < 1e-12); // row0, col0
        assert!((result[1] - 1.5).abs() < 1e-12); // row0, col1
        assert!(result[2].is_nan()); // row1, col0 (NaN rank)
        assert!(result[3].is_nan()); // row1, col1 (NaN rank)
    }

    #[test]
    fn test_large_scale() {
        let n_rows = 1000;
        let n_cols = 50;
        let data: Vec<f64> = (0..(n_rows * n_cols)).map(|i| (i as f64) * 0.1).collect();
        let result = quantile_normalize(&data, n_cols);
        assert_eq!(result.len(), n_rows * n_cols);
        // All values should be finite
        assert!(result.iter().all(|v| v.is_finite()));
    }
}
