import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { FileInputType } from "../schemas.js";

const BLOCKED_PATTERNS = [
  /\/\.ssh\//i,
  /\/\.aws\//i,
  /\/\.env/i,
  /\/\.git\//i,
  /\/\.gnupg\//i,
  /\/\.config\/gh\//i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\/etc\/passwd/i,
  /\/etc\/shadow/i,
  /credentials/i,
  /secrets?\./i,
];

const configuredMaxFileSize = Number.parseInt(
  process.env.VIZCRUSH_MAX_FILE_SIZE || String(10 * 1024 * 1024),
  10,
);
const MAX_FILE_SIZE =
  Number.isSafeInteger(configuredMaxFileSize) && configuredMaxFileSize > 0
    ? configuredMaxFileSize
    : 10 * 1024 * 1024;

function validateFilePath(filePath: string): string {
  const resolved = resolve(filePath);

  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch (error: any) {
    if (error.code === "ENOENT") throw new Error(`File not found: '${filePath}'`);
    throw new Error(`Cannot access file: '${filePath}'`);
  }

  // Check against allowed base directories
  const allowedDirs = (process.env.VIZCRUSH_ALLOWED_DIRS || process.cwd())
    .split(",")
    .map((directory) => realpathSync(resolve(directory.trim())));

  const isAllowed = allowedDirs.some((dir) => {
    const rel = relative(dir, realPath);
    return !rel.startsWith("..") && !isAbsolute(rel);
  });

  if (!isAllowed) {
    throw new Error(
      `Access denied: '${filePath}' is outside allowed directories. ` +
        `Set VIZCRUSH_ALLOWED_DIRS to configure allowed paths.`,
    );
  }

  // Check blocked patterns
  const portableRealPath = realPath.replaceAll("\\", "/");
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(portableRealPath)) {
      throw new Error(`Access denied: '${filePath}' matches a blocked pattern.`);
    }
  }

  // Check file size
  try {
    const stat = statSync(realPath);
    if (!stat.isFile()) {
      throw new Error(`Access denied: '${filePath}' is not a regular file.`);
    }
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${(stat.size / 1048576).toFixed(1)}MB exceeds ` +
          `${(MAX_FILE_SIZE / 1048576).toFixed(0)}MB limit. Set VIZCRUSH_MAX_FILE_SIZE to adjust.`,
      );
    }
  } catch (e: any) {
    if (e.code === "ENOENT") throw new Error(`File not found: '${filePath}'`);
    if (e.message?.includes("Access denied") || e.message?.includes("File too large")) throw e;
    throw new Error(`Cannot access file: '${filePath}'`);
  }

  return realPath;
}

/**
 * Parse a CSV file into numeric arrays for vizcrush tools.
 * Supports custom delimiters and column selection.
 */
export function handleFileLoad(input: Omit<FileInputType, "max_rows"> & { max_rows?: number }) {
  const start = performance.now();
  const maxRows = input.max_rows ?? 100_000;

  let content: string;
  try {
    const safePath = validateFilePath(input.file_path);
    content = readFileSync(safePath, "utf-8");
  } catch (e) {
    return { error: `Failed to read file: ${(e as Error).message}` };
  }

  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { error: "File is empty" };
  }

  const delimiter = input.delimiter;
  const headers = lines[0].split(delimiter).map((h) => h.trim());

  // Determine columns
  const xCol = input.x_column ?? headers[0];
  const yCol = input.y_column ?? (headers.length > 1 ? headers[1] : headers[0]);

  const xIdx = headers.indexOf(xCol);
  const yIdx = headers.indexOf(yCol);

  if (xIdx === -1) {
    return {
      error: `Column '${xCol}' not found. Available: ${headers.join(", ")}`,
    };
  }
  if (yIdx === -1) {
    return {
      error: `Column '${yCol}' not found. Available: ${headers.join(", ")}`,
    };
  }

  const x: number[] = [];
  const y: number[] = [];
  let skipped = 0;
  let truncated = false;

  for (let i = 1; i < lines.length; i++) {
    if (x.length >= maxRows) {
      truncated = true;
      break;
    }
    const parts = lines[i].split(delimiter);
    const xVal = parseFloat(parts[xIdx]);
    const yVal = parseFloat(parts[yIdx]);

    if (isFinite(xVal) && isFinite(yVal)) {
      x.push(xVal);
      y.push(yVal);
    } else {
      skipped++;
    }
  }

  const elapsed = performance.now() - start;

  return {
    x,
    y,
    point_count: x.length,
    skipped_rows: skipped,
    truncated,
    columns: headers,
    x_column: xCol,
    y_column: yCol,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

/**
 * Detect file format and provide column info without loading all data.
 */
export function handleFileInspect(input: { file_path: string; delimiter?: string }) {
  let content: string;
  try {
    const safePath = validateFilePath(input.file_path);
    content = readFileSync(safePath, "utf-8");
  } catch (e) {
    return { error: `Failed to read file: ${(e as Error).message}` };
  }

  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { error: "File is empty" };

  const delim = input.delimiter ?? ",";
  const headers = lines[0].split(delim).map((h) => h.trim());
  const rowCount = lines.length - 1;

  // Sample first 5 rows
  const sample: Record<string, string[]> = {};
  for (const h of headers) sample[h] = [];

  for (let i = 1; i <= Math.min(5, lines.length - 1); i++) {
    const parts = lines[i].split(delim);
    for (let j = 0; j < headers.length; j++) {
      if (parts[j] !== undefined) {
        sample[headers[j]].push(parts[j].trim());
      }
    }
  }

  // Detect numeric columns
  const numericColumns = headers.filter((h) => sample[h].every((v) => !isNaN(parseFloat(v))));

  return {
    file_path: input.file_path,
    columns: headers,
    numeric_columns: numericColumns,
    row_count: rowCount,
    sample,
  };
}
