# vizcrush MCP Demo

This directory contains configuration files and scenario transcripts
showing how AI coding agents use vizcrush tools.

## Setup

Copy the appropriate config into your AI tool:

- **Claude Code / Claude Desktop**: `mcp-config-claude.json` → `claude_desktop_config.json`
- **Cursor**: `mcp-config-cursor.json` → `.cursor/mcp.json`
- **VS Code**: `mcp-config-vscode.json` → `.vscode/mcp.json`

Or run the HTTP server for remote access:

```bash
npx @vizcrush/mcp-server --transport http --port 3847
```

## Available Tools

| Tool                       | Description                      |
| -------------------------- | -------------------------------- |
| `vizcrush_lttb`            | LTTB downsampling                |
| `vizcrush_minmax_lttb`     | MinMax + LTTB (spiky data)       |
| `vizcrush_auto_downsample` | Auto-select best algorithm       |
| `vizcrush_histogram`       | 1D histogram                     |
| `vizcrush_bin2d`           | 2D density grid                  |
| `vizcrush_build_index`     | Build spatial index              |
| `vizcrush_query_range`     | Range query on spatial index     |
| `vizcrush_stats`           | Summary statistics + percentiles |
| `vizcrush_normalize`       | Min-max normalization            |
| `vizcrush_sort`            | Radix sort                       |
| `vizcrush_capabilities`    | Environment detection            |
| `vizcrush_benchmark`       | Performance comparison           |
| `vizcrush_load_file`       | Load CSV file                    |
| `vizcrush_inspect_file`    | Inspect CSV columns              |
