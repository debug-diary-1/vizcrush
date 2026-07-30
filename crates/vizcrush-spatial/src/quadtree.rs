use vizcrush_core::find_padded_bounds;
use wasm_bindgen::prelude::*;

const MAX_POINTS_PER_NODE: usize = 64;
const MAX_DEPTH: usize = 12;

/// A quadtree node. Stores either points (leaf) or references to 4 children.
#[derive(Clone)]
struct QuadNode {
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    /// Range [start..end) into the shared indices array.
    start: usize,
    end: usize,
    /// Child node indices in the arena: [NW, NE, SW, SE], or None if leaf.
    children: Option<[usize; 4]>,
}

/// Quadtree built from 2D point data. Supports range and nearest-neighbor queries.
#[wasm_bindgen]
pub struct Quadtree {
    nodes: Vec<QuadNode>,
    /// Partitioned index array — each node owns a contiguous slice.
    indices: Vec<u32>,
    x_data: Vec<f64>,
    y_data: Vec<f64>,
}

#[wasm_bindgen]
impl Quadtree {
    /// Returns the bounding box as [x_min, x_max, y_min, y_max].
    pub fn bounds(&self) -> Vec<f64> {
        if self.nodes.is_empty() {
            return vec![];
        }
        let root = &self.nodes[0];
        vec![root.x_min, root.x_max, root.y_min, root.y_max]
    }

    /// Returns the total number of points.
    pub fn point_count(&self) -> usize {
        self.x_data.len()
    }

    /// Range query: find all point indices within the given bounding box.
    pub fn query_range(&self, x_min: f64, x_max: f64, y_min: f64, y_max: f64) -> Vec<u32> {
        let mut result = Vec::new();
        if !self.nodes.is_empty() {
            self.range_search(0, x_min, x_max, y_min, y_max, &mut result);
        }
        result
    }

    /// k-nearest neighbor query.
    pub fn query_nearest(&self, px: f64, py: f64, k: usize) -> Vec<u32> {
        if self.x_data.is_empty() || k == 0 {
            return vec![];
        }

        // Brute-force kNN using the tree for pruning
        let mut candidates: Vec<(f64, u32)> = Vec::with_capacity(k + 1);
        let mut max_dist = f64::INFINITY;

        if !self.nodes.is_empty() {
            self.knn_search(0, px, py, k, &mut candidates, &mut max_dist);
        }

        candidates.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        candidates.truncate(k);
        candidates.iter().map(|(_, idx)| *idx).collect()
    }
}

impl Quadtree {
    /// Get the point indices for a node from the shared indices array.
    fn node_indices(&self, node_idx: usize) -> &[u32] {
        let node = &self.nodes[node_idx];
        &self.indices[node.start..node.end]
    }

    fn range_search(
        &self,
        node_idx: usize,
        x_min: f64,
        x_max: f64,
        y_min: f64,
        y_max: f64,
        result: &mut Vec<u32>,
    ) {
        let node = &self.nodes[node_idx];

        // Skip if query box doesn't intersect this node
        if x_max < node.x_min || x_min > node.x_max || y_max < node.y_min || y_min > node.y_max {
            return;
        }

        // If this node is fully contained, add all points
        if x_min <= node.x_min && x_max >= node.x_max && y_min <= node.y_min && y_max >= node.y_max
        {
            self.collect_all_points(node_idx, result);
            return;
        }

        // Check individual points in this node (leaf points only)
        for &idx in self.node_indices(node_idx) {
            let px = self.x_data[idx as usize];
            let py = self.y_data[idx as usize];
            if px >= x_min && px <= x_max && py >= y_min && py <= y_max {
                result.push(idx);
            }
        }

        // Recurse into children
        if let Some(children) = node.children {
            for &child_idx in &children {
                self.range_search(child_idx, x_min, x_max, y_min, y_max, result);
            }
        }
    }

    fn collect_all_points(&self, node_idx: usize, result: &mut Vec<u32>) {
        result.extend_from_slice(self.node_indices(node_idx));
        if let Some(children) = self.nodes[node_idx].children {
            for &child_idx in &children {
                self.collect_all_points(child_idx, result);
            }
        }
    }

    fn knn_search(
        &self,
        node_idx: usize,
        px: f64,
        py: f64,
        k: usize,
        candidates: &mut Vec<(f64, u32)>,
        max_dist: &mut f64,
    ) {
        let node = &self.nodes[node_idx];

        // Min distance from query point to node bounding box
        let dx = if px < node.x_min {
            node.x_min - px
        } else if px > node.x_max {
            px - node.x_max
        } else {
            0.0
        };
        let dy = if py < node.y_min {
            node.y_min - py
        } else if py > node.y_max {
            py - node.y_max
        } else {
            0.0
        };
        let min_dist_sq = dx * dx + dy * dy;

        if min_dist_sq > *max_dist * *max_dist && candidates.len() >= k {
            return;
        }

        // Check points in this node
        for &idx in self.node_indices(node_idx) {
            let d = dist_sq(px, py, self.x_data[idx as usize], self.y_data[idx as usize]);
            if candidates.len() < k || d < *max_dist * *max_dist {
                candidates.push((d, idx));
                candidates.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
                if candidates.len() > k {
                    candidates.truncate(k);
                }
                if candidates.len() == k {
                    *max_dist = candidates.last().unwrap().0.sqrt();
                }
            }
        }

        // Recurse into children
        if let Some(children) = node.children {
            for &child_idx in &children {
                self.knn_search(child_idx, px, py, k, candidates, max_dist);
            }
        }
    }
}

fn dist_sq(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let dx = ax - bx;
    let dy = ay - by;
    dx * dx + dy * dy
}

/// Determine which quadrant a point falls into.
/// Returns 0=NW, 1=NE, 2=SW, 3=SE.
#[inline]
fn quadrant(px: f64, py: f64, x_mid: f64, y_mid: f64) -> usize {
    let east = px >= x_mid;
    let south = py < y_mid;
    match (south, east) {
        (false, false) => 0, // NW
        (false, true) => 1,  // NE
        (true, false) => 2,  // SW
        (true, true) => 3,   // SE
    }
}

/// Build a quadtree from x/y coordinate arrays.
#[wasm_bindgen]
pub fn build_quadtree(x: &[f64], y: &[f64]) -> Quadtree {
    let n = x.len();
    assert_eq!(n, y.len(), "x and y must have equal length");

    if n == 0 {
        return Quadtree {
            nodes: vec![],
            indices: vec![],
            x_data: vec![],
            y_data: vec![],
        };
    }

    // Find bounds (0.1%-padded, points with any non-finite axis excluded).
    let bounds = find_padded_bounds(&[x, y]);
    let (x_min, x_max) = bounds[0];
    let (y_min, y_max) = bounds[1];

    let mut indices: Vec<u32> = (0..n as u32).collect();
    let x_data = x.to_vec();
    let y_data = y.to_vec();

    let mut nodes = Vec::new();
    build_node(
        &mut nodes,
        &x_data,
        &y_data,
        &mut indices,
        0,
        n,
        x_min,
        x_max,
        y_min,
        y_max,
        0,
    );

    Quadtree {
        nodes,
        indices,
        x_data,
        y_data,
    }
}

/// Build a node operating on `indices[start..end]`. Partitions indices in-place
/// into four quadrants to avoid allocating new Vecs at each level.
fn build_node(
    nodes: &mut Vec<QuadNode>,
    x: &[f64],
    y: &[f64],
    indices: &mut [u32],
    start: usize,
    end: usize,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    depth: usize,
) -> usize {
    let node_idx = nodes.len();
    let _count = end - start;

    // Filter to only points within bounds (needed at root, and for edge precision)
    // We do this by partitioning: move in-bounds points to the front.
    let slice = &mut indices[start..end];
    let mut in_count = 0;
    for i in 0..slice.len() {
        let idx = slice[i] as usize;
        let px = x[idx];
        let py = y[idx];
        if px >= x_min && px <= x_max && py >= y_min && py <= y_max {
            slice.swap(i, in_count);
            in_count += 1;
        }
    }
    let end = start + in_count;

    if in_count <= MAX_POINTS_PER_NODE || depth >= MAX_DEPTH {
        // Leaf node — points are indices[start..end]
        nodes.push(QuadNode {
            x_min,
            x_max,
            y_min,
            y_max,
            start,
            end,
            children: None,
        });
        return node_idx;
    }

    // Internal node — split into 4 quadrants via in-place partitioning.
    let x_mid = (x_min + x_max) / 2.0;
    let y_mid = (y_min + y_max) / 2.0;

    // Count points per quadrant
    let slice = &indices[start..end];
    let mut counts = [0usize; 4];
    for &idx in slice {
        let q = quadrant(x[idx as usize], y[idx as usize], x_mid, y_mid);
        counts[q] += 1;
    }

    // Compute starting offsets for each quadrant within [start..end]
    let mut offsets = [0usize; 4];
    offsets[0] = start;
    for i in 1..4 {
        offsets[i] = offsets[i - 1] + counts[i - 1];
    }

    // Partition in-place using a single pass with placement cursors.
    // Copy to a temp buffer to do a stable single-pass scatter.
    let slice = indices[start..end].to_vec();
    let mut cursors = offsets;
    for &idx in &slice {
        let q = quadrant(x[idx as usize], y[idx as usize], x_mid, y_mid);
        indices[cursors[q]] = idx;
        cursors[q] += 1;
    }

    // Push placeholder node (internal nodes store no direct points)
    nodes.push(QuadNode {
        x_min,
        x_max,
        y_min,
        y_max,
        start: 0,
        end: 0,
        children: None,
    });

    // Build children: NW(0), NE(1), SW(2), SE(3)
    let nw_start = offsets[0];
    let nw_end = offsets[0] + counts[0];
    let ne_start = offsets[1];
    let ne_end = offsets[1] + counts[1];
    let sw_start = offsets[2];
    let sw_end = offsets[2] + counts[2];
    let se_start = offsets[3];
    let se_end = offsets[3] + counts[3];

    let nw = build_node(
        nodes,
        x,
        y,
        indices,
        nw_start,
        nw_end,
        x_min,
        x_mid,
        y_mid,
        y_max,
        depth + 1,
    );
    let ne = build_node(
        nodes,
        x,
        y,
        indices,
        ne_start,
        ne_end,
        x_mid,
        x_max,
        y_mid,
        y_max,
        depth + 1,
    );
    let sw = build_node(
        nodes,
        x,
        y,
        indices,
        sw_start,
        sw_end,
        x_min,
        x_mid,
        y_min,
        y_mid,
        depth + 1,
    );
    let se = build_node(
        nodes,
        x,
        y,
        indices,
        se_start,
        se_end,
        x_mid,
        x_max,
        y_min,
        y_mid,
        depth + 1,
    );

    nodes[node_idx].children = Some([nw, ne, sw, se]);

    node_idx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quadtree_build_and_range() {
        let x: Vec<f64> = (0..1000).map(|i| (i % 100) as f64).collect();
        let y: Vec<f64> = (0..1000).map(|i| (i / 100) as f64).collect();

        let tree = build_quadtree(&x, &y);
        assert_eq!(tree.point_count(), 1000);

        // Query a small range
        let results = tree.query_range(10.0, 20.0, 2.0, 5.0);
        assert!(!results.is_empty());

        // All results should be within bounds
        for &idx in &results {
            let px = x[idx as usize];
            let py = y[idx as usize];
            assert!((10.0..=20.0).contains(&px), "x={px} out of range");
            assert!((2.0..=5.0).contains(&py), "y={py} out of range");
        }
    }

    #[test]
    fn test_quadtree_nearest() {
        let x = vec![0.0, 10.0, 20.0, 30.0, 40.0];
        let y = vec![0.0, 10.0, 20.0, 30.0, 40.0];

        let tree = build_quadtree(&x, &y);
        let nearest = tree.query_nearest(11.0, 11.0, 2);
        assert_eq!(nearest.len(), 2);
        assert!(nearest.contains(&1)); // point (10, 10) should be closest
    }

    #[test]
    fn test_quadtree_empty() {
        let tree = build_quadtree(&[], &[]);
        assert_eq!(tree.point_count(), 0);
        assert!(tree.query_range(0.0, 100.0, 0.0, 100.0).is_empty());
    }

    #[test]
    fn test_quadtree_full_range() {
        let x: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let y: Vec<f64> = (0..100).map(|i| i as f64).collect();

        let tree = build_quadtree(&x, &y);
        let results = tree.query_range(-1.0, 100.0, -1.0, 100.0);
        assert_eq!(results.len(), 100);
    }
}
