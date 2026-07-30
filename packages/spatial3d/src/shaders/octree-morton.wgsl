// WebGPU compute shader for parallel 3D octree construction.
//
// Phase 1: Compute 3D Morton codes (Z-order curve) for each point.
// Uses 10 bits per dimension for a 30-bit Morton code.
// Phase 2: Sort by Morton code (done on CPU or separate shader).
// Phase 3: Build tree nodes from sorted Morton codes.
//
// This shader handles Phase 1: 3D Morton code computation.

struct Params {
  point_count: u32,
  _pad: u32,
  x_min: f32,
  x_max: f32,
  y_min: f32,
  y_max: f32,
  z_min: f32,
  z_max: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> x_data: array<f32>;
@group(0) @binding(2) var<storage, read> y_data: array<f32>;
@group(0) @binding(3) var<storage, read> z_data: array<f32>;
@group(0) @binding(4) var<storage, read_write> morton_codes: array<u32>;
@group(0) @binding(5) var<storage, read_write> indices: array<u32>;

// Interleave bits for 3D Morton code.
// Spreads 10 input bits across 30 bits with 2-bit gaps between each.
// Input:  ---- ---- ---- ---- ---- --98 7654 3210
// Output: --9--8--7--6--5--4--3--2--1--0
fn expand_bits_3d(v: u32) -> u32 {
  var x = v & 0x000003FFu; // keep lowest 10 bits
  x = (x | (x << 16u)) & 0x030000FFu; // ---- --98 ---- ---- ---- ---- 7654 3210
  x = (x | (x << 8u))  & 0x0300F00Fu; // ---- --98 ---- ---- 7654 ---- ---- 3210
  x = (x | (x << 4u))  & 0x030C30C3u; // ---- --98 ---- 76-- ---- 54-- ---- 32-- ---- 10
  x = (x | (x << 2u))  & 0x09249249u; // ---- 9--8 --7- -6-- 5--4 --3- -2-- 1--0
  return x;
}

// Compute 30-bit 3D Morton code from three 10-bit coordinates.
// Interleaving: x occupies bits 0,3,6,...  y occupies bits 1,4,7,...  z occupies bits 2,5,8,...
fn morton_3d(x: u32, y: u32, z: u32) -> u32 {
  return expand_bits_3d(x) | (expand_bits_3d(y) << 1u) | (expand_bits_3d(z) << 2u);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.point_count) {
    return;
  }

  let px = x_data[idx];
  let py = y_data[idx];
  let pz = z_data[idx];

  // Normalize to [0, 1023] for 10-bit Morton codes per dimension
  let x_range = params.x_max - params.x_min;
  let y_range = params.y_max - params.y_min;
  let z_range = params.z_max - params.z_min;

  var nx = 0u;
  var ny = 0u;
  var nz = 0u;

  if (x_range > 0.0 && y_range > 0.0 && z_range > 0.0) {
    nx = u32(clamp((px - params.x_min) / x_range * 1023.0, 0.0, 1023.0));
    ny = u32(clamp((py - params.y_min) / y_range * 1023.0, 0.0, 1023.0));
    nz = u32(clamp((pz - params.z_min) / z_range * 1023.0, 0.0, 1023.0));
  }

  morton_codes[idx] = morton_3d(nx, ny, nz);
  indices[idx] = idx;
}
