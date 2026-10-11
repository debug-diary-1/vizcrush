const npmEcosystemPattern = /^\s*package-ecosystem:\s*(?:npm|"npm"|'npm')\s*(?:#.*)?$/mu;

export function dependabotUsesNpm(source) {
  return npmEcosystemPattern.test(source);
}

export function findNonFrozenPnpmInstalls(source) {
  const violations = [];
  for (const [index, line] of source.split("\n").entries()) {
    const commandSegments = splitShellCommandSegments(line);
    if (
      commandSegments.some(
        (segment) =>
          /\bpnpm\s+install\b/u.test(segment) &&
          !/\bpnpm\s+install\b[^;&|]*\s--frozen-lockfile(?:=true)?(?:\s|$)/u.test(segment),
      )
    ) {
      violations.push(index + 1);
    }
  }
  return violations;
}

export function findUnpinnedCargoInstalls(source) {
  const violations = [];
  for (const [index, line] of source.split("\n").entries()) {
    const commandSegments = splitShellCommandSegments(line);
    if (
      commandSegments.some(
        (segment) =>
          /\bcargo\s+install\b/u.test(segment) &&
          (!/\s--version(?:=|\s+)\S+/u.test(segment) || !/\s--locked(?:\s|$)/u.test(segment)),
      )
    ) {
      violations.push(index + 1);
    }
  }
  return violations;
}

function splitShellCommandSegments(line) {
  return line.split("#", 1)[0].split(/\s*(?:&&|&|\|\||;|\|)\s*/u);
}

const actionUsesLinePattern = /^\s*(?:-\s*)?uses:\s*(\S+)(?:\s+(#.*))?\s*$/u;
const localActionPattern = /^\.\//u;
const dockerDigestActionPattern = /^docker:\/\/[^\s@]+@sha256:[0-9a-fA-F]{64}$/u;
const shaPinnedActionPattern = /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[0-9a-fA-F]{40}$/u;
const versionOrRefCommentPattern = /^#\s*\S+/u;

export function findUnpinnedActionUses(source) {
  const violations = [];
  for (const [index, line] of source.split("\n").entries()) {
    const match = actionUsesLinePattern.exec(line);
    if (!match) continue;
    const [, usesValue, comment] = match;
    if (localActionPattern.test(usesValue) || dockerDigestActionPattern.test(usesValue)) continue;
    if (
      !shaPinnedActionPattern.test(usesValue) ||
      !comment ||
      !versionOrRefCommentPattern.test(comment)
    ) {
      violations.push(index + 1);
    }
  }
  return violations;
}

const misePnpmVersionPattern = /^\s*pnpm\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/mu;
const packageManagerPnpmVersionPattern = /"packageManager"\s*:\s*"pnpm@([^"]+)"/u;

export function findToolchainPinMismatch(miseToml, packageJson) {
  const miseVersion = misePnpmVersionPattern.exec(miseToml)?.[1];
  const packageManagerVersion = packageManagerPnpmVersionPattern.exec(packageJson)?.[1];
  if (!miseVersion) {
    return "mise.toml does not pin a parseable pnpm version";
  }
  if (!packageManagerVersion) {
    return "package.json does not pin a parseable pnpm packageManager version";
  }
  if (miseVersion !== packageManagerVersion) {
    return `mise.toml pins pnpm ${miseVersion} but package.json's packageManager pins pnpm ${packageManagerVersion}`;
  }
  return null;
}
