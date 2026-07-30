/**
 * MockWebSocket simulates a WebSocket connection that emits batches of
 * streaming metric data (sine wave + noise) at a fixed interval.
 */
export class MockWebSocket {
  onmessage: ((event: { data: Float64Array }) => void) | null = null;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tick = 0;

  /**
   * Start emitting data. Every 50 ms a batch of 50 random data points is
   * generated (sine wave with additive uniform noise) and delivered via
   * the `onmessage` callback.
   */
  start(): void {
    if (this.intervalId !== null) return;

    this.intervalId = setInterval(() => {
      const batch = new Float64Array(50);
      for (let i = 0; i < 50; i++) {
        batch[i] = Math.sin(this.tick * 0.01) * 50 + Math.random() * 20 - 10;
        this.tick++;
      }
      if (this.onmessage) {
        this.onmessage({ data: batch });
      }
    }, 50);
  }

  /** Stop emitting data. */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
