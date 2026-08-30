import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dependabotUsesNpm, findNonFrozenPnpmInstalls } from "./dependency-policy.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dependabot = await readFile(join(root, ".github/dependabot.yml"), "utf8");
if (dependabotUsesNpm(dependabot)) {
  throw new Error(
    "Dependabot npm updates are disabled: its pnpm-catalog lockfile output is not frozen-install compatible",
  );
}

const violations = [];
const workflowDirectory = join(root, ".github/workflows");
for (const entry of await readdir(workflowDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) continue;
  const source = await readFile(join(workflowDirectory, entry.name), "utf8");
  for (const lineNumber of findNonFrozenPnpmInstalls(source)) {
    violations.push(`${entry.name}:${lineNumber}`);
  }
}

if (violations.length > 0) {
  throw new Error(`CI installs must use --frozen-lockfile: ${violations.join(", ")}`);
}

console.log("verified pnpm catalog dependency policy and frozen CI installs");
