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
if (result.wasm.outputLength !== 320 || result.js.outputLength !== 320) {
  throw new Error(`${browser}: packed artifact returned the wrong output length`);
}
if (!result.parity) {
  throw new Error(`${browser}: packed WASM and JS outputs disagree`);
}
if (result.retainedPoints !== 1_000_000 || result.requestIds.js <= result.requestIds.wasm) {
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
  result.streaming.newestX !== 1_119_999 ||
  result.streaming.evictedVisiblePoints !== 0 ||
  result.streaming.evictedNeighborPoints !== 1 ||
  result.streaming.newestOutputLength !== 100
) {
  throw new Error(`${browser}: bounded streaming retention or navigation was incorrect`);
}
if (
  result.bufferBytes.retainedSourceBytes !== 16_000_000 ||
  result.bufferBytes.sourceCapacityBytes !== 16_000_000 ||
  result.bufferBytes.scratchCapacityBytes !== 16_000_000 ||
  result.bufferBytes.pendingAppendCapacityBytes !== 320_000 ||
  result.bufferBytes.outputCapacityBytes !== 320_000 ||
  result.bufferBytes.totalAccountedCapacityBytes !== 32_640_000
) {
  throw new Error(`${browser}: buffer accounting did not match configured bounds`);
}
if (
  result.scenario.initialization.label !== "cold" ||
  result.scenario.initialization.sourceRevision !== 1 ||
  result.scenario.source.initialPoints !== 1_000_000 ||
  result.scenario.source.scenarioStartSourceIndex !== 1_000_000 ||
  result.scenario.source.scenarioStartRevision !== 1 ||
  result.scenario.samples.length !== 16 ||
  result.scenario.samples.some(
    (sample) =>
      sample.label !== "warm" ||
      sample.workerProcessingMs < 0 ||
      sample.roundTripMs < 0 ||
      sample.callerToRenderCompletionMs < sample.roundTripMs ||
      sample.rendererMs < 0,
  ) ||
  result.scenario.resizeOutputLengths.join(",") !== "320,320,960,960" ||
  !result.scenario.samples.some((sample) => sample.phase === "steady-stream") ||
  result.scenario.frameGapsMs.length === 0 ||
  Object.values(result.scenario.summaries).some(
    (summary) => summary.p50 < 0 || summary.p95 < summary.p50,
  ) ||
  !result.scenario.exportRoundTrip
) {
  throw new Error(`${browser}: measured worker-to-render scenario was incorrect`);
}
if (
  !result.demo.exported ||
  !result.demo.controlsExercised ||
  result.demo.schemaVersion !== 1 ||
  result.demo.initialPoints !== 1_000_000 ||
  result.demo.scenarioStartSourceIndex !== 1_000_000 ||
  result.demo.scenarioStartRevision !== 1 ||
  result.demo.viewSamples.length !== 18 ||
  result.demo.appendSamples.length !== 3 ||
  result.demo.viewSamples.filter((sample) => sample.phase === "resize").length !== 4 ||
  result.demo.viewSamples.filter((sample) => sample.phase === "steady-stream").length !== 6 ||
  result.demo.frameGapsMs.length === 0 ||
  result.demo.parity.comparedPairs !== 8 ||
  result.demo.parity.identicalPairs !== 8 ||
  Object.values(result.demo.summaries).some(
    (summary) => summary.p50 < 0 || summary.p95 < summary.p50,
  )
) {
  throw new Error(`${browser}: complete million-point demo/export flow was incorrect`);
}
