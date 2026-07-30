use wasm_bindgen::prelude::*;

/// A balanced kd-tree for 2D point data.
///
/// Optimized for k-nearest-neighbor queries. Uses median-of-three
/// partitioning for balanced construction.

#[derive(Clone)]
struct KdNode {
    /// Index into original point array.
    point_idx: u32,
    /// Split dimension: 0 = x, 1 = y.
    split_dim: u8,
    /// Left child index (None if leaf).
    left: Option<usize>,
    /// Right child index (None if leaf).
    right: Option<usize>,
}

#[wasm_bindgen]
pub struct KdTree {
    nodes: Vec<KdNode>,
    x_data: Vec<f64>,
    y_data: Vec<f64>,
}

#[wasm_bindgen]
impl KdTree {
    pub fn point_count(&self) -> usize {
        self.x_data.len()
    }

    /// k-nearest neighbor query using kd-tree traversal with pruning.
    pub fn query_nearest(&self, px: f64, py: f64, k: usize) -> Vec<u32> {
        if self.nodes.is_empty() || k == 0 {
            return vec![];
        }

        let mut heap: Vec<(f64, u32)> = Vec::with_capacity(k + 1);
        let mut max_dist_sq = f64::INFINITY;

        self.knn_recurse(0, px, py, k, &mut heap, &mut max_dist_sq);

        heap.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        heap.truncate(k);
        heap.iter().map(|(_, idx)| *idx).collect()
    }

    /// Range query: all points within bounding box.
    pub fn query_range(&self, x_min: f64, x_max: f64, y_min: f64, y_max: f64) -> Vec<u32> {
        let mut result = Vec::new();
        if !self.nodes.is_empty() {
            self.range_recurse(0, x_min, x_max, y_min, y_max, &mut result);
        }
        result
    }
}

impl KdTree {
    fn knn_recurse(
        &self,
        node_idx: usize,
        px: f64,
        py: f64,
        k: usize,
        heap: &mut Vec<(f64, u32)>,
        max_dist_sq: &mut f64,
    ) {
        let node = &self.nodes[node_idx];
        let pt_x = self.x_data[node.point_idx as usize];
        let pt_y = self.y_data[node.point_idx as usize];

        let dist_sq = (px - pt_x) * (px - pt_x) + (py - pt_y) * (py - pt_y);

        if heap.len() < k || dist_sq < *max_dist_sq {
            heap.push((dist_sq, node.point_idx));
            heap.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            if heap.len() > k {
                heap.truncate(k);
            }
            if heap.len() == k {
                *max_dist_sq = heap.last().unwrap().0;
            }
        }

        // Determine which side to search first
        let query_val = if node.split_dim == 0 { px } else { py };
        let split_val = if node.split_dim == 0 { pt_x } else { pt_y };
        let diff = query_val - split_val;

        let (first, second) = if diff <= 0.0 {
            (node.left, node.right)
        } else {
            (node.right, node.left)
        };

        // Search nearer side
        if let Some(first_idx) = first {
            self.knn_recurse(first_idx, px, py, k, heap, max_dist_sq);
        }

        // Search farther side if it could contain closer points
        if diff * diff < *max_dist_sq || heap.len() < k {
            if let Some(second_idx) = second {
                self.knn_recurse(second_idx, px, py, k, heap, max_dist_sq);
            }
        }
    }

    fn range_recurse(
        &self,
        node_idx: usize,
        x_min: f64,
        x_max: f64,
        y_min: f64,
        y_max: f64,
        result: &mut Vec<u32>,
    ) {
        let node = &self.nodes[node_idx];
        let pt_x = self.x_data[node.point_idx as usize];
        let pt_y = self.y_data[node.point_idx as usize];

        if pt_x >= x_min && pt_x <= x_max && pt_y >= y_min && pt_y <= y_max {
            result.push(node.point_idx);
        }

        let split_val = if node.split_dim == 0 { pt_x } else { pt_y };
        let range_min = if node.split_dim == 0 { x_min } else { y_min };
        let range_max = if node.split_dim == 0 { x_max } else { y_max };

        if range_min <= split_val {
            if let Some(left) = node.left {
                self.range_recurse(left, x_min, x_max, y_min, y_max, result);
            }
        }
        if range_max >= split_val {
            if let Some(right) = node.right {
                self.range_recurse(right, x_min, x_max, y_min, y_max, result);
            }
        }
    }
}

/// Build a balanced kd-tree from x/y coordinate arrays.
#[wasm_bindgen]
pub fn build_kdtree(x: &[f64], y: &[f64]) -> KdTree {
    let n = x.len();
    assert_eq!(n, y.len(), "x and y must have equal length");

    if n == 0 {
        return KdTree {
            nodes: vec![],
            x_data: vec![],
            y_data: vec![],
        };
    }

    let mut indices: Vec<u32> = (0..n as u32).collect();
    let x_data = x.to_vec();
    let y_data = y.to_vec();
    let mut nodes = Vec::with_capacity(n);

    build_kd_node(&mut nodes, &mut indices, &x_data, &y_data, 0);

    KdTree {
        nodes,
        x_data,
        y_data,
    }
}

fn build_kd_node(
    nodes: &mut Vec<KdNode>,
    indices: &mut [u32],
    x: &[f64],
    y: &[f64],
    depth: usize,
) -> Option<usize> {
    if indices.is_empty() {
        return None;
    }

    let dim = (depth % 2) as u8;
    let mid = indices.len() / 2;

    // Partial sort to find median
    indices.select_nth_unstable_by(mid, |&a, &b| {
        let va = if dim == 0 {
            x[a as usize]
        } else {
            y[a as usize]
        };
        let vb = if dim == 0 {
            x[b as usize]
        } else {
            y[b as usize]
        };
        va.partial_cmp(&vb).unwrap_or(std::cmp::Ordering::Equal)
    });

    let node_idx = nodes.len();
    nodes.push(KdNode {
        point_idx: indices[mid],
        split_dim: dim,
        left: None,
        right: None,
    });

    let (left_slice, right_with_mid) = indices.split_at_mut(mid);
    let right_slice = if right_with_mid.len() > 1 {
        &mut right_with_mid[1..]
    } else {
        &mut []
    };

    let left = build_kd_node(nodes, left_slice, x, y, depth + 1);
    let right = build_kd_node(nodes, right_slice, x, y, depth + 1);

    nodes[node_idx].left = left;
    nodes[node_idx].right = right;

    Some(node_idx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kdtree_nearest() {
        let x = vec![0.0, 10.0, 20.0, 30.0, 40.0];
        let y = vec![0.0, 10.0, 20.0, 30.0, 40.0];

        let tree = build_kdtree(&x, &y);
        let result = tree.query_nearest(11.0, 11.0, 2);
        assert_eq!(result.len(), 2);
        assert!(result.contains(&1)); // (10,10) closest
    }

    #[test]
    fn test_kdtree_range() {
        let x: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let y: Vec<f64> = (0..100).map(|i| i as f64).collect();

        let tree = build_kdtree(&x, &y);
        let result = tree.query_range(10.0, 20.0, 10.0, 20.0);
        assert!(!result.is_empty());
        for &idx in &result {
            assert!(x[idx as usize] >= 10.0 && x[idx as usize] <= 20.0);
            assert!(y[idx as usize] >= 10.0 && y[idx as usize] <= 20.0);
        }
    }

    #[test]
    fn test_kdtree_large() {
        let n = 10_000;
        let x: Vec<f64> = (0..n).map(|i| (i as f64 * 7.0) % 1000.0).collect();
        let y: Vec<f64> = (0..n).map(|i| (i as f64 * 13.0) % 1000.0).collect();

        let tree = build_kdtree(&x, &y);
        assert_eq!(tree.point_count(), n);

        let result = tree.query_nearest(500.0, 500.0, 5);
        assert_eq!(result.len(), 5);
    }

    #[test]
    fn test_kdtree_empty() {
        let tree = build_kdtree(&[], &[]);
        assert_eq!(tree.point_count(), 0);
        assert!(tree.query_nearest(0.0, 0.0, 5).is_empty());
    }
}
