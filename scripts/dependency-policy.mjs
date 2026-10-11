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

/**
 * Inter-package dependencies must be declared `workspace:^`. pnpm rewrites the
 * specifier to a real range at pack time, and every other spelling pins harder
 * than intended: `workspace:*` emits an exact version, and a hand-written
 * `2.1.0` is already one. An exact pin forbids upgrading the dependency and
 * resolves a second copy of it whenever two siblings disagree.
 */
export function findWorkspaceWildcardDependencies(manifest) {
  const violations = [];
  for (const field of ["dependencies", "peerDependencies"]) {
    const dependencies = manifest[field];
    if (!dependencies) continue;
    for (const [name, versionRange] of Object.entries(dependencies)) {
      if (name.startsWith("@vizcrush/") && versionRange !== "workspace:^") {
        violations.push({ field, name, versionRange });
      }
    }
  }
  return violations;
}

function splitShellCommandSegments(line) {
  return line.split("#", 1)[0].split(/\s*(?:&&|&|\|\||;|\|)\s*/u);
}
