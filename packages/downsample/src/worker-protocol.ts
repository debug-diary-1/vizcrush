import type { KernelCallOptions } from "@vizcrush/core";
import type { TimeSeriesSession, TimeSeriesSessionState, ViewportResult } from "./session.js";

export type WorkerOperation = "state" | "load" | "append" | "view" | "dispose";

export interface WorkerRequest {
  type: "vizcrush:request";
  requestId: number;
  operation: WorkerOperation;
  x?: Float64Array;
  y?: Float64Array;
  request?: Parameters<TimeSeriesSession["view"]>[0];
  options?: KernelCallOptions;
}

export interface WorkerSuccessResponse {
  type: "vizcrush:response";
  requestId: number;
  ok: true;
  value: TimeSeriesSessionState | ViewportResult | undefined;
  workerProcessingMs: number;
}

export interface WorkerErrorResponse {
  type: "vizcrush:response";
  requestId: number;
  ok: false;
  error: { code: string; message: string };
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

export function workerRequest(
  requestId: number,
  operation: WorkerOperation,
  payload: Omit<Partial<WorkerRequest>, "type" | "requestId" | "operation"> = {},
): WorkerRequest {
  return { type: "vizcrush:request", requestId, operation, ...payload };
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (value === null || typeof value !== "object") return false;
  const request = value as Partial<WorkerRequest>;
  return (
    request.type === "vizcrush:request" &&
    Number.isSafeInteger(request.requestId) &&
    ["state", "load", "append", "view", "dispose"].includes(request.operation ?? "")
  );
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (value === null || typeof value !== "object") return false;
  const response = value as Partial<WorkerResponse>;
  if (response.type !== "vizcrush:response" || !Number.isSafeInteger(response.requestId)) {
    return false;
  }
  if (response.ok === true) {
    return "value" in response && typeof response.workerProcessingMs === "number";
  }
  if (response.ok !== false || response.error === null || typeof response.error !== "object") {
    return false;
  }
  return typeof response.error.code === "string" && typeof response.error.message === "string";
}

export function workerErrorResponse(
  requestId: number,
  error: unknown,
  code = "operation-error",
): WorkerErrorResponse {
  return {
    type: "vizcrush:response",
    requestId,
    ok: false,
    error: { code, message: error instanceof Error ? error.message : String(error) },
  };
}

export function resultTransferables(result: ViewportResult): Transferable[] {
  return [result.x.buffer as ArrayBuffer, result.y.buffer as ArrayBuffer];
}
