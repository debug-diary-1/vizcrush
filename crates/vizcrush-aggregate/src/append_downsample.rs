use wasm_bindgen::prelude::*;

/// Append new data to a rolling buffer and downsample in one pass using LTTB.
///
/// This combines buffer management + LTTB into a single operation,
/// avoiding the intermediate full-buffer allocation.
///
/// # Arguments
/// * `buffer_x` - Existing x buffer (will be extended).
/// * `buffer_y` - Existing y buffer (will be extended).
/// * `new_x` - New x values to append.
/// * `new_y` - New y values to append.
/// * `max_buffer_size` - Maximum buffer size before oldest points are dropped.
/// * `target_points` - LTTB downsampling target.
///
/// # Returns
/// Interleaved [x0, y0, x1, y1, ...] downsampled result.
#[wasm_bindgen]
pub fn append_and_downsample(
    buffer_x: &[f64],
    buffer_y: &[f64],
    new_x: &[f64],
    new_y: &[f64],
    max_buffer_size: usize,
    target_points: usize,
) -> Vec<f64> {
    assert_eq!(buffer_x.len(), buffer_y.len());
    assert_eq!(new_x.len(), new_y.len());

    // Combine existing buffer + new data
    let total = buffer_x.len() + new_x.len();
    let skip = total.saturating_sub(max_buffer_size);

    // Build combined arrays, dropping oldest if over max
    let combined_len = total - skip;
    let mut cx = Vec::with_capacity(combined_len);
    let mut cy = Vec::with_capacity(combined_len);

    let old_skip = skip.min(buffer_x.len());
    // Add remaining old data
    for i in old_skip..buffer_x.len() {
        cx.push(buffer_x[i]);
        cy.push(buffer_y[i]);
    }
    // Add new data (skip from new if old wasn't enough)
    let new_skip = skip.saturating_sub(buffer_x.len());
    for i in new_skip..new_x.len() {
        cx.push(new_x[i]);
        cy.push(new_y[i]);
    }

    // Now LTTB downsample the combined buffer
    vizcrush_downsample::lttb(&cx, &cy, target_points)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_append_and_downsample() {
        let buf_x: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let buf_y: Vec<f64> = buf_x.iter().map(|x| (x * 0.1).sin()).collect();

        let new_x: Vec<f64> = (100..150).map(|i| i as f64).collect();
        let new_y: Vec<f64> = new_x.iter().map(|x| (x * 0.1).sin()).collect();

        let result = append_and_downsample(&buf_x, &buf_y, &new_x, &new_y, 200, 20);
        assert_eq!(result.len(), 40); // 20 points * 2
                                      // First and last preserved
        assert_eq!(result[0], 0.0);
        assert_eq!(result[38], 149.0);
    }

    #[test]
    fn test_append_with_overflow() {
        let buf_x: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let buf_y: Vec<f64> = buf_x.clone();

        let new_x: Vec<f64> = (100..200).map(|i| i as f64).collect();
        let new_y: Vec<f64> = new_x.clone();

        // Max buffer 150 — should drop first 50 old points
        let result = append_and_downsample(&buf_x, &buf_y, &new_x, &new_y, 150, 10);
        assert_eq!(result.len(), 20); // 10 points * 2
                                      // First point should be 50 (after dropping oldest)
        assert_eq!(result[0], 50.0);
        assert_eq!(result[18], 199.0);
    }
}
