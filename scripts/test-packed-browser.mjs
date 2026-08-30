import { runPackedBrowserSmoke } from "./packed-browser-harness.mjs";

const browser = process.env.BROWSER ?? "chromium";
const result = await runPackedBrowserSmoke({ browser });
console.log(JSON.stringify(result, null, 2));

if (result.wasm.backend !== "wasm") {
  throw new Error(`${browser}: packed artifact did not execute the WASM backend`);
}
if (result.js.backend !== "js") {
  throw new Error(`${browser}: packed artifact did not execute the JS backend`);
}
if (result.wasm.outputLength !== 100 || result.js.outputLength !== 100) {
  throw new Error(`${browser}: packed artifact returned the wrong output length`);
}
if (!result.parity) {
  throw new Error(`${browser}: packed WASM and JS outputs disagree`);
}
