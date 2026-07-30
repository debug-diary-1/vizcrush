use std::collections::HashMap;
use wasm_bindgen::prelude::*;

/// Hash a 2D cell coordinate to a single u64 key using two large primes.
#[inline]
fn cell_hash(cx: i64, cy: i64) -> u64 {
    (cx as u64)
        .wrapping_mul(73_856_093)
        .wrapping_add((cy as u64).wrapping_mul(19_349_663))
}

/// A flat spatial hash grid for 2D point data.
///
/// Points are assigned to cells of a fixed size.  Radius and axis-aligned
/// rectangle queries iterate only over the cells that overlap the query region,
/// making them efficient when the cell size roughly matches the query radius.
#[wasm_bindgen]
pub struct SpatialHashGrid {
    cell_size: f64,
    inv_cell_size: f64,
    cells: HashMap<u64, Vec<u32>>,
    x_data: Vec<f64>,
    y_data: Vec<f64>,
}

#[wasm_bindgen]
impl SpatialHashGrid {
    /// Create a new empty grid with the given cell size.
    #[wasm_bindgen(constructor)]
    pub fn new(cell_size: f64) -> Self {
        Self {
            cell_size,
            inv_cell_size: 1.0 / cell_size,
            cells: HashMap::new(),
            x_data: Vec::new(),
            y_data: Vec::new(),
        }
    }

    /// Insert a batch of 2D points.  Non-finite coordinates are silently
    /// skipped.  Returns the number of points actually inserted.
    pub fn insert_batch(&mut self, x: &[f64], y: &[f64]) -> u32 {
        let mut inserted = 0u32;
        let n = x.len().min(y.len());
        for i in 0..n {
            if !x[i].is_finite() || !y[i].is_finite() {
                continue;
            }
            let idx = self.x_data.len() as u32;
            self.x_data.push(x[i]);
            self.y_data.push(y[i]);
            let cx = (x[i] * self.inv_cell_size).floor() as i64;
            let cy = (y[i] * self.inv_cell_size).floor() as i64;
            self.cells.entry(cell_hash(cx, cy)).or_default().push(idx);
            inserted += 1;
        }
        inserted
    }

    /// Return the indices of all points within `radius` of `(px, py)`.
    pub fn query_radius(&self, px: f64, py: f64, radius: f64) -> Vec<u32> {
        let r2 = radius * radius;
        let cx_min = ((px - radius) * self.inv_cell_size).floor() as i64;
        let cx_max = ((px + radius) * self.inv_cell_size).floor() as i64;
        let cy_min = ((py - radius) * self.inv_cell_size).floor() as i64;
        let cy_max = ((py + radius) * self.inv_cell_size).floor() as i64;

        let mut result = Vec::new();
        for cx in cx_min..=cx_max {
            for cy in cy_min..=cy_max {
                if let Some(indices) = self.cells.get(&cell_hash(cx, cy)) {
                    for &idx in indices {
                        let dx = self.x_data[idx as usize] - px;
                        let dy = self.y_data[idx as usize] - py;
                        if dx * dx + dy * dy <= r2 {
                            result.push(idx);
                        }
                    }
                }
            }
        }
        result
    }

    /// Return the indices of all points inside the axis-aligned bounding box
    /// `[x_min, x_max] x [y_min, y_max]` (inclusive).
    pub fn query_range(&self, x_min: f64, x_max: f64, y_min: f64, y_max: f64) -> Vec<u32> {
        let cx_min = (x_min * self.inv_cell_size).floor() as i64;
        let cx_max = (x_max * self.inv_cell_size).floor() as i64;
        let cy_min = (y_min * self.inv_cell_size).floor() as i64;
        let cy_max = (y_max * self.inv_cell_size).floor() as i64;

        let mut result = Vec::new();
        for cx in cx_min..=cx_max {
            for cy in cy_min..=cy_max {
                if let Some(indices) = self.cells.get(&cell_hash(cx, cy)) {
                    for &idx in indices {
                        let x = self.x_data[idx as usize];
                        let y = self.y_data[idx as usize];
                        if x >= x_min && x <= x_max && y >= y_min && y <= y_max {
                            result.push(idx);
                        }
                    }
                }
            }
        }
        result
    }

    /// The cell size used for hashing.
    #[wasm_bindgen(getter)]
    pub fn cell_size(&self) -> f64 {
        self.cell_size
    }

    /// Total number of inserted (finite) points.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> usize {
        self.x_data.len()
    }

    /// Number of occupied hash cells.
    #[wasm_bindgen(getter)]
    pub fn cell_count(&self) -> usize {
        self.cells.len()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- insert + query_radius ------------------------------------------------

    #[test]
    fn insert_and_query_radius() {
        let mut grid = SpatialHashGrid::new(1.0);
        let x = vec![0.0, 1.0, 2.0, 10.0];
        let y = vec![0.0, 0.0, 0.0, 0.0];
        let inserted = grid.insert_batch(&x, &y);
        assert_eq!(inserted, 4);

        let result = grid.query_radius(0.0, 0.0, 1.5);
        // Should find (0,0) and (1,0). (2,0) is at distance 2.0, outside 1.5.
        assert!(result.contains(&0));
        assert!(result.contains(&1));
        assert!(!result.contains(&2));
        assert!(!result.contains(&3));
    }

    #[test]
    fn query_radius_exact_boundary() {
        let mut grid = SpatialHashGrid::new(1.0);
        grid.insert_batch(&[3.0], &[4.0]);
        // Distance from origin to (3,4) is exactly 5.0
        let result = grid.query_radius(0.0, 0.0, 5.0);
        assert!(
            result.contains(&0),
            "boundary point should be included (<=)"
        );
    }

    // -- insert + query_range -------------------------------------------------

    #[test]
    fn insert_and_query_range() {
        let mut grid = SpatialHashGrid::new(1.0);
        let x = vec![0.5, 1.5, 2.5, 5.0];
        let y = vec![0.5, 0.5, 0.5, 0.5];
        grid.insert_batch(&x, &y);

        let result = grid.query_range(0.0, 2.0, 0.0, 1.0);
        assert!(result.contains(&0));
        assert!(result.contains(&1));
        assert!(!result.contains(&2));
        assert!(!result.contains(&3));
    }

    #[test]
    fn query_range_boundary_inclusive() {
        let mut grid = SpatialHashGrid::new(1.0);
        grid.insert_batch(&[2.0], &[3.0]);
        let result = grid.query_range(2.0, 2.0, 3.0, 3.0);
        assert!(result.contains(&0), "boundary point should be included");
    }

    // -- Empty grid -----------------------------------------------------------

    #[test]
    fn empty_grid_queries() {
        let grid = SpatialHashGrid::new(1.0);
        assert_eq!(grid.count(), 0);
        assert_eq!(grid.cell_count(), 0);
        assert!(grid.query_radius(0.0, 0.0, 100.0).is_empty());
        assert!(grid.query_range(-10.0, 10.0, -10.0, 10.0).is_empty());
    }

    // -- NaN points skipped ---------------------------------------------------

    #[test]
    fn nan_points_skipped() {
        let mut grid = SpatialHashGrid::new(1.0);
        let x = vec![1.0, f64::NAN, 2.0, f64::INFINITY];
        let y = vec![1.0, 1.0, f64::NAN, 1.0];
        let inserted = grid.insert_batch(&x, &y);
        // Only the first point (1.0, 1.0) is fully finite.
        assert_eq!(inserted, 1);
        assert_eq!(grid.count(), 1);
    }

    // -- Large scale (10K) ----------------------------------------------------

    #[test]
    fn large_scale_insert_and_query() {
        let n = 10_000usize;
        let mut grid = SpatialHashGrid::new(10.0);
        let x: Vec<f64> = (0..n).map(|i| (i as f64 * 0.1).sin() * 100.0).collect();
        let y: Vec<f64> = (0..n).map(|i| (i as f64 * 0.07).cos() * 100.0).collect();
        let inserted = grid.insert_batch(&x, &y);
        assert_eq!(inserted, n as u32);
        assert_eq!(grid.count(), n);

        // Radius query around the origin should return a subset.
        let result = grid.query_radius(0.0, 0.0, 10.0);
        assert!(!result.is_empty());
        // Verify all returned indices are actually within radius.
        for &idx in &result {
            let dx = x[idx as usize];
            let dy = y[idx as usize];
            assert!(
                dx * dx + dy * dy <= 100.0 + 1e-9,
                "point {} at ({}, {}) is outside radius 10",
                idx,
                dx,
                dy
            );
        }
    }

    // -- cell_count grows correctly -------------------------------------------

    #[test]
    fn cell_count_grows() {
        let mut grid = SpatialHashGrid::new(1.0);
        assert_eq!(grid.cell_count(), 0);

        // Two points in the same cell.
        grid.insert_batch(&[0.1, 0.2], &[0.1, 0.2]);
        assert_eq!(grid.cell_count(), 1);

        // A point in a different cell.
        grid.insert_batch(&[5.0], &[5.0]);
        assert_eq!(grid.cell_count(), 2);

        // Another distinct cell.
        grid.insert_batch(&[-3.0], &[-3.0]);
        assert_eq!(grid.cell_count(), 3);
    }
}
