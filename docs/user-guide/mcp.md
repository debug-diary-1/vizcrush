# MCP Server (Claude / Cursor)

`@vizcrush/mcp-server` exposes a curated set of vizcrush workflows as **MCP tools** that AI agents like Claude Desktop, Claude Code, Cursor, and other MCP-aware clients can call directly.

This means an AI agent can "load my CSV, downsample to 1920 points, detect anomalies, and tell me what's interesting" without any glue code on your end.

## What's MCP?

[Model Context Protocol](https://modelcontextprotocol.io) is an open standard for AI agents to call tools and access resources from external servers. An MCP server exposes a list of typed tools; an agent picks which ones to call based on user intent.

vizcrush ships with **24 MCP tools** covering downsampling, binning, spatial indexing, statistics, and AI features. The generated [project inventory](../reference/generated-inventory.md) is the canonical list.

## Available tools

### Downsampling

| Tool                       | Purpose                        |
| -------------------------- | ------------------------------ |
| `vizcrush_lttb`            | LTTB downsampling              |
| `vizcrush_minmax_lttb`     | MinMax-LTTB (preserves spikes) |
| `vizcrush_auto_downsample` | Auto-pick the best algorithm   |

### Binning

| Tool                 | Purpose         |
| -------------------- | --------------- |
| `vizcrush_histogram` | 1D histogram    |
| `vizcrush_bin2d`     | 2D density grid |
| `vizcrush_bin3d`     | 3D voxel grid   |

### Spatial indexing

| Tool                      | Purpose                           |
| ------------------------- | --------------------------------- |
| `vizcrush_build_index`    | Build a 2D quadtree               |
| `vizcrush_query_range`    | Range query on a quadtree         |
| `vizcrush_delete_index`   | Release a stored 2D or 3D index   |
| `vizcrush_build_index_3d` | Build a 3D octree                 |
| `vizcrush_query_range_3d` | Range query on an octree          |
| `vizcrush_frustum_cull`   | Frustum culling for GPU rendering |

### Aggregate & transform

| Tool                 | Purpose                          |
| -------------------- | -------------------------------- |
| `vizcrush_stats`     | Summary statistics + percentiles |
| `vizcrush_normalize` | Min-max normalization            |
| `vizcrush_sort`      | Radix sort                       |

### AI

| Tool                        | Purpose                             |
| --------------------------- | ----------------------------------- |
| `vizcrush_summarize`        | Generate a structured data summary  |
| `vizcrush_detect_anomalies` | Anomaly detection (MAD-based)       |
| `vizcrush_ai_auto_optimize` | Recommend algorithm + parameters    |
| `vizcrush_parse_query`      | Parse a natural-language data query |
| `vizcrush_shape_similarity` | Compare two series by shape         |

### Utility

| Tool                    | Purpose                         |
| ----------------------- | ------------------------------- |
| `vizcrush_capabilities` | Report environment capabilities |
| `vizcrush_benchmark`    | Run a quick benchmark           |
| `vizcrush_load_file`    | Load a CSV file                 |
| `vizcrush_inspect_file` | Inspect CSV columns and dtypes  |

All tools have Zod-validated schemas (in `packages/mcp-server/src/schemas.ts`) so the agent gets exact type information for every parameter.

### File and index limits

File tools resolve symlinks before applying `VIZCRUSH_ALLOWED_DIRS`; a symlink inside an allowed directory cannot expose a target outside it. Files default to a 10 MiB limit (`VIZCRUSH_MAX_FILE_SIZE`), and `vizcrush_load_file` returns at most 100,000 rows unless `max_rows` is set to a smaller or larger value (maximum 1,000,000).

Spatial range tools return at most 10,000 indices per call and accept `offset`/`limit` for pagination. The server retains at most 16 indexes per dimension by default, evicts the least recently used index when full, and exposes `vizcrush_delete_index` for explicit cleanup. Set `VIZCRUSH_MAX_STORED_INDEXES` to a positive integer to change the retention cap.

## Transports

The MCP server supports two transports:

- **stdio** (default) — for desktop AI clients (Claude Desktop, Claude Code, Cursor) that launch the server as a subprocess
- **HTTP streaming** — for remote / hosted scenarios

## Setup: Claude Desktop

1. **Build the MCP server** (once, from the monorepo):

   ```bash
   cd /path/to/vizcrush
   pnpm install && pnpm build
   ```

2. **Edit `~/Library/Application Support/Claude/claude_desktop_config.json`** (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

   ```json
   {
     "mcpServers": {
       "vizcrush": {
         "command": "node",
         "args": ["/absolute/path/to/vizcrush/packages/mcp-server/dist/cli.js"]
       }
     }
   }
   ```

3. **Restart Claude Desktop.** You should see "vizcrush" in the MCP servers list with all tools available.

4. **Try it.** Open a chat and say: _"Load /tmp/data.csv, downsample the value column to 1000 points, and detect any anomalies."_ Claude will pick the right tools and report back.

## Setup: Claude Code

Add to `~/.claude.json` or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "vizcrush": {
      "command": "node",
      "args": ["/absolute/path/to/vizcrush/packages/mcp-server/dist/cli.js"]
    }
  }
}
```

## Setup: Cursor

In Cursor settings → MCP → Add server:

```json
{
  "mcpServers": {
    "vizcrush": {
      "command": "node",
      "args": ["/absolute/path/to/vizcrush/packages/mcp-server/dist/cli.js"]
    }
  }
}
```

## Setup: HTTP transport (remote)

The HTTP transport binds to `127.0.0.1` by default:

```bash
node packages/mcp-server/dist/cli.js --transport http --port 3847
```

Then point any MCP client at `http://localhost:3847/mcp`.

In tokenless loopback mode, the server accepts only the bound listener authority (or `localhost` on the same port). Requests with a forged `Host` are rejected, and browser requests with an `Origin` are rejected unless it exactly matches `VIZCRUSH_MCP_CORS_ORIGIN`. This binds local trust to the listener and prevents DNS-rebinding access.

To listen on a non-loopback interface, authentication is mandatory:

```bash
VIZCRUSH_MCP_TOKEN="$(openssl rand -hex 32)" \
  node packages/mcp-server/dist/cli.js --transport http --host 0.0.0.0 --port 3847
```

Clients send the token as `Authorization: Bearer <token>`. Request bodies are measured as they stream, including chunked requests, and are rejected above 10 MiB.

Browser clients require an explicit allowed origin, for example `VIZCRUSH_MCP_CORS_ORIGIN=https://app.example.com`. Preflight requests are accepted only when that variable is configured. When `VIZCRUSH_MCP_TOKEN` is set, tool requests must still carry its bearer token.

## Example agent prompts

Once configured, you can ask the agent things like:

- _"Load `/tmp/financial.csv`, build a quadtree on the (timestamp, price) columns, and tell me how many points are in the box (1700000000, 100, 1700100000, 150)."_
- _"Run `vizcrush_summarize` on the temperature series in `/tmp/sensors.csv` and explain what you find."_
- _"Downsample the `cpu_usage` column to 1920 points and check for anomalies above 90%."_
- _"Bin the (lat, lng) columns into a 256×256 density grid and tell me where the hottest cell is."_

The agent will pick the right tools, chain them, and report results in natural language.

## Inspecting tool schemas

For development, you can list and introspect tools without an AI client by using the MCP inspector:

```bash
npx @modelcontextprotocol/inspector node packages/mcp-server/dist/cli.js
```

This opens a browser UI at `http://localhost:5173` where you can call tools manually.

## See also

- **[Examples / mcp-demo](../reference/examples.md)** — full setup walkthrough with sample data
- **[@vizcrush/ai](../packages/ai.md)** — the underlying functions exposed via the AI tools
- **[parseDataQuery](../packages/ai.md#parsedataqueryquery-datainfo)** — how the natural-language query parsing works
