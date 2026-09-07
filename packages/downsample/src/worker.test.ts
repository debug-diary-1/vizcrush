import { describe, expect, test } from "vitest";
import { TimeSeriesSession } from "./session.js";
import {
  TimeSeriesWorkerBusyError,
  TimeSeriesWorkerClient,
  TimeSeriesWorkerDisposedError,
  TimeSeriesWorkerError,
  TimeSeriesWorkerSupersededError,
  type TimeSeriesWorkerTransport,
} from "./worker-client.js";
import { installTimeSeriesWorkerHost, type TimeSeriesWorkerHostScope } from "./worker-host.js";

class LinkedWorker implements TimeSeriesWorkerTransport {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly host: TimeSeriesWorkerHostScope;
  terminateCalls = 0;

  constructor() {
    this.host = {
      onmessage: null,
      postMessage: (message, transfer) => {
        const data = structuredClone(message, { transfer });
        queueMicrotask(() => this.onmessage?.({ data } as MessageEvent<unknown>));
      },
    };
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => this.host.onmessage?.({ data } as MessageEvent<unknown>));
  }

  terminate(): void {
    this.terminateCalls += 1;
    this.host.onmessage = null;
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

class ControlledWorker implements TimeSeriesWorkerTransport {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly sent: Array<{ message: Record<string, unknown>; transfer?: Transferable[] }> = [];
  terminateCalls = 0;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.sent.push({
      message: structuredClone(message, { transfer }) as Record<string, unknown>,
      transfer,
    });
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  succeed(index: number, value: unknown): void {
    const requestId = this.sent[index].message.requestId;
    this.onmessage?.({
      data: { type: "vizcrush:response", requestId, ok: true, value },
    } as MessageEvent<unknown>);
  }
}

function loadedWorker(): { worker: LinkedWorker; client: TimeSeriesWorkerClient } {
  const worker = new LinkedWorker();
  const session = new TimeSeriesSession({ capacity: 10, maxOutputPoints: 10 });
  installTimeSeriesWorkerHost(worker.host, session);
  return { worker, client: new TimeSeriesWorkerClient(worker) };
}

describe("TimeSeriesWorkerClient and host", () => {
  test("keeps one session and transport across load and repeated views", async () => {
    const { worker, client } = loadedWorker();
    const x = new Float64Array([1, 2, 3]);
    const y = new Float64Array([10, 20, 30]);
    const loading = client.load(x, y);
    expect(x.byteLength).toBe(24);
    expect(y.byteLength).toBe(24);
    x.fill(99);
    y.fill(99);
    const loaded = await loading;

    const first = await client.view({ xMin: 1, xMax: 2, widthCssPixels: 10 });
    const second = await client.view({ xMin: 2, xMax: 3, widthCssPixels: 10 });

    expect(loaded).toMatchObject({ requestId: 1, value: { sourceRevision: 1 } });
    expect(Array.from(first.value.x)).toEqual([1, 2, 3]);
    expect(Array.from(second.value.y)).toEqual([10, 20, 30]);
    expect([first.requestId, second.requestId]).toEqual([2, 3]);
    expect([first.generation, second.generation]).toEqual([2, 2]);
    expect(worker.terminateCalls).toBe(0);
  });

  test("supports opt-in transfer only for separate dedicated buffers", async () => {
    const { client } = loadedWorker();
    const x = new Float64Array([1, 2, 3]);
    const y = new Float64Array([10, 20, 30]);
    const pending = client.load(x, y, { transfer: true });
    expect(x.byteLength).toBe(0);
    expect(y.byteLength).toBe(0);
    await pending;

    const other = loadedWorker().client;
    const backing = new Float64Array([0, 1, 2, 3]);
    const aliased = backing.subarray(1, 3);
    const paired = new Float64Array([10, 20]);
    await expect(other.load(aliased, paired, { transfer: true })).rejects.toThrow(/complete/);
    expect(backing.byteLength).toBeGreaterThan(0);
    expect(paired.byteLength).toBeGreaterThan(0);
  });

  test("appends through the host with circular retention and source revisions", async () => {
    const worker = new LinkedWorker();
    const session = new TimeSeriesSession({
      capacity: 3,
      maxOutputPoints: 10,
      maxIngestionBatchPoints: 2,
    });
    session.load(new Float64Array([0, 1, 2]), new Float64Array([0, 10, 20]));
    installTimeSeriesWorkerHost(worker.host, session);
    const client = new TimeSeriesWorkerClient(worker);

    const appended = await client.append(new Float64Array([3, 4]), new Float64Array([30, 40]));
    const result = await client.view({ xMin: -1, xMax: 10, widthCssPixels: 10 });

    expect(appended.value).toMatchObject({
      retainedPoints: 3,
      oldestX: 2,
      newestX: 4,
      sourceRevision: 2,
    });
    expect(result.value.sourceRevision).toBe(2);
    expect(Array.from(result.value.x)).toEqual([2, 3, 4]);
  });

  test("allows one unacknowledged append and rejects another before detachment", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const firstX = new Float64Array([1]);
    const firstY = new Float64Array([10]);
    const first = client.append(firstX, firstY, { transfer: true });
    expect(firstX.byteLength).toBe(0);
    expect(firstY.byteLength).toBe(0);

    const rejectedX = new Float64Array([2]);
    const rejectedY = new Float64Array([20]);
    await expect(client.append(rejectedX, rejectedY, { transfer: true })).rejects.toBeInstanceOf(
      TimeSeriesWorkerBusyError,
    );
    expect(rejectedX.byteLength).toBe(8);
    expect(rejectedY.byteLength).toBe(8);

    worker.succeed(0, { retainedPoints: 1, sourceRevision: 1 });
    await first;
  });

  test("snapshots safe-copy append inputs while they wait behind a viewport", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const view = client.view({ xMin: 0, xMax: 10, widthCssPixels: 10 });
    const x = new Float64Array([11]);
    const y = new Float64Array([110]);
    const append = client.append(x, y);
    x[0] = 99;
    y[0] = 990;

    worker.succeed(0, { x: new Float64Array([0]), y: new Float64Array([0]) });
    await view;
    await Promise.resolve();
    expect(worker.sent[1].message).toMatchObject({
      operation: "append",
      x: new Float64Array([11]),
      y: new Float64Array([110]),
    });
    worker.succeed(1, { retainedPoints: 1, sourceRevision: 1 });
    await append;
  });

  test("prioritizes the latest viewport between continuous append acknowledgements", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const active = client.view({ xMin: 0, xMax: 10, widthCssPixels: 10 });
    const appendX = new Float64Array([11]);
    const appendY = new Float64Array([110]);
    const append = client.append(appendX, appendY, { transfer: true });
    expect(appendX.byteLength).toBe(0);
    expect(appendY.byteLength).toBe(0);
    const latest = client.view({ xMin: 1, xMax: 11, widthCssPixels: 10 });

    worker.succeed(0, { x: new Float64Array([0]), y: new Float64Array([0]), sourceRevision: 1 });
    await expect(active).rejects.toBeInstanceOf(TimeSeriesWorkerSupersededError);
    await Promise.resolve();
    expect(worker.sent[1].message.operation).toBe("view");

    worker.succeed(1, { x: new Float64Array([1]), y: new Float64Array([10]), sourceRevision: 1 });
    await expect(latest).resolves.toMatchObject({ value: { sourceRevision: 1 } });
    await Promise.resolve();
    expect(worker.sent[2].message.operation).toBe("append");

    worker.succeed(2, { retainedPoints: 11, sourceRevision: 2 });
    await expect(append).resolves.toMatchObject({ value: { sourceRevision: 2 } });
  });

  test("rejects overlap before transferred inputs can detach", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const first = client.state();
    const x = new Float64Array([1]);
    const y = new Float64Array([2]);

    await expect(client.load(x, y, { transfer: true })).rejects.toBeInstanceOf(
      TimeSeriesWorkerBusyError,
    );
    expect(x.byteLength).toBe(8);
    expect(y.byteLength).toBe(8);
    worker.succeed(0, { retainedPoints: 0 });
    await first;
  });

  test("settles pending work on runtime failure and never falls back", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const pending = client.state();
    worker.onerror?.({ message: "startup failed" } as ErrorEvent);

    await expect(pending).rejects.toThrow("startup failed");
    await expect(pending).rejects.toMatchObject({ requestId: 1 });
    await expect(client.state()).rejects.toBeInstanceOf(TimeSeriesWorkerDisposedError);
    await client.dispose();
    expect(worker.terminateCalls).toBe(1);
  });

  test("disposal rejects outstanding work, terminates once, and is idempotent", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const pending = client.state();
    const disposal = client.dispose();

    await expect(pending).rejects.toBeInstanceOf(TimeSeriesWorkerDisposedError);
    await expect(pending).rejects.toMatchObject({ requestId: 1 });
    await disposal;
    await client.dispose();
    expect(worker.terminateCalls).toBe(1);
  });

  test("asks an idle host to dispose before terminating the worker", async () => {
    const { worker, client } = loadedWorker();
    const first = client.dispose();
    const second = client.dispose();

    expect(second).toBe(first);
    await first;
    await expect(client.state()).rejects.toBeInstanceOf(TimeSeriesWorkerDisposedError);
    expect(worker.terminateCalls).toBe(1);
  });

  test("host rejects overlapping protocol requests instead of queueing them", async () => {
    const responses: Array<Record<string, unknown>> = [];
    const scope: TimeSeriesWorkerHostScope = {
      onmessage: null,
      postMessage: (message) => responses.push(message as Record<string, unknown>),
    };
    const session = new TimeSeriesSession({ capacity: 10, maxOutputPoints: 2 });
    session.load(new Float64Array([0, 1, 2]), new Float64Array([0, 1, 2]));
    installTimeSeriesWorkerHost(scope, session);

    const first = scope.onmessage?.({
      data: {
        type: "vizcrush:request",
        requestId: 1,
        operation: "view",
        request: { xMin: 0, xMax: 2, widthCssPixels: 2 },
      },
    } as MessageEvent<unknown>);
    scope.onmessage?.({
      data: { type: "vizcrush:request", requestId: 2, operation: "state" },
    } as MessageEvent<unknown>);
    await first;

    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ requestId: 2, ok: false, error: { code: "busy" } });
    expect(responses[1]).toMatchObject({ requestId: 1, ok: true });
  });

  test("turns host validation errors into identified client errors", async () => {
    const { client } = loadedWorker();
    await expect(
      client.load(new Float64Array([2, 1]), new Float64Array([20, 10])),
    ).rejects.toMatchObject({
      name: TimeSeriesWorkerError.name,
      code: "operation-error",
      requestId: 1,
    });
  });

  test("rejects and terminates on a malformed response instead of hanging", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const pending = client.state();
    worker.onmessage?.({
      data: { type: "vizcrush:response", requestId: 1, ok: false },
    } as MessageEvent<unknown>);

    await expect(pending).rejects.toMatchObject({
      name: TimeSeriesWorkerError.name,
      requestId: 1,
    });
    expect(worker.terminateCalls).toBe(1);
  });

  test("keeps one active and one replaceable latest viewport", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const first = client.view({ xMin: 0, xMax: 10, widthCssPixels: 10 });
    const replaced = client.view({ xMin: 10, xMax: 20, widthCssPixels: 10 });
    const latest = client.view({ xMin: 20, xMax: 30, widthCssPixels: 10 });

    await expect(replaced).rejects.toMatchObject({
      name: TimeSeriesWorkerSupersededError.name,
      viewportId: 2,
      supersededBy: 3,
    });
    expect(worker.sent).toHaveLength(1);
    worker.succeed(0, { x: new Float64Array([0]), y: new Float64Array([0]) });
    await expect(first).rejects.toMatchObject({ viewportId: 1, supersededBy: 3 });
    await Promise.resolve();
    expect(worker.sent).toHaveLength(2);
    worker.succeed(1, { x: new Float64Array([30]), y: new Float64Array([3]) });

    await expect(latest).resolves.toMatchObject({
      requestId: 2,
      viewportId: 3,
      generation: 1,
      value: { x: new Float64Array([30]) },
    });
  });

  test("ignores delayed old responses and applies a reset viewport", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const old = client.view({ xMin: 40, xMax: 50, widthCssPixels: 10 });
    const reset = client.view({ xMin: 0, xMax: 100, widthCssPixels: 10 });
    worker.succeed(0, { x: new Float64Array([40]), y: new Float64Array([4]) });
    await expect(old).rejects.toBeInstanceOf(TimeSeriesWorkerSupersededError);
    await Promise.resolve();

    worker.succeed(0, { x: new Float64Array([999]), y: new Float64Array([999]) });
    worker.succeed(1, { x: new Float64Array([0, 100]), y: new Float64Array([0, 10]) });
    await expect(reset).resolves.toMatchObject({
      viewportId: 2,
      value: { x: new Float64Array([0, 100]) },
    });
  });

  test("disposal settles active and queued viewport requests", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const active = client.view({ xMin: 0, xMax: 10, widthCssPixels: 10 });
    const queued = client.view({ xMin: 10, xMax: 20, widthCssPixels: 10 });
    await client.dispose();

    await expect(active).rejects.toBeInstanceOf(TimeSeriesWorkerDisposedError);
    await expect(queued).rejects.toBeInstanceOf(TimeSeriesWorkerDisposedError);
    expect(worker.terminateCalls).toBe(1);
  });

  test("snapshots queued viewport inputs at call time", async () => {
    const worker = new ControlledWorker();
    const client = new TimeSeriesWorkerClient(worker);
    const active = client.view({ xMin: 0, xMax: 10, widthCssPixels: 10 });
    const request = { xMin: 20, xMax: 30, widthCssPixels: 50 };
    const options: { backend: "js" | "wasm" } = { backend: "js" };
    const queued = client.view(request, options);
    request.xMin = 999;
    options.backend = "wasm";

    worker.succeed(0, { x: new Float64Array([0]), y: new Float64Array([0]) });
    await expect(active).rejects.toBeInstanceOf(TimeSeriesWorkerSupersededError);
    await Promise.resolve();
    expect(worker.sent[1].message).toMatchObject({
      request: { xMin: 20, xMax: 30, widthCssPixels: 50 },
      options: { backend: "js" },
    });
    worker.succeed(1, { x: new Float64Array([20]), y: new Float64Array([2]) });
    await queued;
  });
});
