/**
 * Renders percentile annotations as styled HTML elements inside a container.
 */

/**
 * Display percentile values as a row of labeled stat boxes.
 *
 * @param container - Parent element to render into (will replace its contents)
 * @param pcts     - Float64Array of percentile values
 * @param labels   - Human-readable labels for each percentile (e.g. ["P10", "P25", "P50", "P75", "P90"])
 */
export function renderStatsOverlay(
  container: HTMLElement,
  pcts: Float64Array,
  labels: string[],
): void {
  // Clear previous content
  container.innerHTML = "";

  const count = Math.min(pcts.length, labels.length);

  for (let i = 0; i < count; i++) {
    const wrapper = document.createElement("div");
    wrapper.className = "stat";

    const labelEl = document.createElement("div");
    labelEl.className = "stat-label";
    labelEl.textContent = labels[i];

    const valueEl = document.createElement("div");
    valueEl.className = "stat-value";
    valueEl.textContent = pcts[i].toFixed(4);

    wrapper.appendChild(labelEl);
    wrapper.appendChild(valueEl);
    container.appendChild(wrapper);
  }
}
