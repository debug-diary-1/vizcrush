#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import {
  DownsampleInput,
  AutoDownsampleInput,
  HistogramInput,
  Bin2dInput,
  StatsInput,
  NormalizeInput,
  SortInput,
  BenchmarkInput,
  BuildIndexInput,
  QueryRangeInput,
  DeleteIndexInput,
  FileInput,
  BuildIndex3dInput,
  QueryRange3dInput,
  Bin3dInput,
  FrustumCullInput,
  SummarizeInput,
  DetectAnomaliesInput,
  AutoOptimizeInput,
  ParseQueryInput,
  ShapeSimilarityInput,
} from "./schemas.js";
import { handleLttb, handleMinMaxLttb, handleAutoDownsample } from "./tools/downsample.js";
import { handleHistogram, handleBin2d } from "./tools/bin.js";
import { handleStats, handleNormalize, handleSort } from "./tools/stats.js";
import { handleCapabilities, handleBenchmark } from "./tools/utils.js";
import { handleBuildIndex, handleQueryRange } from "./tools/spatial.js";
import { handleDeleteIndex } from "./tools/index-lifecycle.js";
import {
  handleBuildIndex3d,
  handleQueryRange3d,
  handleBin3d,
  handleFrustumCull,
} from "./tools/spatial3d.js";
import { handleFileLoad, handleFileInspect } from "./tools/file-input.js";
import {
  handleSummarize,
  handleDetectAnomalies,
  handleAutoOptimize,
  handleParseQuery,
  handleShapeSimilarity,
} from "./tools/ai.js";

/**
 * Declarative description of one MCP tool. `registerTool` is the one place
 * that owns response-wrapping (content/JSON) — descriptors themselves never
 * touch the MCP response shape, so adding a tool means adding one entry here,
 * not copying the wrapper.
 */
interface ToolDescriptor {
  name: string;
  description: string;
  schema: ZodRawShape;
  handler: (input: any) => unknown | Promise<unknown>;
}

/** The one seam every tool crosses: schema + handler in, MCP content out. */
function registerTool(server: McpServer, tool: ToolDescriptor): void {
  server.tool(tool.name, tool.description, tool.schema, async (input) => ({
    content: [{ type: "text", text: JSON.stringify(await tool.handler(input), null, 2) }],
  }));
}

export const TOOLS: ToolDescriptor[] = [
  // ── Downsampling Tools ──
  {
    name: "vizcrush_lttb",
    description:
      "Downsample time-series data using Largest-Triangle-Three-Buckets. Preserves visual shape.",
    schema: DownsampleInput.shape,
    handler: handleLttb,
  },
  {
    name: "vizcrush_minmax_lttb",
    description:
      "MinMax pre-selection + LTTB downsampling. Better for spiky data (financial, IoT).",
    schema: DownsampleInput.shape,
    handler: handleMinMaxLttb,
  },
  {
    name: "vizcrush_auto_downsample",
    description:
      "Intelligently selects the best downsampling algorithm based on data characteristics.",
    schema: AutoDownsampleInput.shape,
    handler: handleAutoDownsample,
  },

  // ── Binning Tools ──
  {
    name: "vizcrush_histogram",
    description: "1D histogram binning. Returns bin counts and edges.",
    schema: HistogramInput.shape,
    handler: handleHistogram,
  },
  {
    name: "vizcrush_bin2d",
    description: "Compute a 2D density grid (heatmap) from scatter data.",
    schema: Bin2dInput.shape,
    handler: handleBin2d,
  },

  // ── Spatial Indexing Tools ──
  {
    name: "vizcrush_build_index",
    description: "Build a spatial index (quadtree) over 2D point data for fast range queries.",
    schema: BuildIndexInput.shape,
    handler: handleBuildIndex,
  },
  {
    name: "vizcrush_query_range",
    description: "Find all points within a bounding box using a previously built spatial index.",
    schema: QueryRangeInput.shape,
    handler: handleQueryRange,
  },
  {
    name: "vizcrush_delete_index",
    description: "Delete a stored 2D or 3D spatial index and release its memory.",
    schema: DeleteIndexInput.shape,
    handler: handleDeleteIndex,
  },

  // ── 3D Spatial Tools ──
  {
    name: "vizcrush_build_index_3d",
    description: "Build a 3D spatial index (octree) over 3D point data for range queries.",
    schema: BuildIndex3dInput.shape,
    handler: handleBuildIndex3d,
  },
  {
    name: "vizcrush_query_range_3d",
    description: "Find all points within a 3D bounding box using a previously built octree.",
    schema: QueryRange3dInput.shape,
    handler: handleQueryRange3d,
  },
  {
    name: "vizcrush_bin3d",
    description: "Compute a 3D voxel density grid from point cloud data.",
    schema: Bin3dInput.shape,
    handler: handleBin3d,
  },
  {
    name: "vizcrush_frustum_cull",
    description: "Cull 3D points outside a camera frustum defined by a 4x4 MVP matrix.",
    schema: FrustumCullInput.shape,
    handler: handleFrustumCull,
  },

  // ── Statistics & Transform Tools ──
  {
    name: "vizcrush_stats",
    description:
      "Compute summary statistics (count, min, max, mean, std_dev, percentiles) over a numeric array.",
    schema: StatsInput.shape,
    handler: handleStats,
  },
  {
    name: "vizcrush_normalize",
    description: "Min-max normalize values to [0, 1].",
    schema: NormalizeInput.shape,
    handler: handleNormalize,
  },
  {
    name: "vizcrush_sort",
    description: "Sort a numeric array. Uses radix sort in WASM, Array.sort in JS fallback.",
    schema: SortInput.shape,
    handler: handleSort,
  },

  // ── Utility Tools ──
  {
    name: "vizcrush_capabilities",
    description: "Report environment GPU/WASM capabilities.",
    schema: {},
    handler: () => handleCapabilities(),
  },
  {
    name: "vizcrush_benchmark",
    description: "Quick benchmark comparing backends on the current hardware.",
    schema: BenchmarkInput.shape,
    handler: handleBenchmark,
  },

  // ── File Input Tools (v0.4) ──
  {
    name: "vizcrush_load_file",
    description: "Load a CSV file into numeric arrays for use with other vizcrush tools.",
    schema: FileInput.shape,
    handler: handleFileLoad,
  },
  {
    name: "vizcrush_inspect_file",
    description:
      "Inspect a CSV file: show columns, row count, detect numeric columns, preview sample rows.",
    schema: {
      file_path: z.string().describe("Path to file"),
      delimiter: z.string().default(",").describe("CSV delimiter"),
    },
    handler: handleFileInspect,
  },

  // ── AI Tools ──
  {
    name: "vizcrush_summarize",
    description:
      "Summarize a numeric dataset: trend, distribution, spikes, anomalies, and a human-readable paragraph for LLM context.",
    schema: SummarizeInput.shape,
    handler: handleSummarize,
  },
  {
    name: "vizcrush_detect_anomalies",
    description:
      "Detect statistical anomalies (spikes, dips, shifts) using robust MAD-based Z-scores.",
    schema: DetectAnomaliesInput.shape,
    handler: handleDetectAnomalies,
  },
  {
    name: "vizcrush_ai_auto_optimize",
    description:
      "Analyze data characteristics and recommend optimal vizcrush algorithm, target points, and backend settings.",
    schema: AutoOptimizeInput.shape,
    handler: handleAutoOptimize,
  },
  {
    name: "vizcrush_parse_query",
    description:
      "Parse a natural language query about data into a structured operation (filter, anomaly, downsample, summarize).",
    schema: ParseQueryInput.shape,
    handler: handleParseQuery,
  },
  {
    name: "vizcrush_shape_similarity",
    description:
      "Compute shape similarity between two time-series using feature embeddings and cosine similarity.",
    schema: ShapeSimilarityInput.shape,
    handler: handleShapeSimilarity,
  },
];

/**
 * The package's real version — read at runtime so it can't drift from
 * package.json (works from both src/ under vitest and dist/ at runtime).
 */
const PACKAGE_VERSION: string = createRequire(import.meta.url)("../package.json").version;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "vizcrush",
    version: PACKAGE_VERSION,
  });

  for (const tool of TOOLS) {
    registerTool(server, tool);
  }

  // ── MCP Resources (v1.0) — expose spatial indexes ──

  server.resource("spatial-indexes", "vizcrush://indexes", async (uri) => {
    // Import the spatial tool module to access the index store
    const { getIndexList } = await import("./tools/spatial.js");
    const indexes = getIndexList();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              description: "All spatial indexes currently held in memory by vizcrush MCP server.",
              indexes,
            },
            null,
            2,
          ),
        },
      ],
    };
  });

  server.resource("spatial-index-detail", "vizcrush://indexes/{index_id}", async (uri, params) => {
    const { getIndexDetail } = await import("./tools/spatial.js");
    const indexId = (params as any).index_id;
    const detail = getIndexDetail(indexId);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(detail, null, 2),
        },
      ],
    };
  });

  // ── MCP Prompts (v0.3) ──

  server.prompt(
    "vizcrush_optimize_chart",
    "Analyze a dataset and recommend optimal downsampling strategy for chart rendering.",
    {
      data_size: z.string().describe("Number of data points"),
      chart_width: z.string().describe("Chart width in pixels"),
    },
    async ({ data_size, chart_width }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I have a dataset with ${data_size} data points that needs to be rendered in a chart ${chart_width}px wide.

Please analyze and recommend:
1. Call vizcrush_capabilities to check available backends
2. Call vizcrush_auto_downsample with target_points=${chart_width} to find the best algorithm
3. If the data is scatter (not time-series), also call vizcrush_bin2d for a density heatmap
4. Call vizcrush_stats to profile the data
5. Summarize: which algorithm, expected speedup, backend used, and whether a heatmap is better than points`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "vizcrush_profile_data",
    "Run statistics on a dataset and suggest the best visualization approach.",
    { data_description: z.string().describe("Description of the data") },
    async ({ data_description }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I have this data: ${data_description}

Please profile it by:
1. Call vizcrush_stats with percentiles [10, 25, 50, 75, 90, 95, 99]
2. If 2D scatter data, call vizcrush_bin2d to generate a density grid
3. Based on the distribution shape (skew, outliers, clusters), recommend:
   - Best chart type (line, scatter, heatmap, histogram)
   - Whether downsampling is needed (and which algorithm)
   - Appropriate axis ranges and scales (linear vs log)`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "vizcrush_migration_guide",
    "Generate code replacing CPU-bound downsampling with vizcrush.",
    { current_approach: z.string().describe("Current downsampling code or approach") },
    async ({ current_approach }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I currently use this approach for data processing: ${current_approach}

Please help me migrate to vizcrush:
1. Identify which vizcrush functions replace the current code
2. Show the before/after code changes
3. Call vizcrush_benchmark to estimate the speedup
4. Note any API differences or gotchas
5. Show how to add progressive fallback (WASM → JS) if needed`,
          },
        },
      ],
    }),
  );

  return server;
}
