// WebGPU compute shader for 3D voxel binning.
//
// Each thread processes one point: computes the (xi, yi, zi) bin indices
// and atomically increments the corresponding voxel in the flat grid.
// Grid layout: grid[zi * y_bins * x_bins + yi * x_bins + xi]

const WG_SIZE: u32 = 256u;

struct Params {
  point_count: u32,
  x_bins: u32,
  y_bins: u32,
  z_bins: u32,
  x_min: f32,
  x_max: f32,
  y_min: f32,
  y_max: f32,
  z_min: f32,
  z_max: f32,
  _pad0: f32,
  _pad1: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> x_data: array<f32>;
@group(0) @binding(2) var<storage, read> y_data: array<f32>;
@group(0) @binding(3) var<storage, read> z_data: array<f32>;
@group(0) @binding(4) var<storage, read_write> grid: array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.point_count) {
    return;
  }

  let px = x_data[idx];
  let py = y_data[idx];
  let pz = z_data[idx];

  // Skip NaN (NaN != NaN)
  if (px != px || py != py || pz != pz) {
    return;
  }

  let x_range = params.x_max - params.x_min;
  let y_range = params.y_max - params.y_min;
  let z_range = params.z_max - params.z_min;

  if (x_range <= 0.0 || y_range <= 0.0 || z_range <= 0.0) {
    return;
  }

  var xi = u32(floor((px - params.x_min) / x_range * f32(params.x_bins)));
  var yi = u32(floor((py - params.y_min) / y_range * f32(params.y_bins)));
  var zi = u32(floor((pz - params.z_min) / z_range * f32(params.z_bins)));

  // Clamp to valid bin range
  if (xi >= params.x_bins) { xi = params.x_bins - 1u; }
  if (yi >= params.y_bins) { yi = params.y_bins - 1u; }
  if (zi >= params.z_bins) { zi = params.z_bins - 1u; }

  let bin_idx = zi * params.y_bins * params.x_bins + yi * params.x_bins + xi;

  atomicAdd(&grid[bin_idx], 1u);
}
