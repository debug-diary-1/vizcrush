/**
 * Updates the #stats element with performance stat pills.
 */
export function updatePerfDisplay(stats: {
  backend: string;
  inputPoints: number;
  outputPoints: number;
  reductionPct: number;
  lttbMs: number;
  minmaxMs: number;
}): void {
  const el = document.getElementById("stats");
  if (!el) return;

  const pills: Array<{ label: string; value: string }> = [
    { label: "Backend", value: stats.backend },
    { label: "Input", value: stats.inputPoints.toLocaleString() },
    { label: "Output", value: stats.outputPoints.toLocaleString() },
    { label: "Reduction", value: `${stats.reductionPct.toFixed(1)}%` },
    { label: "LTTB", value: `${stats.lttbMs.toFixed(1)}ms` },
    { label: "MinMaxLTTB", value: `${stats.minmaxMs.toFixed(1)}ms` },
  ];

  el.innerHTML = pills
    .map(
      (p) =>
        `<div class="stat"><div class="stat-label">${p.label}</div><div class="stat-value">${p.value}</div></div>`,
    )
    .join("\n");
}
