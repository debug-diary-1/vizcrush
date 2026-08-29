import Chart from "chart.js/auto";

/** Render vizcrush's LTTB output directly with Chart.js. */
export function renderLineChart(container: HTMLElement, x: Float64Array, y: Float64Array): void {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "One million time-series points downsampled to two thousand");
  container.replaceChildren(canvas);

  const points = Array.from(x, (timestamp, index) => ({ x: timestamp, y: y[index] }));

  new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "LTTB output",
          data: points,
          borderColor: "#3b9ecf",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
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
          grid: { color: "#222" },
          ticks: { color: "#888" },
        },
        y: {
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
