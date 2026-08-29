import Chart from "chart.js/auto";

/** Render non-empty vizcrush density bins as a Chart.js scatter dataset. */
export function renderScatterDensity(
  container: HTMLElement,
  grid: Uint32Array,
  xBins: number,
  yBins: number,
  maxCount: number,
): void {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Density bins computed from five hundred thousand scatter points",
  );
  container.replaceChildren(canvas);

  const points: Array<{ x: number; y: number }> = [];
  const colors: string[] = [];
  const radii: number[] = [];

  for (let row = 0; row < yBins; row++) {
    for (let col = 0; col < xBins; col++) {
      const count = grid[row * xBins + col];
      if (count === 0) continue;

      const t = maxCount > 0 ? count / maxCount : 0;
      const r = Math.round(lerp(13, 253, t));
      const g = Math.round(lerp(8, 231, t));
      const b = Math.round(lerp(135, 37, t));

      points.push({ x: col, y: row });
      colors.push(`rgb(${r}, ${g}, ${b})`);
      radii.push(1 + Math.sqrt(t) * 5);
    }
  }

  new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Non-empty density bins",
          data: points,
          pointBackgroundColor: colors,
          pointBorderWidth: 0,
          pointRadius: radii,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: xBins - 1,
          grid: { color: "#222" },
          ticks: { color: "#888" },
        },
        y: {
          type: "linear",
          min: 0,
          max: yBins - 1,
          grid: { color: "#222" },
          ticks: { color: "#888" },
        },
      },
      plugins: {
        legend: { labels: { color: "#aaa" } },
      },
    },
  });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
