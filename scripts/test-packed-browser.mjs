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
if (result.retainedPoints !== 100_000 || result.requestIds.js <= result.requestIds.wasm) {
  throw new Error(`${browser}: persistent worker state or request identity was incorrect`);
}
if (
  result.scheduling.obsolete !== "TimeSeriesWorkerSupersededError" ||
  result.scheduling.replaced !== "TimeSeriesWorkerSupersededError" ||
  result.scheduling.resetViewportId !== 3 ||
  result.scheduling.resetOutputLength !== 100
) {
  throw new Error(`${browser}: bounded latest/reset scheduling was incorrect`);
}
if (
  result.streaming.activeOutcome !== "TimeSeriesWorkerSupersededError" ||
  result.streaming.navigationRevision !== 1 ||
  result.streaming.appendRevision !== 2 ||
  !result.streaming.transferDetached ||
  result.streaming.backpressure !== "TimeSeriesWorkerBusyError" ||
  !result.streaming.rejectedOwnershipPreserved ||
  result.streaming.sourceRevision !== 7 ||
  result.streaming.oldestX !== 120_000 ||
  result.streaming.newestX !== 219_999 ||
  result.streaming.evictedVisiblePoints !== 0 ||
  result.streaming.evictedNeighborPoints !== 1 ||
  result.streaming.newestOutputLength !== 100
) {
  throw new Error(`${browser}: bounded streaming retention or navigation was incorrect`);
}
if (
  result.bufferBytes.retainedSourceBytes !== 1_600_000 ||
  result.bufferBytes.sourceCapacityBytes !== 1_600_000 ||
  result.bufferBytes.scratchCapacityBytes !== 1_600_000 ||
  result.bufferBytes.pendingAppendCapacityBytes !== 320_000 ||
  result.bufferBytes.outputCapacityBytes !== 1_600 ||
  result.bufferBytes.totalAccountedCapacityBytes !== 3_521_600
) {
  throw new Error(`${browser}: buffer accounting did not match configured bounds`);
}
