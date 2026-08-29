import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const gallery = await readFile(new URL("examples/index.html", root), "utf8");
const catalogSource = gallery.match(/const examples = (\[[\s\S]*?\n\s*\]);/u)?.[1];

if (!catalogSource) {
  throw new Error("could not find the examples catalog in examples/index.html");
}

// The catalog is a checked-in array of data-only object literals. Evaluating
// that slice keeps this check aligned with the exact values the gallery uses.
const catalog = Function(`"use strict"; return (${catalogSource});`)();
const mismatches = [];
let checked = 0;

for (const example of catalog) {
  const sourceDirectory = new URL(`examples/${example.name}/src/`, root);
  const sourceFiles = await collectSourceFiles(sourceDirectory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

  // mcp-demo is a documentation walkthrough rather than a Vite source tree.
  if (sourceFiles.length === 0) continue;

  const usesVizcrush = await anyFileMatches(
    sourceFiles,
    /(?:from\s*|import\s*(?:\(\s*)?)["']@vizcrush\//u,
  );
  const claimedKind = example.kind ?? "vizcrush";
  const expectedKind = usesVizcrush ? "vizcrush" : "graphics";
  checked++;

  if (claimedKind !== expectedKind) {
    mismatches.push(`${example.name}: claims ${claimedKind}, source implies ${expectedKind}`);
  }
}

if (mismatches.length > 0) {
  throw new Error(`example claim mismatch:\n${mismatches.map((item) => `- ${item}`).join("\n")}`);
}

console.log(`verified source-import claims for ${checked} runnable example cards`);

async function collectSourceFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isDirectory())
      files.push(...(await collectSourceFiles(new URL(`${entry.name}/`, directory))));
    if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(path);
  }

  return files;
}

async function anyFileMatches(files, pattern) {
  for (const file of files) {
    if (pattern.test(await readFile(file, "utf8"))) return true;
  }
  return false;
}
