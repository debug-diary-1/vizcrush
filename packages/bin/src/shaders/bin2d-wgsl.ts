/**
 * The bin2d compute shader as an importable string — the wired copy of
 * `bin2d.wgsl` in this directory. The `.wgsl` file stays the source of truth
 * (it's what shader tooling reads); a unit test asserts the two are identical
 * so they cannot drift. Plain `tsc` builds this package, so a `.ts` module is
 * the bundler-free way to ship the source text.
 */
export const BIN2D_WGSL = `// WebGPU compute shader for 2D density grid binning.
//
// Uses workgroup-level shared memory histogram to reduce atomic contention.
// Each workgroup accumulates into a local histogram, then merges into the
// global grid with a single atomicAdd per non-zero bin.
//
// Without this optimization, high-density bins (thousands of points in one cell)
// serialize on the global atomic — killing GPU parallelism.

const WG_SIZE: u32 = 256u;
// Max bins we can fit in workgroup shared memory (16KB limit / 4 bytes = 4096)
const MAX_LOCAL_BINS: u32 = 4096u;

struct Params {
  point_count: u32,
  x_bins: u32,
  y_bins: u32,
  _pad: u32,
  x_min: f32,
  x_max: f32,
  y_min: f32,
  y_max: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> x_data: array<f32>;
@group(0) @binding(2) var<storage, read> y_data: array<f32>;
@group(0) @binding(3) var<storage, read_write> grid: array<atomic<u32>>;

// Shared memory for workgroup-local histogram
var<workgroup> local_bins: array<atomic<u32>, 4096>;

@compute @workgroup_size(256)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>,
) {
  let grid_size = params.x_bins * params.y_bins;
  let use_local = grid_size <= MAX_LOCAL_BINS;

  // Phase 1: Zero local histogram (each thread zeroes a portion)
  if (use_local) {
    let bins_per_thread = (grid_size + WG_SIZE - 1u) / WG_SIZE;
    for (var b = 0u; b < bins_per_thread; b = b + 1u) {
      let bin_idx = lid.x * bins_per_thread + b;
      if (bin_idx < grid_size) {
        atomicStore(&local_bins[bin_idx], 0u);
      }
    }
    workgroupBarrier();
  }

  // Phase 2: Bin points into local or global histogram
  let idx = gid.x;
  if (idx < params.point_count) {
    let px = x_data[idx];
    let py = y_data[idx];

    // Skip NaN
    if (px == px && py == py) {
      let x_range = params.x_max - params.x_min;
      let y_range = params.y_max - params.y_min;

      if (x_range > 0.0 && y_range > 0.0) {
        var xi = u32(floor((px - params.x_min) / x_range * f32(params.x_bins)));
        var yi = u32(floor((py - params.y_min) / y_range * f32(params.y_bins)));

        if (xi >= params.x_bins) { xi = params.x_bins - 1u; }
        if (yi >= params.y_bins) { yi = params.y_bins - 1u; }

        let bin_idx = yi * params.x_bins + xi;

        if (use_local) {
          // Workgroup-local atomic — much less contention
          atomicAdd(&local_bins[bin_idx], 1u);
        } else {
          // Grid too large for shared memory — fall back to global atomics
          atomicAdd(&grid[bin_idx], 1u);
        }
      }
    }
  }

  // Phase 3: Merge local histogram into global grid
  if (use_local) {
    workgroupBarrier();

    let bins_per_thread = (grid_size + WG_SIZE - 1u) / WG_SIZE;
    for (var b = 0u; b < bins_per_thread; b = b + 1u) {
      let bin_idx = lid.x * bins_per_thread + b;
      if (bin_idx < grid_size) {
        let count = atomicLoad(&local_bins[bin_idx]);
        if (count > 0u) {
          // One global atomic per non-zero bin per workgroup
          // vs one per POINT in the naive version
          atomicAdd(&grid[bin_idx], count);
        }
      }
    }
  }
}
`;
