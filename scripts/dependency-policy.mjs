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
  return line.split("#", 1)[0].split(/\s*(?:&&|\|\||;|\|)\s*/u);
}
