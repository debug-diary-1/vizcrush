export interface StreamStats {
  bufferSize: number;
  totalIngested: number;
  displayedPoints: number;
  mean: string;
  min: string;
  max: string;
  stdDev: string;
  backend: string;
}

/**
 * Renders a grid of stat "pills" inside the given element.
 */
export function updateStatsDisplay(el: HTMLElement, stats: StreamStats): void {
  const entries: Array<{ label: string; value: string }> = [
    { label: "Buffer", value: stats.bufferSize.toLocaleString() },
    { label: "Ingested", value: stats.totalIngested.toLocaleString() },
    { label: "Displayed", value: String(stats.displayedPoints) },
    { label: "Mean", value: stats.mean },
    { label: "Min", value: stats.min },
    { label: "Max", value: stats.max },
    { label: "Std Dev", value: stats.stdDev },
    { label: "Backend", value: stats.backend },
  ];

  el.innerHTML = entries
    .map(
      (e) =>
        `<div class="pill"><div class="pill-label">${e.label}</div><div class="pill-value">${e.value}</div></div>`,
    )
    .join("");
}
