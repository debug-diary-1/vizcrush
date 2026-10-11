import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findMissingTurboTasks } from "./turbo-tasks.mjs";

// `"test": "pnpm turbo test"` sat in package.json while turbo.json defined only
// build, typecheck and dev. The script failed on every invocation with
// `Could not find task 'test' in project`, and nothing noticed: CI calls the
// underlying tools directly, so it never ran the script that was broken.
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const turbo = JSON.parse(await readFile(join(root, "turbo.json"), "utf8"));

const missing = findMissingTurboTasks(manifest.scripts ?? {}, Object.keys(turbo.tasks ?? {}));

if (missing.length > 0) {
  const detail = missing.map(({ script, task }) => `${script} -> turbo ${task}`).join(", ");
  throw new Error(
    `package.json scripts invoke turbo tasks that turbo.json does not define: ${detail}`,
  );
}

console.log("verified every turbo task invoked by a package.json script exists");
