/**
 * Turbo task names invoked by a `package.json` script, as a flat list of
 * `{ script, task }` pairs. A script reaches turbo as `turbo <task>` or
 * `turbo run <task>`, optionally behind `pnpm`, and may chain several
 * commands with `&&`.
 */
export function findInvokedTurboTasks(scripts) {
  const invocations = [];
  for (const [script, body] of Object.entries(scripts)) {
    for (const segment of body.split(/\s*&&\s*/u)) {
      const match = /(?:^|\s)turbo\s+(?:run\s+)?([a-z][a-z0-9:_-]*)/iu.exec(segment);
      // A flag where the task should be means turbo was handed options only.
      if (match) invocations.push({ script, task: match[1] });
    }
  }
  return invocations;
}

/** The invoked tasks that `turbo.json` does not define. */
export function findMissingTurboTasks(scripts, definedTasks) {
  const defined = new Set(definedTasks);
  return findInvokedTurboTasks(scripts).filter(({ task }) => !defined.has(task));
}
