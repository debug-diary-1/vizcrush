import { init } from "@vizcrush/core";
import { buildQuadtree, queryRange } from "@vizcrush/spatial";
import * as d3 from "d3";

async function main() {
  const gpu = await init();

  // ── Generate 1M genomics-like scatter data ──
  const N = 1_000_000;
  const xData = new Float64Array(N);
  const yData = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    // Clustered distribution simulating gene expression data
    const cluster = Math.floor(Math.random() * 8);
    const cx = (cluster % 4) * 250 + 125;
    const cy = Math.floor(cluster / 4) * 300 + 150;
    xData[i] = cx + (Math.random() - 0.5) * 200 + Math.random() * 50;
    yData[i] = cy + (Math.random() - 0.5) * 200 + Math.random() * 50;
  }

  // ── Build spatial index ──
  const t0 = performance.now();
  const tree = await buildQuadtree(xData, yData);
  const buildMs = performance.now() - t0;

  const width = 900,
    height = 600;
  const svg = d3.select("#chart");

  const xScale = d3.scaleLinear().domain([tree.bounds.xMin, tree.bounds.xMax]).range([0, width]);
  const yScale = d3.scaleLinear().domain([tree.bounds.yMin, tree.bounds.yMax]).range([height, 0]);

  const g = svg.append("g");

  // ── Render function: query only visible points ──
  function render() {
    const [x0, x1] = xScale.domain();
    const [y0, y1] = yScale.domain();

    const t1 = performance.now();
    const visible = queryRange(tree, { xMin: x0, xMax: x1, yMin: y0, yMax: y1 });
    const queryMs = performance.now() - t1;

    // Cap rendering at 10K points for DOM performance
    const maxRender = 10_000;
    const step = Math.max(1, Math.floor(visible.length / maxRender));
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < visible.length; i += step) {
      const idx = visible[i];
      points.push({ x: xData[idx], y: yData[idx] });
    }

    const circles = g.selectAll("circle").data(points);

    circles
      .enter()
      .append("circle")
      .attr("r", 1.5)
      .attr("fill", "#3B9ECF")
      .attr("opacity", 0.4)
      .merge(circles as any)
      .attr("cx", (d: any) => xScale(d.x))
      .attr("cy", (d: any) => yScale(d.y));

    circles.exit().remove();

    // Update info
    document.getElementById("info")!.innerHTML = `
      <span>Backend: <span class="value">${gpu.backend}</span></span>
      <span>Index build: <span class="value">${buildMs.toFixed(1)}ms</span></span>
      <span>Query: <span class="value">${queryMs.toFixed(2)}ms</span></span>
      <span>Visible: <span class="value">${visible.length.toLocaleString()}</span></span>
      <span>Rendered: <span class="value">${points.length.toLocaleString()}</span></span>
    `;
  }

  // ── Zoom handler ──
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.5, 50])
    .on("zoom", (event) => {
      const t = event.transform;
      const newX = t.rescaleX(
        d3.scaleLinear().domain([tree.bounds.xMin, tree.bounds.xMax]).range([0, width]),
      );
      const newY = t.rescaleY(
        d3.scaleLinear().domain([tree.bounds.yMin, tree.bounds.yMax]).range([height, 0]),
      );
      xScale.domain(newX.domain());
      yScale.domain(newY.domain());
      render();
    });

  svg.call(zoom as any);
  render();
}

main().catch(console.error);
