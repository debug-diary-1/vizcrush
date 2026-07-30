// WebGPU compute shader for parallel quadtree construction.
//
// Phase 1: Compute Morton codes for each point (Z-order curve).
// Phase 2: Sort by Morton code (done on CPU or separate shader).
// Phase 3: Build tree nodes from sorted Morton codes.
//
// This shader handles Phase 1: Morton code computation.

struct Params {
  point_count: u32,
  _pad: u32,
  x_min: f32,
  x_max: f32,
  y_min: f32,
  y_max: f32,
  _pad2: f32,
  _pad3: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> x_data: array<f32>;
@group(0) @binding(2) var<storage, read> y_data: array<f32>;
@group(0) @binding(3) var<storage, read_write> morton_codes: array<u32>;
@group(0) @binding(4) var<storage, read_write> indices: array<u32>;

// Interleave bits for Morton code (Z-order curve)
fn expand_bits(v: u32) -> u32 {
  var x = v & 0x0000FFFFu;
  x = (x | (x << 8u)) & 0x00FF00FFu;
  x = (x | (x << 4u)) & 0x0F0F0F0Fu;
  x = (x | (x << 2u)) & 0x33333333u;
  x = (x | (x << 1u)) & 0x55555555u;
  return x;
}

fn morton_2d(x: u32, y: u32) -> u32 {
  return expand_bits(x) | (expand_bits(y) << 1u);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.point_count) {
    return;
  }

  let px = x_data[idx];
  let py = y_data[idx];

  // Normalize to [0, 65535] for 16-bit Morton codes
  let x_range = params.x_max - params.x_min;
  let y_range = params.y_max - params.y_min;

  var nx = 0u;
  var ny = 0u;

  if (x_range > 0.0 && y_range > 0.0) {
    nx = u32(clamp((px - params.x_min) / x_range * 65535.0, 0.0, 65535.0));
    ny = u32(clamp((py - params.y_min) / y_range * 65535.0, 0.0, 65535.0));
  }

  morton_codes[idx] = morton_2d(nx, ny);
  indices[idx] = idx;
}
