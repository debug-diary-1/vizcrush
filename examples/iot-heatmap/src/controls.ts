/**
 * Sets up UI controls for the heatmap demo: resolution selector and color scale dropdown.
 */

const COLOR_SCALES = ["viridis", "plasma", "inferno"] as const;

/**
 * Bind change handlers to the #resolution select and inject a color scale dropdown
 * next to it inside the .controls container.
 *
 * @param onChange - Called whenever resolution or color scale selection changes
 */
export function setupControls(onChange: (resolution: number, colorScale: string) => void): void {
  const resSelect = document.getElementById("resolution") as HTMLSelectElement | null;
  if (!resSelect) {
    throw new Error("Could not find #resolution select element");
  }

  // Create the color scale dropdown
  const scaleSelect = document.createElement("select");
  scaleSelect.id = "color-scale";
  for (const name of COLOR_SCALES) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    scaleSelect.appendChild(opt);
  }

  // Apply same styling as the resolution select (inherits from the CSS `select` rule)
  const controlsContainer = resSelect.parentElement;
  if (controlsContainer) {
    controlsContainer.appendChild(scaleSelect);
  }

  function emitChange(): void {
    const resolution = parseInt(resSelect!.value, 10);
    const colorScale = scaleSelect.value;
    onChange(resolution, colorScale);
  }

  resSelect.addEventListener("change", emitChange);
  scaleSelect.addEventListener("change", emitChange);
}
