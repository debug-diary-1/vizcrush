import { init } from "@vizcrush/core";
import { buildOctree, queryRange3d, queryNearest3d } from "@vizcrush/spatial3d";
import { bin3d } from "@vizcrush/bin3d";

const statusEl = document.getElementById("status")!;
const resultsBody = document.getElementById("resultsBody")!;
const summaryEl = document.getElementById("summary")!;
const summaryText = document.getElementById("summaryText")!;
const runBtn = document.getElementById("runBtn")!;
const pointCountSelect = document.getElementById("pointCount") as HTMLSelectElement;
const runsSelect = document.getElementById("runs") as HTMLSelectElement;

function status(msg: string) {
  statusEl.textContent = msg;
}

function generate3d(n: number) {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cluster = Math.floor(Math.random() * 8);
    x[i] = (cluster & 1 ? 50 : -50) + (Math.random() - 0.5) * 60;
    y[i] = (cluster & 2 ? 50 : -50) + (Math.random() - 0.5) * 60;
    z[i] = (cluster & 4 ? 50 : -50) + (Math.random() - 0.5) * 60;
  }
  return { x, y, z };
}

function bench(fn: () => void, runs: number): number {
  for (let i = 0; i < 3; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(runs / 2)] * 100) / 100;
}

interface Row {
  operation: string;
  vizcrush: number;
  bruteForce: number;
}

function addRow(row: Row) {
  const faster = row.vizcrush <= row.bruteForce;
  let ratio: string;
  if (faster) {
    ratio =
      row.vizcrush === 0 ? "∞ faster" : (row.bruteForce / row.vizcrush).toFixed(1) + "x faster";
  } else {
    ratio =
      row.bruteForce === 0 ? "∞ slower" : (row.vizcrush / row.bruteForce).toFixed(1) + "x slower";
  }

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="op">${row.operation}</td>
    <td class="vc">${row.vizcrush}ms</td>
    <td class="comp">${row.bruteForce}ms</td>
    <td class="${faster ? "win" : "lose"}">${ratio}</td>
  `;
  resultsBody.appendChild(tr);
  return row;
}

async function runBenchmark() {
  const n = parseInt(pointCountSelect.value);
  const runs = parseInt(runsSelect.value);
  resultsBody.innerHTML = "";
  summaryEl.style.display = "none";
  runBtn.setAttribute("disabled", "");

  status(`Generating ${n.toLocaleString()} 3D points...`);
  await new Promise((r) => setTimeout(r, 50));

  const { x, y, z } = generate3d(n);
  const rows: Row[] = [];

  // 1. Octree build
  status("Benchmarking octree build...");
  await new Promise((r) => setTimeout(r, 50));

  const buildTimes: number[] = [];
  for (let i = 0; i < Math.min(runs, 10); i++) {
    const t0 = performance.now();
    await buildOctree(x, y, z);
    buildTimes.push(performance.now() - t0);
  }
  buildTimes.sort((a, b) => a - b);
  const vcBuild = Math.round(buildTimes[Math.floor(buildTimes.length / 2)] * 100) / 100;

  const bfBuild = bench(() => {
    // Naive spatial structure: sort points into an 8-cell grid (manual spatial partitioning)
    const cells: number[][] = [[], [], [], [], [], [], [], []];
    for (let i = 0; i < n; i++) {
      const cx = x[i] >= 0 ? 1 : 0;
      const cy = y[i] >= 0 ? 2 : 0;
      const cz = z[i] >= 0 ? 4 : 0;
      cells[cx | cy | cz].push(i);
    }
  }, runs);

  rows.push(
    addRow({
      operation: `Spatial index build (${(n / 1000).toFixed(0)}K)`,
      vizcrush: vcBuild,
      bruteForce: bfBuild,
    }),
  );

  // Build tree once for query benchmarks
  const tree = await buildOctree(x, y, z);

  // 2. Range query (5% volume)
  status("Benchmarking 3D range query...");
  await new Promise((r) => setTimeout(r, 50));

  const vcRange = bench(() => {
    queryRange3d(tree, { xMin: -20, xMax: 20, yMin: -20, yMax: 20, zMin: -20, zMax: 20 });
  }, runs);

  const bfRange = bench(() => {
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
      if (x[i] >= -20 && x[i] <= 20 && y[i] >= -20 && y[i] <= 20 && z[i] >= -20 && z[i] <= 20)
        result.push(i);
    }
  }, runs);

  rows.push(
    addRow({ operation: "3D range query (5% vol)", vizcrush: vcRange, bruteForce: bfRange }),
  );

  // 3. kNN (k=10)
  status("Benchmarking 3D kNN...");
  await new Promise((r) => setTimeout(r, 50));

  const vcKnn = bench(() => {
    queryNearest3d(tree, 0, 0, 0, 10);
  }, runs);

  const bfKnn = bench(() => {
    const dists: Array<{ d: number; i: number }> = [];
    for (let i = 0; i < n; i++) {
      const d = x[i] * x[i] + y[i] * y[i] + z[i] * z[i];
      if (dists.length < 10 || d < dists[dists.length - 1].d) {
        dists.push({ d, i });
        dists.sort((a, b) => a.d - b.d);
        if (dists.length > 10) dists.length = 10;
      }
    }
  }, runs);

  rows.push(addRow({ operation: "3D kNN (k=10)", vizcrush: vcKnn, bruteForce: bfKnn }));

  // 4. Voxel bin3d
  status("Benchmarking voxel binning...");
  await new Promise((r) => setTimeout(r, 50));

  const vcBinTimes: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await bin3d(x, y, z, { xBins: 16, yBins: 16, zBins: 16 });
    vcBinTimes.push(performance.now() - t0);
  }
  vcBinTimes.sort((a, b) => a - b);
  const vcBin = Math.round(vcBinTimes[Math.floor(runs / 2)] * 100) / 100;

  const bfBin = bench(() => {
    let mnX = Infinity,
      mxX = -Infinity,
      mnY = Infinity,
      mxY = -Infinity,
      mnZ = Infinity,
      mxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i] < mnX) mnX = x[i];
      if (x[i] > mxX) mxX = x[i];
      if (y[i] < mnY) mnY = y[i];
      if (y[i] > mxY) mxY = y[i];
      if (z[i] < mnZ) mnZ = z[i];
      if (z[i] > mxZ) mxZ = z[i];
    }
    const grid = new Uint32Array(16 * 16 * 16);
    const xW = (mxX - mnX) / 16,
      yW = (mxY - mnY) / 16,
      zW = (mxZ - mnZ) / 16;
    for (let i = 0; i < n; i++) {
      let xi = Math.floor((x[i] - mnX) / xW);
      if (xi >= 16) xi = 15;
      let yi = Math.floor((y[i] - mnY) / yW);
      if (yi >= 16) yi = 15;
      let zi = Math.floor((z[i] - mnZ) / zW);
      if (zi >= 16) zi = 15;
      grid[zi * 256 + yi * 16 + xi]++;
    }
  }, runs);

  rows.push(addRow({ operation: "Voxel bin3d (16³)", vizcrush: vcBin, bruteForce: bfBin }));

  // 5. Repeated range queries (simulating 60fps interaction)
  status("Benchmarking sustained query throughput...");
  await new Promise((r) => setTimeout(r, 50));

  const queryCount = 60;
  const vcSustained = bench(() => {
    for (let q = 0; q < queryCount; q++) {
      const off = Math.sin(q * 0.1) * 30;
      queryRange3d(tree, {
        xMin: -20 + off,
        xMax: 20 + off,
        yMin: -20,
        yMax: 20,
        zMin: -20,
        zMax: 20,
      });
    }
  }, 10);

  const bfSustained = bench(() => {
    for (let q = 0; q < queryCount; q++) {
      const off = Math.sin(q * 0.1) * 30;
      const result: number[] = [];
      for (let i = 0; i < n; i++) {
        if (
          x[i] >= -20 + off &&
          x[i] <= 20 + off &&
          y[i] >= -20 &&
          y[i] <= 20 &&
          z[i] >= -20 &&
          z[i] <= 20
        )
          result.push(i);
      }
    }
  }, 10);

  rows.push(
    addRow({
      operation: `${queryCount} queries (1 sec @60fps)`,
      vizcrush: vcSustained,
      bruteForce: bfSustained,
    }),
  );

  // Summary
  const queryRow = rows.find((r) => r.operation.includes("range query"));
  if (queryRow) {
    const saved = queryRow.bruteForce - queryRow.vizcrush;
    const breakEven = saved > 0 ? Math.ceil(vcBuild / saved) : Infinity;
    const wins = rows.filter((r) => r.vizcrush <= r.bruteForce).length;

    summaryText.innerHTML = `
      vizcrush wins <span class="big">${wins}/${rows.length}</span> benchmarks.<br><br>
      Octree build: ${vcBuild}ms (one-time cost).<br>
      Each range query saves ${saved.toFixed(2)}ms.<br>
      Break-even: <strong>${breakEven} queries</strong> = <strong>${(breakEven / 60).toFixed(1)}s at 60fps</strong>.<br><br>
      After ${(breakEven / 60).toFixed(1)} seconds of user interaction, every frame is free performance.
    `;
    summaryEl.style.display = "block";
  }

  status(`Done! ${n.toLocaleString()} points, ${runs} runs per benchmark.`);
  runBtn.removeAttribute("disabled");
}

// Init
init().then((gpu) => {
  status(`Backend: ${gpu.backend}. Click "Run Benchmark" to start.`);
});

runBtn.addEventListener("click", () => runBenchmark());
