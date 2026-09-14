import { TimeSeriesSession, type TimeSeriesSessionState, type ViewportResult } from "./session.js";
import {
  isWorkerRequest,
  resultTransferables,
  workerErrorResponse,
  type WorkerSuccessResponse,
} from "./worker-protocol.js";

export interface TimeSeriesWorkerHostScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

/** Install the session protocol in a consumer-owned worker entry. */
export function installTimeSeriesWorkerHost(
  scope: TimeSeriesWorkerHostScope,
  session: TimeSeriesSession,
): () => void {
  let busy = false;
  let disposed = false;

  scope.onmessage = async (event) => {
    if (!isWorkerRequest(event.data) || disposed) return;
    const { requestId, operation } = event.data;
    if (busy) {
      scope.postMessage(workerErrorResponse(requestId, "The worker host is busy", "busy"));
      return;
    }
    busy = true;
    const processingStarted = performance.now();
    try {
      let value: TimeSeriesSessionState | ViewportResult | undefined;
      let transfer: Transferable[] | undefined;
      if (operation === "state") {
        value = session.state;
      } else if (operation === "load") {
        if (!(event.data.x instanceof Float64Array) || !(event.data.y instanceof Float64Array)) {
          throw new TypeError("load requires Float64Array x and y");
        }
        value = session.load(event.data.x, event.data.y);
      } else if (operation === "append") {
        if (!(event.data.x instanceof Float64Array) || !(event.data.y instanceof Float64Array)) {
          throw new TypeError("append requires Float64Array x and y");
        }
        value = session.append(event.data.x, event.data.y);
      } else if (operation === "view") {
        if (!event.data.request) throw new TypeError("view requires a viewport request");
        value = await session.view(event.data.request, event.data.options);
        transfer = resultTransferables(value);
      } else if (operation === "dispose") {
        disposed = true;
      } else {
        throw new RangeError(`Unknown worker operation: ${operation}`);
      }
      const response: WorkerSuccessResponse = {
        type: "vizcrush:response",
        requestId,
        ok: true,
        value,
        workerProcessingMs: performance.now() - processingStarted,
      };
      scope.postMessage(response, transfer);
    } catch (error) {
      scope.postMessage(workerErrorResponse(requestId, error));
    } finally {
      busy = false;
    }
  };

  return () => {
    disposed = true;
    scope.onmessage = null;
  };
}
