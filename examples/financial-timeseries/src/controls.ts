/**
 * Attaches change event listeners to the #dataSize and #targetPoints
 * select elements, invoking the callback with the parsed numeric values.
 */
export function setupControls(onChange: (dataSize: number, targetPoints: number) => void): void {
  const dataSizeEl = document.getElementById("dataSize") as HTMLSelectElement;
  const targetPointsEl = document.getElementById("targetPoints") as HTMLSelectElement;

  if (!dataSizeEl || !targetPointsEl) {
    console.error("Controls: #dataSize or #targetPoints element not found");
    return;
  }

  function emit() {
    const dataSize = parseInt(dataSizeEl.value, 10);
    const targetPoints = parseInt(targetPointsEl.value, 10);
    onChange(dataSize, targetPoints);
  }

  dataSizeEl.addEventListener("change", emit);
  targetPointsEl.addEventListener("change", emit);

  // Fire once on setup so the initial state is applied
  emit();
}
