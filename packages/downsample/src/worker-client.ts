import type { KernelCallOptions } from "@vizcrush/core";
import type { TimeSeriesSessionState, ViewportRequest, ViewportResult } from "./session.js";

export interface TimeSeriesWorkerTransport {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export interface WorkerOperationResult<T> {
  requestId: number;
  value: T;
}

export interface WorkerViewportResult extends WorkerOperationResult<ViewportResult> {
  viewportId: number;
  generation: number;
}

export interface WorkerLoadOptions {
  /**
   * Detach and transfer both input buffers. Each typed array must cover its
   * own complete ArrayBuffer. The safe default uses structured-clone copies.
   */
  transfer?: boolean;
}

export type WorkerAppendOptions = WorkerLoadOptions;

interface WorkerSuccessResponse {
  type: "vizcrush:response";
  requestId: number;
  ok: true;
  value: unknown;
}

interface WorkerErrorResponse {
  type: "vizcrush:response";
  requestId: number;
  ok: false;
  error: { code: string; message: string };
}

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

interface PendingRequest {
  requestId: number;
  operation: string;
  resolve(value: WorkerOperationResult<unknown>): void;
  reject(reason: unknown): void;
}

interface ScheduledViewport {
  viewportId: number;
  request: ViewportRequest;
  options: KernelCallOptions;
  resolve(value: WorkerViewportResult): void;
  reject(reason: unknown): void;
}

interface ScheduledAppend {
  x: Float64Array;
  y: Float64Array;
  transfer?: Transferable[];
  resolve(value: WorkerOperationResult<TimeSeriesSessionState>): void;
  reject(reason: unknown): void;
}

export class TimeSeriesWorkerBusyError extends Error {
  /** Create the error returned when an operation is already in flight. */
  constructor() {
    super("The time-series worker already has an operation in flight");
    this.name = "TimeSeriesWorkerBusyError";
  }
}

export class TimeSeriesWorkerDisposedError extends Error {
  readonly requestId: number | null;

  /** Create a disposal error, optionally for an operation cancelled by disposal. */
  constructor(requestId: number | null = null) {
    super("The time-series worker has been disposed");
    this.name = "TimeSeriesWorkerDisposedError";
    this.requestId = requestId;
  }
}

export class TimeSeriesWorkerSupersededError extends Error {
  readonly viewportId: number;
  readonly supersededBy: number;

  /** Create the explicit settlement for a viewport replaced by a newer one. */
  constructor(viewportId: number, supersededBy: number) {
    super(`Viewport ${viewportId} was superseded by viewport ${supersededBy}`);
    this.name = "TimeSeriesWorkerSupersededError";
    this.viewportId = viewportId;
    this.supersededBy = supersededBy;
  }
}

export class TimeSeriesWorkerError extends Error {
  readonly code: string;
  readonly requestId: number | null;

  /** Create an identified transport or host-operation failure. */
  constructor(message: string, code = "worker-error", requestId: number | null = null) {
    super(message);
    this.name = "TimeSeriesWorkerError";
    this.code = code;
    this.requestId = requestId;
  }
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (value === null || typeof value !== "object") return false;
  const response = value as {
    type?: unknown;
    requestId?: unknown;
    ok?: unknown;
    value?: unknown;
    error?: unknown;
  };
  if (response.type !== "vizcrush:response" || !Number.isSafeInteger(response.requestId)) {
    return false;
  }
  if (response.ok === true) return "value" in response;
  if (response.ok !== false || response.error === null || typeof response.error !== "object") {
    return false;
  }
  const error = response.error as { code?: unknown; message?: unknown };
  return typeof error.code === "string" && typeof error.message === "string";
}

function assertTransferableInput(x: Float64Array, y: Float64Array): Transferable[] {
  for (const [name, values] of [
    ["x", x],
    ["y", y],
  ] as const) {
    if (!(values.buffer instanceof ArrayBuffer)) {
      throw new TypeError(`${name} must use an ArrayBuffer for transfer`);
    }
    if (values.byteOffset !== 0 || values.byteLength !== values.buffer.byteLength) {
      throw new RangeError(`${name} must cover its complete dedicated ArrayBuffer for transfer`);
    }
  }
  if (x.buffer === y.buffer) {
    throw new RangeError("x and y must use separate dedicated ArrayBuffers for transfer");
  }
  return [x.buffer, y.buffer];
}

function snapshotAppendInput(
  x: Float64Array,
  y: Float64Array,
  transfer: boolean,
): { x: Float64Array; y: Float64Array; transfer: Transferable[] } {
  if (transfer) {
    const transferables = assertTransferableInput(x, y);
    const snapshot = structuredClone({ x, y }, { transfer: transferables });
    return { ...snapshot, transfer: [snapshot.x.buffer, snapshot.y.buffer] };
  }
  const snapshot = { x: new Float64Array(x), y: new Float64Array(y) };
  return { ...snapshot, transfer: [snapshot.x.buffer, snapshot.y.buffer] };
}

/**
 * Owns one browser worker and permits one in-flight operation. It never falls
 * back to processing in the caller when worker startup or execution fails.
 */
export class TimeSeriesWorkerClient {
  readonly #worker: TimeSeriesWorkerTransport;
  #nextRequestId = 1;
  #nextViewportId = 1;
  #generation = 1;
  #pending: PendingRequest | null = null;
  #activeView: ScheduledViewport | null = null;
  #queuedView: ScheduledViewport | null = null;
  #append: ScheduledAppend | null = null;
  #disposed = false;
  #disposing = false;
  #disposePromise: Promise<void> | null = null;
  #terminated = false;

  /**
   * Take ownership of a dedicated worker and its message handlers. The worker
   * must install the matching host protocol from its consumer-owned entry.
   */
  constructor(worker: TimeSeriesWorkerTransport) {
    this.#worker = worker;
    worker.onmessage = (event) => this.#handleMessage(event);
    worker.onerror = (event) => this.#fail(new Error(event.message));
    worker.onmessageerror = () =>
      this.#fail(new TimeSeriesWorkerError("The worker returned an unreadable message"));
  }

  /** Read session state, returning the identity assigned to this request. */
  state(): Promise<WorkerOperationResult<TimeSeriesSessionState>> {
    return this.#request("state", {});
  }

  /**
   * Replace worker-resident history. Inputs are cloned by default; transfer
   * mode detaches separate typed arrays that cover their complete buffers.
   */
  load(
    x: Float64Array,
    y: Float64Array,
    options: WorkerLoadOptions = {},
  ): Promise<WorkerOperationResult<TimeSeriesSessionState>> {
    try {
      this.#assertAvailable();
      if (!(x instanceof Float64Array) || !(y instanceof Float64Array)) {
        throw new TypeError("x and y must be Float64Array instances");
      }
      const transfer = options.transfer ? assertTransferableInput(x, y) : undefined;
      return this.#sendRequest<TimeSeriesSessionState>("load", { x, y }, transfer).then(
        (result) => {
          this.#generation += 1;
          return result;
        },
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Append one ordered batch. At most one append may be unacknowledged. A
   * second producer call is rejected before transfer validation or detachment;
   * viewport work remains coalesced independently.
   */
  append(
    x: Float64Array,
    y: Float64Array,
    options: WorkerAppendOptions = {},
  ): Promise<WorkerOperationResult<TimeSeriesSessionState>> {
    try {
      if (this.#disposed || this.#disposing) throw new TimeSeriesWorkerDisposedError();
      if (this.#append) throw new TimeSeriesWorkerBusyError();
      if (this.#pending && this.#pending.operation !== "view") {
        throw new TimeSeriesWorkerBusyError();
      }
      if (!(x instanceof Float64Array) || !(y instanceof Float64Array)) {
        throw new TypeError("x and y must be Float64Array instances");
      }
      const scheduled = snapshotAppendInput(x, y, options.transfer ?? false) as ScheduledAppend;
      const promise = new Promise<WorkerOperationResult<TimeSeriesSessionState>>(
        (resolve, reject) => {
          scheduled.resolve = resolve;
          scheduled.reject = reject;
        },
      );
      this.#append = scheduled;
      if (!this.#pending && !this.#activeView) this.#dispatchAppend(scheduled);
      return promise;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Request one bounded viewport. One request may run and one latest request
   * may wait; replacing the waiting viewport rejects it explicitly. Results
   * carry transport, viewport, and session-generation identities.
   */
  view(request: ViewportRequest, options: KernelCallOptions = {}): Promise<WorkerViewportResult> {
    if (this.#disposed || this.#disposing) {
      return Promise.reject(new TimeSeriesWorkerDisposedError());
    }
    if (
      this.#pending &&
      this.#pending.operation !== "view" &&
      this.#pending.operation !== "append"
    ) {
      return Promise.reject(new TimeSeriesWorkerBusyError());
    }
    const viewportId = this.#nextViewportId;
    this.#nextViewportId += 1;
    const scheduled = {
      viewportId,
      request: { ...request },
      options: { ...options },
    } as ScheduledViewport;
    const promise = new Promise<WorkerViewportResult>((resolve, reject) => {
      scheduled.resolve = resolve;
      scheduled.reject = reject;
    });
    if (!this.#pending && !this.#activeView) {
      this.#dispatchViewport(scheduled);
    } else {
      this.#queuedView?.reject(
        new TimeSeriesWorkerSupersededError(this.#queuedView.viewportId, viewportId),
      );
      this.#queuedView = scheduled;
    }
    return promise;
  }

  /**
   * Dispose idempotently. An in-flight operation is rejected immediately and
   * the owned worker is terminated; an idle host first acknowledges disposal.
   */
  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    if (this.#disposed) {
      this.#disposePromise = Promise.resolve();
      return this.#disposePromise;
    }
    if (this.#pending || this.#activeView || this.#append) {
      this.#disposed = true;
      const requestId = this.#pending?.requestId ?? null;
      const operation = this.#pending?.operation;
      this.#rejectOutstanding((kind) => {
        const matchesPending =
          kind === "pending" ||
          (kind === "active-view" && operation === "view") ||
          (kind === "append" && operation === "append");
        return new TimeSeriesWorkerDisposedError(matchesPending ? requestId : null);
      });
      this.#disposePromise = Promise.resolve();
      this.#terminate();
      return this.#disposePromise;
    }

    this.#disposing = true;
    this.#disposePromise = this.#sendRequest<undefined>("dispose", {})
      .then(() => undefined)
      .finally(() => {
        this.#disposing = false;
        this.#disposed = true;
        this.#terminate();
      });
    return this.#disposePromise;
  }

  #request<T>(
    operation: string,
    payload: object,
    transfer?: Transferable[],
  ): Promise<WorkerOperationResult<T>> {
    try {
      this.#assertAvailable();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#sendRequest(operation, payload, transfer);
  }

  #sendRequest<T>(
    operation: string,
    payload: object,
    transfer?: Transferable[],
  ): Promise<WorkerOperationResult<T>> {
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    const promise = new Promise<WorkerOperationResult<T>>((resolve, reject) => {
      this.#pending = {
        requestId,
        operation,
        resolve: resolve as (value: WorkerOperationResult<unknown>) => void,
        reject,
      };
    });
    try {
      this.#worker.postMessage(
        { type: "vizcrush:request", requestId, operation, ...payload },
        transfer,
      );
    } catch (error) {
      const pending = this.#pending;
      this.#pending = null;
      const failure = new TimeSeriesWorkerError(
        error instanceof Error ? error.message : String(error),
        "post-message-error",
        requestId,
      );
      pending?.reject(failure);
      this.#fail(failure);
    }
    return promise;
  }

  #assertAvailable(): void {
    if (this.#disposed || this.#disposing) throw new TimeSeriesWorkerDisposedError();
    if (this.#pending || this.#activeView || this.#queuedView || this.#append) {
      throw new TimeSeriesWorkerBusyError();
    }
  }

  #dispatchViewport(scheduled: ScheduledViewport): void {
    this.#activeView = scheduled;
    void this.#sendRequest<ViewportResult>("view", {
      request: scheduled.request,
      options: scheduled.options,
    })
      .then((result) => {
        if (this.#activeView !== scheduled) return;
        this.#activeView = null;
        if (this.#queuedView) {
          scheduled.reject(
            new TimeSeriesWorkerSupersededError(scheduled.viewportId, this.#queuedView.viewportId),
          );
        } else {
          scheduled.resolve({
            ...result,
            viewportId: scheduled.viewportId,
            generation: this.#generation,
          });
        }
        this.#drain();
      })
      .catch((error) => {
        if (this.#activeView !== scheduled) return;
        this.#activeView = null;
        scheduled.reject(error);
        this.#drain();
      });
  }

  #dispatchAppend(scheduled: ScheduledAppend): void {
    void this.#sendRequest<TimeSeriesSessionState>(
      "append",
      { x: scheduled.x, y: scheduled.y },
      scheduled.transfer,
    ).then(
      (result) => {
        if (this.#append !== scheduled) return;
        this.#append = null;
        this.#drain();
        scheduled.resolve(result);
      },
      (error) => {
        if (this.#append !== scheduled) return;
        this.#append = null;
        this.#drain();
        scheduled.reject(error);
      },
    );
  }

  #drain(): void {
    if (this.#disposed || this.#pending || this.#activeView) return;
    const view = this.#queuedView;
    if (view) {
      this.#queuedView = null;
      this.#dispatchViewport(view);
      return;
    }
    if (this.#append) this.#dispatchAppend(this.#append);
  }

  #handleMessage(event: MessageEvent<unknown>): void {
    if (this.#disposed) return;
    const pending = this.#pending;
    if (!pending) return;
    if (!isWorkerResponse(event.data)) {
      this.#fail(new Error("The worker returned a malformed response"));
      return;
    }
    if (event.data.requestId !== pending.requestId) return;
    this.#pending = null;
    if (event.data.ok) {
      pending.resolve({ requestId: event.data.requestId, value: event.data.value });
    } else {
      pending.reject(
        new TimeSeriesWorkerError(
          event.data.error.message,
          event.data.error.code,
          event.data.requestId,
        ),
      );
    }
  }

  #fail(error: Error): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const failure =
      error instanceof TimeSeriesWorkerError && error.requestId !== null
        ? error
        : new TimeSeriesWorkerError(
            error.message,
            error instanceof TimeSeriesWorkerError ? error.code : "worker-error",
            this.#pending?.requestId ?? null,
          );
    this.#rejectOutstanding(() => failure);
    this.#terminate();
  }

  #rejectOutstanding(
    errorFor: (kind: "pending" | "active-view" | "queued-view" | "append") => Error,
  ): void {
    this.#pending?.reject(errorFor("pending"));
    this.#activeView?.reject(errorFor("active-view"));
    this.#queuedView?.reject(errorFor("queued-view"));
    this.#append?.reject(errorFor("append"));
    this.#pending = null;
    this.#activeView = null;
    this.#queuedView = null;
    this.#append = null;
  }

  #terminate(): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#worker.onmessage = null;
    this.#worker.onerror = null;
    this.#worker.onmessageerror = null;
    this.#worker.terminate();
  }
}
