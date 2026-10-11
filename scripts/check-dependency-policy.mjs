import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dependabotUsesNpm,
  findNonFrozenPnpmInstalls,
  findUnpinnedCargoInstalls,
  findWorkspaceWildcardDependencies,
} from "./dependency-policy.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dependabot = await readFile(join(root, ".github/dependabot.yml"), "utf8");
if (dependabotUsesNpm(dependabot)) {
  throw new Error(
    "Dependabot npm updates are disabled: its pnpm-catalog lockfile output is not frozen-install compatible",
  );
}

const violations = [];
const cargoInstallViolations = [];
const workflowDirectory = join(root, ".github/workflows");
for (const entry of await readdir(workflowDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) continue;
  const source = await readFile(join(workflowDirectory, entry.name), "utf8");
  for (const lineNumber of findNonFrozenPnpmInstalls(source)) {
    violations.push(`${entry.name}:${lineNumber}`);
  }
  for (const lineNumber of findUnpinnedCargoInstalls(source)) {
    cargoInstallViolations.push(`${entry.name}:${lineNumber}`);
  }
}

if (violations.length > 0) {
  throw new Error(`CI installs must use --frozen-lockfile: ${violations.join(", ")}`);
}
if (cargoInstallViolations.length > 0) {
  throw new Error(
    `CI cargo installs must pin --version and use --locked: ${cargoInstallViolations.join(", ")}`,
  );
}

// benchmarks/* and examples/* are private, never published, and legitimately keep
// workspace:* — only packages/* manifests reach a registry, where pnpm rewrites
// workspace:* into an exact version at pack time.
const workspaceWildcardViolations = [];
const packagesDirectory = join(root, "packages");
for (const entry of await readdir(packagesDirectory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = JSON.parse(
    await readFile(join(packagesDirectory, entry.name, "package.json"), "utf8"),
  );
  for (const { field, name, versionRange } of findWorkspaceWildcardDependencies(manifest)) {
    workspaceWildcardViolations.push(`${manifest.name} ${field}.${name} is "${versionRange}"`);
  }
}

if (workspaceWildcardViolations.length > 0) {
  throw new Error(
    `Inter-package dependencies must be declared "workspace:^", which packs as a caret range; every other spelling packs as an exact pin: ${workspaceWildcardViolations.join(", ")}`,
  );
}

console.log(
  "verified pnpm catalog policy, reproducible CI dependency installs, and workspace range policy",
);
