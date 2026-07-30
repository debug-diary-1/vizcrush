import { describe, test, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, TOOLS } from "./index.js";
import { handleLttb, handleMinMaxLttb, handleAutoDownsample } from "./tools/downsample.js";
import { handleHistogram, handleBin2d } from "./tools/bin.js";
import { handleBin3d } from "./tools/spatial3d.js";
import { bin1dCore, bin2dCore } from "@vizcrush/bin";
import { bin3dCore } from "@vizcrush/bin3d";
import { handleStats, handleNormalize, handleSort } from "./tools/stats.js";
import { handleCapabilities, handleBenchmark } from "./tools/utils.js";
import {
  handleBuildIndex,
  handleQueryRange,
  getIndexList,
  getIndexDetail,
} from "./tools/spatial.js";
import { handleFileInspect } from "./tools/file-input.js";

describe("MCP tool registry wiring", () => {
  test("every descriptor has a unique name", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(23);
  });

  test("createServer + a real client round-trip lists and calls a tool", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());

    const x = Array.from({ length: 100 }, (_, i) => i);
    const y = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1));
    const result = await client.callTool({
      name: "vizcrush_lttb",
      arguments: { x, y, target_points: 20, backend: "auto" },
    });
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.output_length).toBe(20);

    await client.close();
    await server.close();
  });
});

describe("MCP downsample tools", () => {
  const x = Array.from({ length: 100 }, (_, i) => i);
  const y = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1));

  test("vizcrush_lttb returns correct structure", async () => {
    const result = await handleLttb({ x, y, target_points: 20, backend: "auto" });
    expect(result.x.length).toBe(20);
    expect(result.y.length).toBe(20);
    expect(result.original_length).toBe(100);
    expect(result.output_length).toBe(20);
    expect(result.algorithm).toBe("lttb");
    expect(typeof result.elapsed_ms).toBe("number");
    expect(result.x[0]).toBe(0); // first preserved
    expect(result.x[19]).toBe(99); // last preserved
  });

  test("vizcrush_minmax_lttb returns result", async () => {
    const result = await handleMinMaxLttb({ x, y, target_points: 10, backend: "auto" });
    expect(result.output_length).toBe(10);
    expect(result.algorithm).toBe("minmax_lttb");
  });

  test("backend_used reflects what actually ran, not just the request", async () => {
    const forcedJs = await handleLttb({ x, y, target_points: 20, backend: "js" });
    expect(forcedJs.backend_used).toBe("js");

    // 100 points is below the kernel's default auto-threshold (1000), so
    // 'auto' legitimately resolves to the JS core here — deterministic
    // regardless of whether a WASM binary happens to be built in this
    // environment, unlike forcing 'wasm' would be.
    const auto = await handleLttb({ x, y, target_points: 20, backend: "auto" });
    expect(auto.backend_used).toBe("js");
  });

  test("vizcrush_auto_downsample selects algorithm by hint", () => {
    const ts = handleAutoDownsample({ x, y, target_points: 10, data_hint: "time_series" });
    expect(ts.algorithm).toBe("lttb");

    const fin = handleAutoDownsample({ x, y, target_points: 10, data_hint: "financial" });
    expect(fin.algorithm).toBe("minmax_lttb");

    const scatter = handleAutoDownsample({ x, y, target_points: 10, data_hint: "scatter" });
    expect(scatter.algorithm).toBe("m4");
  });

  test("threshold >= input returns all", async () => {
    const result = await handleLttb({
      x: [1, 2, 3],
      y: [4, 5, 6],
      target_points: 10,
      backend: "auto",
    });
    expect(result.x.length).toBe(3);
  });
});

describe("MCP bin tools", () => {
  test("vizcrush_histogram", () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const result = handleHistogram({ data, bins: 10 });
    expect(result.counts.length).toBe(10);
    expect(result.edges.length).toBe(11);
    const total = result.counts.reduce((a: number, b: number) => a + b, 0);
    expect(total).toBe(100);
  });

  test("vizcrush_bin2d", () => {
    const x = Array.from({ length: 50 }, (_, i) => i);
    const y = Array.from({ length: 50 }, (_, i) => i);
    const result = handleBin2d({ x, y, x_bins: 4, y_bins: 4 });
    expect(result.grid.length).toBe(4);
    expect(result.grid[0].length).toBe(4);
    expect(result.x_edges.length).toBe(5);
    expect(result.max_count).toBeGreaterThan(0);
  });

  test("vizcrush_bin3d", () => {
    const x = Array.from({ length: 50 }, (_, i) => i % 10);
    const y = Array.from({ length: 50 }, (_, i) => (i * 3) % 10);
    const z = Array.from({ length: 50 }, (_, i) => (i * 7) % 10);
    const result = handleBin3d({ x, y, z, x_bins: 2, y_bins: 2, z_bins: 2 });
    expect(result.grid.length).toBe(8);
    const total = result.grid.reduce((a: number, b: number) => a + b, 0);
    expect(total).toBe(50);
  });

  // Each handler must produce the same numbers as the shared core it now calls,
  // proving the former two copies can no longer drift.
  test("handlers agree with the shared cores", () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const h = handleHistogram({ data, bins: 10 });
    const c = bin1dCore(new Float64Array(data), 10);
    expect(h.counts).toEqual(Array.from(c.counts));
    expect(h.edges).toEqual(Array.from(c.edges));

    const x = Array.from({ length: 50 }, (_, i) => i);
    const y = Array.from({ length: 50 }, (_, i) => i);
    const b2 = handleBin2d({ x, y, x_bins: 4, y_bins: 4 });
    const c2 = bin2dCore(new Float64Array(x), new Float64Array(y), 4, 4, NaN, NaN, NaN, NaN);
    for (let yi = 0; yi < 4; yi++)
      for (let xi = 0; xi < 4; xi++) expect(b2.grid[yi][xi]).toBe(c2.grid[yi * 4 + xi]);

    const z = Array.from({ length: 50 }, (_, i) => (i * 7) % 10);
    const b3 = handleBin3d({
      x: x.map((v) => v % 10),
      y: y.map((v) => v % 10),
      z,
      x_bins: 2,
      y_bins: 2,
      z_bins: 2,
    });
    const c3 = bin3dCore(
      new Float64Array(x.map((v) => v % 10)),
      new Float64Array(y.map((v) => v % 10)),
      new Float64Array(z),
      { xBins: 2, yBins: 2, zBins: 2 },
    );
    expect(b3.grid).toEqual(Array.from(c3.grid));
  });
});

describe("MCP stats tools", () => {
  test("vizcrush_stats", () => {
    const result = handleStats({ data: [1, 2, 3, 4, 5], percentiles: [50] });
    expect(result.count).toBe(5);
    expect(result.min).toBe(1);
    expect(result.max).toBe(5);
    expect(result.mean).toBe(3);
    expect(result.percentiles.p50).toBe(3);
  });

  test("vizcrush_normalize", () => {
    const result = handleNormalize({ data: [0, 50, 100] });
    expect(result.data).toEqual([0, 0.5, 1]);
  });

  test("vizcrush_sort ascending", () => {
    const result = handleSort({ data: [5, 3, 1, 4, 2], descending: false });
    expect(result.data).toEqual([1, 2, 3, 4, 5]);
  });

  test("vizcrush_sort descending", () => {
    const result = handleSort({ data: [5, 3, 1, 4, 2], descending: true });
    expect(result.data).toEqual([5, 4, 3, 2, 1]);
  });
});

describe("MCP utility tools", () => {
  test("vizcrush_capabilities", () => {
    const result = handleCapabilities();
    expect(result).toHaveProperty("webgpu");
    expect(result).toHaveProperty("wasm_simd");
    expect(result).toHaveProperty("runtime", "node");
  });

  test("vizcrush_benchmark", () => {
    const result = handleBenchmark({ data_size: 1000, algorithms: ["lttb"] });
    expect(result.data_size).toBe(1000);
    expect(result.results.lttb).toBeDefined();
    expect(typeof result.results.lttb.median_ms).toBe("number");
  });
});

describe("MCP spatial tools", () => {
  test("build_index + query_range round-trip", () => {
    const x = Array.from({ length: 100 }, (_, i) => i);
    const y = Array.from({ length: 100 }, (_, i) => i);

    const buildResult = handleBuildIndex({ x, y, index_id: "test_idx" });
    expect(buildResult.index_id).toBe("test_idx");
    expect(buildResult.point_count).toBe(100);

    const queryResult = handleQueryRange({
      index_id: "test_idx",
      x_min: 10,
      x_max: 20,
      y_min: 10,
      y_max: 20,
    });
    expect(queryResult.count).toBeGreaterThan(0);
    for (const idx of queryResult.indices!) {
      expect(x[idx]).toBeGreaterThanOrEqual(10);
      expect(x[idx]).toBeLessThanOrEqual(20);
    }
  });

  test("query_range with invalid index returns error", () => {
    const result = handleQueryRange({
      index_id: "nonexistent",
      x_min: 0,
      x_max: 1,
      y_min: 0,
      y_max: 1,
    });
    expect(result).toHaveProperty("error");
  });

  test("getIndexList returns array", () => {
    const list = getIndexList();
    expect(Array.isArray(list)).toBe(true);
  });

  test("getIndexDetail returns info", () => {
    const x = Array.from({ length: 10 }, (_, i) => i);
    const y = Array.from({ length: 10 }, (_, i) => i);
    handleBuildIndex({ x, y, index_id: "detail_test" });

    const detail = getIndexDetail("detail_test");
    expect(detail.point_count).toBe(10);
    expect(detail.sample_points!.length).toBe(10);
  });
});

describe("MCP file tools", () => {
  test("inspect nonexistent file returns error", () => {
    const result = handleFileInspect({ file_path: "/nonexistent/file.csv" });
    expect(result).toHaveProperty("error");
  });
});
