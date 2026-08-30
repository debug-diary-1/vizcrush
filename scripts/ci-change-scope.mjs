import { pathToFileURL } from "node:url";

export function isDocumentationOnlyPath(path) {
  return path === "LICENSE" || path.endsWith(".md") || path.startsWith("docs/");
}

export function isDocumentationOnlyChange(paths) {
  return paths.length > 0 && paths.every(isDocumentationOnlyPath);
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  const paths = input.split("\n").filter(Boolean);
  process.stdout.write(`docs_only=${isDocumentationOnlyChange(paths)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
