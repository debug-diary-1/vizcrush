import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dependabotUsesNpm,
  findNonFrozenPnpmInstalls,
  findToolchainPinMismatch,
  findUnpinnedActionUses,
  findUnpinnedCargoInstalls,
} from "./dependency-policy.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dependabot = await readFile(join(root, ".github/dependabot.yml"), "utf8");
if (dependabotUsesNpm(dependabot)) {
  throw new Error(
    "Dependabot npm updates are disabled: its pnpm-catalog lockfile output is not frozen-install compatible",
  );
}

const miseToml = await readFile(join(root, "mise.toml"), "utf8");
const packageJson = await readFile(join(root, "package.json"), "utf8");
const toolchainPinMismatch = findToolchainPinMismatch(miseToml, packageJson);
if (toolchainPinMismatch) {
  throw new Error(toolchainPinMismatch);
}

const violations = [];
const cargoInstallViolations = [];
const actionPinViolations = [];
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
  for (const lineNumber of findUnpinnedActionUses(source)) {
    actionPinViolations.push(`${entry.name}:${lineNumber}`);
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
if (actionPinViolations.length > 0) {
  throw new Error(
    `GitHub Actions must be pinned to a 40-character commit SHA with a version/ref comment: ${actionPinViolations.join(", ")}`,
  );
}

console.log(
  "verified pnpm catalog policy, reproducible CI dependency installs, pinned Actions, and toolchain pin agreement",
);
