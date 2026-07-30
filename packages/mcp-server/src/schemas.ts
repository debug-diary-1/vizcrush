import { z } from "zod";

export const DownsampleInput = z.object({
  x: z.array(z.number()).describe("X values (timestamps). Must be strictly increasing."),
  y: z.array(z.number()).describe("Y values (metrics). Same length as x."),
  target_points: z.number().int().min(2).describe("Desired output count"),
  backend: z
    .enum(["auto", "wasm", "js"])
    .default("auto")
    .describe(
      "Compute backend. 'auto' uses WASM above a size threshold, JS below it. There is no separate " +
        "'wasm-simd' path — one SIMD-enabled WASM binary is always built. The response's backend_used " +
        "field reports what actually ran, not just this request.",
    ),
});

export const AutoDownsampleInput = z.object({
  x: z.array(z.number()).describe("X values"),
  y: z.array(z.number()).describe("Y values"),
  target_points: z.number().int().min(2).describe("Desired output count"),
  data_hint: z
    .enum(["time_series", "scatter", "financial", "sensor"])
    .optional()
    .describe("Hint for algorithm selection"),
});

export const HistogramInput = z.object({
  data: z.array(z.number()).describe("Input values"),
  bins: z.number().int().min(1).default(50).describe("Number of bins"),
  range: z.tuple([z.number(), z.number()]).optional().describe("Custom range [min, max]"),
});

export const Bin2dInput = z.object({
  x: z.array(z.number()).describe("X coordinates"),
  y: z.array(z.number()).describe("Y coordinates"),
  x_bins: z.number().int().min(1).default(256).describe("Horizontal bins"),
  y_bins: z.number().int().min(1).default(256).describe("Vertical bins"),
  x_range: z.tuple([z.number(), z.number()]).optional().describe("Custom x range"),
  y_range: z.tuple([z.number(), z.number()]).optional().describe("Custom y range"),
});

export const StatsInput = z.object({
  data: z.array(z.number()).describe("Input values"),
  percentiles: z.array(z.number()).default([50]).describe("Percentiles to compute"),
});

export const NormalizeInput = z.object({
  data: z.array(z.number()).describe("Input values"),
});

export const SortInput = z.object({
  data: z.array(z.number()).describe("Input values"),
  descending: z.boolean().default(false).describe("Sort in descending order"),
});

export const BenchmarkInput = z.object({
  data_size: z.number().int().min(100).default(100000).describe("Points to benchmark"),
  algorithms: z.array(z.string()).default(["lttb", "bin2d"]).describe("Algorithms to benchmark"),
});

export type DownsampleInputType = z.infer<typeof DownsampleInput>;
export type AutoDownsampleInputType = z.infer<typeof AutoDownsampleInput>;
export type HistogramInputType = z.infer<typeof HistogramInput>;
export type Bin2dInputType = z.infer<typeof Bin2dInput>;
export type StatsInputType = z.infer<typeof StatsInput>;
export type NormalizeInputType = z.infer<typeof NormalizeInput>;
export type SortInputType = z.infer<typeof SortInput>;
export const BuildIndexInput = z.object({
  x: z.array(z.number()).describe("X coordinates"),
  y: z.array(z.number()).describe("Y coordinates"),
  index_id: z.string().optional().describe("Custom ID for the index. Default: auto UUID"),
});

export const QueryRangeInput = z.object({
  index_id: z.string().describe("ID from build_index"),
  x_min: z.number().describe("Left bound"),
  x_max: z.number().describe("Right bound"),
  y_min: z.number().describe("Bottom bound"),
  y_max: z.number().describe("Top bound"),
});

export const FileInput = z.object({
  file_path: z
    .string()
    .max(4096)
    .describe(
      "Path to CSV or Arrow file. Subject to path restrictions: must be within allowed directories (VIZCRUSH_ALLOWED_DIRS) and must not match blocked patterns (e.g., .ssh, .env, .pem).",
    ),
  x_column: z.string().optional().describe("Column name for X values"),
  y_column: z.string().optional().describe("Column name for Y values"),
  delimiter: z.string().default(",").describe("CSV delimiter"),
});

export const BuildIndex3dInput = z.object({
  x: z.array(z.number()).describe("X coordinates"),
  y: z.array(z.number()).describe("Y coordinates"),
  z: z.array(z.number()).describe("Z coordinates"),
  index_id: z.string().optional().describe("Custom ID. Default: auto"),
});

export const QueryRange3dInput = z.object({
  index_id: z.string().describe("ID from build_index_3d"),
  x_min: z.number(),
  x_max: z.number(),
  y_min: z.number(),
  y_max: z.number(),
  z_min: z.number(),
  z_max: z.number(),
});

export const Bin3dInput = z.object({
  x: z.array(z.number()).describe("X coordinates"),
  y: z.array(z.number()).describe("Y coordinates"),
  z: z.array(z.number()).describe("Z coordinates"),
  x_bins: z.number().int().min(1).default(32).describe("X grid divisions"),
  y_bins: z.number().int().min(1).default(32).describe("Y grid divisions"),
  z_bins: z.number().int().min(1).default(32).describe("Z grid divisions"),
});

export const FrustumCullInput = z.object({
  x: z.array(z.number()).describe("X coordinates"),
  y: z.array(z.number()).describe("Y coordinates"),
  z: z.array(z.number()).describe("Z coordinates"),
  mvp_matrix: z.array(z.number()).length(16).describe("4x4 MVP matrix (column-major, 16 values)"),
});

export type BenchmarkInputType = z.infer<typeof BenchmarkInput>;
export type BuildIndexInputType = z.infer<typeof BuildIndexInput>;
export type QueryRangeInputType = z.infer<typeof QueryRangeInput>;
export type FileInputType = z.infer<typeof FileInput>;
export type BuildIndex3dInputType = z.infer<typeof BuildIndex3dInput>;
export type QueryRange3dInputType = z.infer<typeof QueryRange3dInput>;
export type Bin3dInputType = z.infer<typeof Bin3dInput>;
export type FrustumCullInputType = z.infer<typeof FrustumCullInput>;

// ── AI Tools ──

export const SummarizeInput = z.object({
  data: z.array(z.number()).describe("Numeric values to summarize"),
});

export const DetectAnomaliesInput = z.object({
  data: z.array(z.number()).describe("Numeric values to scan for anomalies"),
  sensitivity: z.number().default(3).describe("Z-score threshold (default 3)"),
});

export const AutoOptimizeInput = z.object({
  x: z.array(z.number()).describe("X values"),
  y: z.array(z.number()).describe("Y values"),
  screen_width: z.number().int().optional().describe("Target screen width in pixels"),
});

export const ParseQueryInput = z.object({
  query: z.string().describe("Natural language query about the data"),
  data_length: z.number().int().describe("Number of data points"),
});

export const ShapeSimilarityInput = z.object({
  a: z.array(z.number()).describe("First time-series"),
  b: z.array(z.number()).describe("Second time-series"),
});

export type SummarizeInputType = z.infer<typeof SummarizeInput>;
export type DetectAnomaliesInputType = z.infer<typeof DetectAnomaliesInput>;
export type AutoOptimizeInputType = z.infer<typeof AutoOptimizeInput>;
export type ParseQueryInputType = z.infer<typeof ParseQueryInput>;
export type ShapeSimilarityInputType = z.infer<typeof ShapeSimilarityInput>;
