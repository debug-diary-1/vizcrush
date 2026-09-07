import { TimeSeriesSession, type TimeSeriesSessionState, type ViewportResult } from "./session.js";

export interface TimeSeriesWorkerHostScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

interface WorkerRequest {
  type: "vizcrush:request";
  requestId: number;
  operation: string;
  x?: Float64Array;
  y?: Float64Array;
  request?: Parameters<TimeSeriesSession["view"]>[0];
  options?: Parameters<TimeSeriesSession["view"]>[1];
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (value === null || typeof value !== "object") return false;
  const request = value as Partial<WorkerRequest>;
  return request.type === "vizcrush:request" && Number.isSafeInteger(request.requestId);
}

function errorResponse(requestId: number, error: unknown, code = "operation-error") {
  return {
    type: "vizcrush:response",
    requestId,
    ok: false,
    error: { code, message: error instanceof Error ? error.message : String(error) },
  } as const;
}

function transferResult(result: ViewportResult): Transferable[] {
  return [result.x.buffer as ArrayBuffer, result.y.buffer as ArrayBuffer];
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
      scope.postMessage(errorResponse(requestId, "The worker host is busy", "busy"));
      return;
    }
    busy = true;
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
      } else if (operation === "view") {
        if (!event.data.request) throw new TypeError("view requires a viewport request");
        value = await session.view(event.data.request, event.data.options);
        transfer = transferResult(value);
      } else if (operation === "dispose") {
        disposed = true;
      } else {
        throw new RangeError(`Unknown worker operation: ${operation}`);
      }
      scope.postMessage({ type: "vizcrush:response", requestId, ok: true, value }, transfer);
    } catch (error) {
      scope.postMessage(errorResponse(requestId, error));
    } finally {
      busy = false;
    }
  };

  return () => {
    disposed = true;
    scope.onmessage = null;
  };
}
