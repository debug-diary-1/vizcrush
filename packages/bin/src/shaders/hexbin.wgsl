// WebGPU compute shader for hexagonal binning.
// Maps each point to the nearest hex center and atomically increments.

struct Params {
  point_count: u32,
  radius: f32,
  x_min: f32,
  y_min: f32,
  cols: u32,
  rows: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> x_data: array<f32>;
@group(0) @binding(2) var<storage, read> y_data: array<f32>;
@group(0) @binding(3) var<storage, read_write> counts: array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.point_count) {
    return;
  }

  let px = x_data[idx];
  let py = y_data[idx];

  if (px != px || py != py) {
    return;
  }

  let dx = params.radius * 2.0;
  let dy = params.radius * sqrt(3.0);

  // Approximate row/col
  let row_f = (py - params.y_min) / dy;
  var row = u32(round(row_f));
  if (row >= params.rows) {
    row = params.rows - 1u;
  }

  let offset = select(0.0, params.radius, row % 2u == 1u);
  let col_f = (px - params.x_min - offset) / dx;
  var col = u32(round(col_f));
  if (col >= params.cols) {
    col = params.cols - 1u;
  }

  let grid_idx = row * params.cols + col;
  atomicAdd(&counts[grid_idx], 1u);
}
