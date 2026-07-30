use vizcrush_core::find_padded_bounds;
use wasm_bindgen::prelude::*;

const MAX_POINTS_PER_NODE: usize = 64;
const MAX_DEPTH: usize = 12;

/// An octree node. Stores either points (leaf) or references to 8 children.
#[derive(Clone)]
struct OctNode {
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    z_min: f64,
    z_max: f64,
    /// Range [start..end) into the shared indices array.
    start: usize,
    end: usize,
    /// Child node indices in the arena: 8 octants, or None if leaf.
    /// Order: [−x−y−z, +x−y−z, −x+y−z, +x+y−z, −x−y+z, +x−y+z, −x+y+z, +x+y+z]
    children: Option<[usize; 8]>,
}

/// Octree built from 3D point data. Supports range and nearest-neighbor queries.
#[wasm_bindgen]
pub struct Octree {
    nodes: Vec<OctNode>,
    /// Partitioned index array — each node owns a contiguous slice.
    indices: Vec<u32>,
    x_data: Vec<f64>,
    y_data: Vec<f64>,
    z_data: Vec<f64>,
}

#[wasm_bindgen]
impl Octree {
    /// Returns the bounding box as [x_min, x_max, y_min, y_max, z_min, z_max].
    pub fn bounds(&self) -> Vec<f64> {
        if self.nodes.is_empty() {
            return vec![];
        }
        let root = &self.nodes[0];
        vec![
            root.x_min, root.x_max, root.y_min, root.y_max, root.z_min, root.z_max,
        ]
    }

    /// Returns the total number of points.
    pub fn point_count(&self) -> usize {
        self.x_data.len()
    }

    /// Range query: find all point indices within the given 3D bounding box.
    pub fn query_range(
        &self,
        x_min: f64,
        x_max: f64,
        y_min: f64,
        y_max: f64,
        z_min: f64,
        z_max: f64,
    ) -> Vec<u32> {
        let mut result = Vec::new();
        if !self.nodes.is_empty() {
            self.range_search(0, x_min, x_max, y_min, y_max, z_min, z_max, &mut result);
        }
        result
    }

    /// k-nearest neighbor query in 3D.
    pub fn query_nearest(&self, px: f64, py: f64, pz: f64, k: usize) -> Vec<u32> {
        if self.x_data.is_empty() || k == 0 {
            return vec![];
        }

        let mut candidates: Vec<(f64, u32)> = Vec::with_capacity(k + 1);
        let mut max_dist = f64::INFINITY;

        if !self.nodes.is_empty() {
            self.knn_search(0, px, py, pz, k, &mut candidates, &mut max_dist);
        }

        candidates.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        candidates.truncate(k);
        candidates.iter().map(|(_, idx)| *idx).collect()
    }
}

impl Octree {
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
        z_min: f64,
        z_max: f64,
        result: &mut Vec<u32>,
    ) {
        let node = &self.nodes[node_idx];

        // Skip if query box doesn't intersect this node
        if x_max < node.x_min
            || x_min > node.x_max
            || y_max < node.y_min
            || y_min > node.y_max
            || z_max < node.z_min
            || z_min > node.z_max
        {
            return;
        }

        // If this node is fully contained, bulk-add all points
        if x_min <= node.x_min
            && x_max >= node.x_max
            && y_min <= node.y_min
            && y_max >= node.y_max
            && z_min <= node.z_min
            && z_max >= node.z_max
        {
            self.collect_all_points(node_idx, result);
            return;
        }

        // Check individual points in this node (leaf points)
        for &idx in self.node_indices(node_idx) {
            let px = self.x_data[idx as usize];
            let py = self.y_data[idx as usize];
            let pz = self.z_data[idx as usize];
            if px >= x_min
                && px <= x_max
                && py >= y_min
                && py <= y_max
                && pz >= z_min
                && pz <= z_max
            {
                result.push(idx);
            }
        }

        // Recurse into children
        if let Some(children) = node.children {
            for &child_idx in &children {
                self.range_search(child_idx, x_min, x_max, y_min, y_max, z_min, z_max, result);
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
        pz: f64,
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
        let dz = if pz < node.z_min {
            node.z_min - pz
        } else if pz > node.z_max {
            pz - node.z_max
        } else {
            0.0
        };
        let min_dist_sq = dx * dx + dy * dy + dz * dz;

        if min_dist_sq > *max_dist * *max_dist && candidates.len() >= k {
            return;
        }

        // Check points in this node
        for &idx in self.node_indices(node_idx) {
            let d = dist_sq_3d(
                px,
                py,
                pz,
                self.x_data[idx as usize],
                self.y_data[idx as usize],
                self.z_data[idx as usize],
            );
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
                self.knn_search(child_idx, px, py, pz, k, candidates, max_dist);
            }
        }
    }
}

fn dist_sq_3d(ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64) -> f64 {
    let dx = ax - bx;
    let dy = ay - by;
    let dz = az - bz;
    dx * dx + dy * dy + dz * dz
}

/// Determine which octant a point falls into.
/// Returns 0..7 based on which side of each midpoint the point lies.
#[inline]
fn octant(px: f64, py: f64, pz: f64, x_mid: f64, y_mid: f64, z_mid: f64) -> usize {
    let mut idx = 0;
    if px >= x_mid {
        idx |= 1;
    }
    if py >= y_mid {
        idx |= 2;
    }
    if pz >= z_mid {
        idx |= 4;
    }
    idx
}

/// Build an octree from x/y/z coordinate arrays.
#[wasm_bindgen]
pub fn build_octree(x: &[f64], y: &[f64], z: &[f64]) -> Octree {
    let n = x.len();
    assert_eq!(n, y.len(), "x and y must have equal length");
    assert_eq!(n, z.len(), "x and z must have equal length");

    if n == 0 {
        return Octree {
            nodes: vec![],
            indices: vec![],
            x_data: vec![],
            y_data: vec![],
            z_data: vec![],
        };
    }

    // Find bounds (0.1%-padded, points with any non-finite axis excluded).
    let bounds = find_padded_bounds(&[x, y, z]);
    let (x_min, x_max) = bounds[0];
    let (y_min, y_max) = bounds[1];
    let (z_min, z_max) = bounds[2];

    let mut indices: Vec<u32> = (0..n as u32).collect();
    let x_data = x.to_vec();
    let y_data = y.to_vec();
    let z_data = z.to_vec();

    let mut nodes = Vec::new();
    build_node(
        &mut nodes,
        &x_data,
        &y_data,
        &z_data,
        &mut indices,
        0,
        n,
        x_min,
        x_max,
        y_min,
        y_max,
        z_min,
        z_max,
        0,
    );

    Octree {
        nodes,
        indices,
        x_data,
        y_data,
        z_data,
    }
}

/// Build a node operating on `indices[start..end]`. Partitions indices in-place
/// into eight octants to avoid allocating new Vecs at each level.
#[allow(clippy::too_many_arguments)]
fn build_node(
    nodes: &mut Vec<OctNode>,
    x: &[f64],
    y: &[f64],
    z: &[f64],
    indices: &mut [u32],
    start: usize,
    end: usize,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    z_min: f64,
    z_max: f64,
    depth: usize,
) -> usize {
    let node_idx = nodes.len();

    // Filter to only points within bounds — partition in-bounds points to the front.
    let slice = &mut indices[start..end];
    let mut in_count = 0;
    for i in 0..slice.len() {
        let idx = slice[i] as usize;
        let px = x[idx];
        let py = y[idx];
        let pz = z[idx];
        if px >= x_min && px <= x_max && py >= y_min && py <= y_max && pz >= z_min && pz <= z_max {
            slice.swap(i, in_count);
            in_count += 1;
        }
    }
    let end = start + in_count;

    if in_count <= MAX_POINTS_PER_NODE || depth >= MAX_DEPTH {
        // Leaf node
        nodes.push(OctNode {
            x_min,
            x_max,
            y_min,
            y_max,
            z_min,
            z_max,
            start,
            end,
            children: None,
        });
        return node_idx;
    }

    // Internal node — split into 8 octants via in-place partitioning.
    let x_mid = (x_min + x_max) / 2.0;
    let y_mid = (y_min + y_max) / 2.0;
    let z_mid = (z_min + z_max) / 2.0;

    // Count points per octant
    let slice = &indices[start..end];
    let mut counts = [0usize; 8];
    for &idx in slice {
        let q = octant(
            x[idx as usize],
            y[idx as usize],
            z[idx as usize],
            x_mid,
            y_mid,
            z_mid,
        );
        counts[q] += 1;
    }

    // Compute starting offsets for each octant within [start..end]
    let mut offsets = [0usize; 8];
    offsets[0] = start;
    for i in 1..8 {
        offsets[i] = offsets[i - 1] + counts[i - 1];
    }

    // Partition: copy to temp buffer, scatter back by octant.
    let slice = indices[start..end].to_vec();
    let mut cursors = offsets;
    for &idx in &slice {
        let q = octant(
            x[idx as usize],
            y[idx as usize],
            z[idx as usize],
            x_mid,
            y_mid,
            z_mid,
        );
        indices[cursors[q]] = idx;
        cursors[q] += 1;
    }

    // Push placeholder node (internal nodes store no direct points)
    nodes.push(OctNode {
        x_min,
        x_max,
        y_min,
        y_max,
        z_min,
        z_max,
        start: 0,
        end: 0,
        children: None,
    });

    // Build children for all 8 octants.
    // Octant bit layout: bit0 = x>=mid, bit1 = y>=mid, bit2 = z>=mid
    let child_bounds: [(f64, f64, f64, f64, f64, f64); 8] = [
        (x_min, x_mid, y_min, y_mid, z_min, z_mid), // 0: -x -y -z
        (x_mid, x_max, y_min, y_mid, z_min, z_mid), // 1: +x -y -z
        (x_min, x_mid, y_mid, y_max, z_min, z_mid), // 2: -x +y -z
        (x_mid, x_max, y_mid, y_max, z_min, z_mid), // 3: +x +y -z
        (x_min, x_mid, y_min, y_mid, z_mid, z_max), // 4: -x -y +z
        (x_mid, x_max, y_min, y_mid, z_mid, z_max), // 5: +x -y +z
        (x_min, x_mid, y_mid, y_max, z_mid, z_max), // 6: -x +y +z
        (x_mid, x_max, y_mid, y_max, z_mid, z_max), // 7: +x +y +z
    ];

    let mut child_indices = [0usize; 8];
    for i in 0..8 {
        let c_start = offsets[i];
        let c_end = offsets[i] + counts[i];
        let (cxn, cxx, cyn, cyx, czn, czx) = child_bounds[i];
        child_indices[i] = build_node(
            nodes,
            x,
            y,
            z,
            indices,
            c_start,
            c_end,
            cxn,
            cxx,
            cyn,
            cyx,
            czn,
            czx,
            depth + 1,
        );
    }

    nodes[node_idx].children = Some(child_indices);

    node_idx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_octree_build_and_range() {
        let n = 1000;
        let x: Vec<f64> = (0..n).map(|i| (i % 10) as f64).collect();
        let y: Vec<f64> = (0..n).map(|i| ((i / 10) % 10) as f64).collect();
        let z: Vec<f64> = (0..n).map(|i| (i / 100) as f64).collect();

        let tree = build_octree(&x, &y, &z);
        assert_eq!(tree.point_count(), 1000);

        // Query a small box
        let results = tree.query_range(2.0, 5.0, 3.0, 7.0, 1.0, 4.0);
        assert!(!results.is_empty());

        // All results should be within bounds
        for &idx in &results {
            let px = x[idx as usize];
            let py = y[idx as usize];
            let pz = z[idx as usize];
            assert!((2.0..=5.0).contains(&px), "x={px} out of range");
            assert!((3.0..=7.0).contains(&py), "y={py} out of range");
            assert!((1.0..=4.0).contains(&pz), "z={pz} out of range");
        }
    }

    #[test]
    fn test_octree_nearest() {
        let x = vec![0.0, 10.0, 20.0, 30.0, 40.0];
        let y = vec![0.0, 10.0, 20.0, 30.0, 40.0];
        let z = vec![0.0, 10.0, 20.0, 30.0, 40.0];

        let tree = build_octree(&x, &y, &z);
        let nearest = tree.query_nearest(11.0, 11.0, 11.0, 2);
        assert_eq!(nearest.len(), 2);
        // point (10,10,10) should be closest
        assert!(nearest.contains(&1));
    }

    #[test]
    fn test_octree_empty() {
        let tree = build_octree(&[], &[], &[]);
        assert_eq!(tree.point_count(), 0);
        assert!(tree
            .query_range(0.0, 100.0, 0.0, 100.0, 0.0, 100.0)
            .is_empty());
        assert!(tree.query_nearest(0.0, 0.0, 0.0, 1).is_empty());
    }

    #[test]
    fn test_octree_full_range() {
        let x: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let y: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let z: Vec<f64> = (0..100).map(|i| i as f64).collect();

        let tree = build_octree(&x, &y, &z);
        let results = tree.query_range(-1.0, 100.0, -1.0, 100.0, -1.0, 100.0);
        assert_eq!(results.len(), 100);
    }
}
