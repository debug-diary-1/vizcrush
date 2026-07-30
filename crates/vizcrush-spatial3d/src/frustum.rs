use wasm_bindgen::prelude::*;

/// A single frustum plane defined by normal (a, b, c) and distance d.
/// A point P is on the inside (visible) side if: a*Px + b*Py + c*Pz + d > 0.
#[derive(Clone, Debug)]
struct FrustumPlane {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
}

impl FrustumPlane {
    /// Normalize the plane so that (a,b,c) is a unit vector.
    fn normalize(&mut self) {
        let len = (self.a * self.a + self.b * self.b + self.c * self.c).sqrt();
        if len > 1e-12 {
            self.a /= len;
            self.b /= len;
            self.c /= len;
            self.d /= len;
        }
    }

    /// Signed distance from point to plane. Positive = inside (visible side).
    #[inline]
    fn distance_to(&self, x: f64, y: f64, z: f64) -> f64 {
        self.a * x + self.b * y + self.c * z + self.d
    }
}

/// A view frustum consisting of 6 planes.
struct Frustum {
    planes: [FrustumPlane; 6],
}

impl Frustum {
    /// Test whether a point is inside the frustum (on the positive side of all 6 planes).
    #[inline]
    fn contains(&self, x: f64, y: f64, z: f64) -> bool {
        for plane in &self.planes {
            if plane.distance_to(x, y, z) < 0.0 {
                return false;
            }
        }
        true
    }
}

/// Cull 3D points against a view frustum.
///
/// # Arguments
/// * `x`, `y`, `z` - Coordinate arrays (same length).
/// * `planes` - 24 f64 values representing 6 frustum planes (a, b, c, d each).
///   Plane order: left, right, bottom, top, near, far.
///
/// # Returns
/// Indices of points that lie inside the frustum.
#[wasm_bindgen]
pub fn frustum_cull(x: &[f64], y: &[f64], z: &[f64], planes: &[f64]) -> Vec<u32> {
    let n = x.len();
    assert_eq!(n, y.len(), "x and y must have equal length");
    assert_eq!(n, z.len(), "x and z must have equal length");
    assert_eq!(
        planes.len(),
        24,
        "planes must contain 24 f64 values (6 planes x 4 components)"
    );

    let frustum = decode_planes(planes);

    let mut result = Vec::new();
    for i in 0..n {
        if !x[i].is_finite() || !y[i].is_finite() || !z[i].is_finite() {
            continue;
        }
        if frustum.contains(x[i], y[i], z[i]) {
            result.push(i as u32);
        }
    }
    result
}

/// Extract 6 frustum planes from a 4x4 Model-View-Projection matrix using the
/// Gribb-Hartmann method.
///
/// # Arguments
/// * `mvp` - 16 f64 values in column-major order (OpenGL/WebGPU convention).
///
/// # Returns
/// 24 f64 values (6 planes x 4 components: a, b, c, d).
/// Plane order: left, right, bottom, top, near, far.
#[wasm_bindgen]
pub fn build_frustum_from_mvp(mvp: &[f64]) -> Vec<f64> {
    assert_eq!(
        mvp.len(),
        16,
        "mvp must contain 16 f64 values (4x4 matrix, column-major)"
    );

    // Column-major indexing: element at row r, col c = mvp[c*4 + r]
    // Row 0: mvp[0], mvp[4], mvp[8],  mvp[12]
    // Row 1: mvp[1], mvp[5], mvp[9],  mvp[13]
    // Row 2: mvp[2], mvp[6], mvp[10], mvp[14]
    // Row 3: mvp[3], mvp[7], mvp[11], mvp[15]

    let row = |r: usize| -> (f64, f64, f64, f64) { (mvp[r], mvp[4 + r], mvp[8 + r], mvp[12 + r]) };

    let r0 = row(0);
    let r1 = row(1);
    let r2 = row(2);
    let r3 = row(3);

    // Gribb-Hartmann: plane = row3 +/- rowN
    let mut planes = [
        // Left:   row3 + row0
        FrustumPlane {
            a: r3.0 + r0.0,
            b: r3.1 + r0.1,
            c: r3.2 + r0.2,
            d: r3.3 + r0.3,
        },
        // Right:  row3 - row0
        FrustumPlane {
            a: r3.0 - r0.0,
            b: r3.1 - r0.1,
            c: r3.2 - r0.2,
            d: r3.3 - r0.3,
        },
        // Bottom: row3 + row1
        FrustumPlane {
            a: r3.0 + r1.0,
            b: r3.1 + r1.1,
            c: r3.2 + r1.2,
            d: r3.3 + r1.3,
        },
        // Top:    row3 - row1
        FrustumPlane {
            a: r3.0 - r1.0,
            b: r3.1 - r1.1,
            c: r3.2 - r1.2,
            d: r3.3 - r1.3,
        },
        // Near:   row3 + row2
        FrustumPlane {
            a: r3.0 + r2.0,
            b: r3.1 + r2.1,
            c: r3.2 + r2.2,
            d: r3.3 + r2.3,
        },
        // Far:    row3 - row2
        FrustumPlane {
            a: r3.0 - r2.0,
            b: r3.1 - r2.1,
            c: r3.2 - r2.2,
            d: r3.3 - r2.3,
        },
    ];

    for p in &mut planes {
        p.normalize();
    }

    let mut result = Vec::with_capacity(24);
    for p in &planes {
        result.push(p.a);
        result.push(p.b);
        result.push(p.c);
        result.push(p.d);
    }
    result
}

/// Decode 24 f64 values into a Frustum with 6 normalized planes.
fn decode_planes(data: &[f64]) -> Frustum {
    let planes: [FrustumPlane; 6] = std::array::from_fn(|i| {
        let base = i * 4;
        let mut p = FrustumPlane {
            a: data[base],
            b: data[base + 1],
            c: data[base + 2],
            d: data[base + 3],
        };
        p.normalize();
        p
    });
    Frustum { planes }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_frustum_cull_basic() {
        // Create a simple frustum: a box from -1 to 1 on all axes.
        // 6 planes inward-pointing normals:
        // Left:   ( 1, 0, 0, 1)  =>  x + 1 > 0  =>  x > -1
        // Right:  (-1, 0, 0, 1)  => -x + 1 > 0  =>  x < 1
        // Bottom: ( 0, 1, 0, 1)  =>  y + 1 > 0  =>  y > -1
        // Top:    ( 0,-1, 0, 1)  => -y + 1 > 0  =>  y < 1
        // Near:   ( 0, 0, 1, 1)  =>  z + 1 > 0  =>  z > -1
        // Far:    ( 0, 0,-1, 1)  => -z + 1 > 0  =>  z < 1
        let planes = vec![
            1.0, 0.0, 0.0, 1.0, // left
            -1.0, 0.0, 0.0, 1.0, // right
            0.0, 1.0, 0.0, 1.0, // bottom
            0.0, -1.0, 0.0, 1.0, // top
            0.0, 0.0, 1.0, 1.0, // near
            0.0, 0.0, -1.0, 1.0, // far
        ];

        // Points: inside, outside-left, outside-right, inside-edge, behind
        let x = vec![0.0, -2.0, 2.0, 0.5, 0.0];
        let y = vec![0.0, 0.0, 0.0, 0.5, 0.0];
        let z = vec![0.0, 0.0, 0.0, 0.5, -3.0];

        let result = frustum_cull(&x, &y, &z, &planes);
        // Points 0 (origin) and 3 (0.5,0.5,0.5) should be inside
        assert!(result.contains(&0), "origin should be inside");
        assert!(result.contains(&3), "(0.5,0.5,0.5) should be inside");
        // Points 1, 2, 4 should be outside
        assert!(!result.contains(&1), "(-2,0,0) should be outside");
        assert!(!result.contains(&2), "(2,0,0) should be outside");
        assert!(!result.contains(&4), "(0,0,-3) should be outside");
    }

    #[test]
    fn test_frustum_from_mvp() {
        // Identity matrix — should produce valid 6 planes.
        let identity = vec![
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ];

        let planes = build_frustum_from_mvp(&identity);
        assert_eq!(planes.len(), 24, "should return 24 values (6 planes x 4)");

        // For identity MVP, Gribb-Hartmann gives:
        // Left:   (1, 0, 0, 1), Right: (-1, 0, 0, 1)
        // Bottom: (0, 1, 0, 1), Top:   (0, -1, 0, 1)
        // Near:   (0, 0, 1, 1), Far:   (0, 0, -1, 1)
        // After normalization, they stay the same (normals already unit length).

        // Check left plane: a=1, b=0, c=0, d=1 (normalized)
        assert!((planes[0] - 1.0).abs() < 1e-9, "left plane a");
        assert!((planes[1] - 0.0).abs() < 1e-9, "left plane b");
        assert!((planes[2] - 0.0).abs() < 1e-9, "left plane c");
        assert!((planes[3] - 1.0).abs() < 1e-9, "left plane d");

        // Verify a point at origin passes all 6 planes from identity MVP
        let x = vec![0.0];
        let y = vec![0.0];
        let z = vec![0.0];
        let result = frustum_cull(&x, &y, &z, &planes);
        assert_eq!(result.len(), 1, "origin should be inside identity frustum");
    }
}
