import { bin2dWithBackend } from "@vizcrush/bin";
import { COORDINATE_SYSTEM, Deck, OrthographicView } from "@deck.gl/core";
import { GridCellLayer } from "@deck.gl/layers";
import "./styles.css";

interface Cell {
  position: [number, number];
  count: number;
}

const POINT_COUNT = 1_000_000;
const resolutionSelect = document.querySelector<HTMLSelectElement>("#resolution")!;
const container = document.querySelector<HTMLDivElement>("#deck")!;
const status = document.querySelector<HTMLElement>("#status")!;
const fields = {
  cells: document.querySelector<HTMLElement>("#cells")!,
  backend: document.querySelector<HTMLElement>("#backend")!,
  elapsed: document.querySelector<HTMLElement>("#elapsed")!,
  peak: document.querySelector<HTMLElement>("#peak")!,
};

function makeCloud(): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(POINT_COUNT);
  const y = new Float64Array(POINT_COUNT);
  let state = 867_5309;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  const centers = [
    [220, 260],
    [510, 650],
    [760, 330],
    [680, 790],
  ];
  for (let i = 0; i < POINT_COUNT; i += 1) {
    const center = centers[i % centers.length];
    const radius = Math.sqrt(-2 * Math.log(Math.max(next(), 1e-8))) * 82;
    const angle = next() * Math.PI * 2;
    x[i] = Math.max(0, Math.min(1_000, center[0] + Math.cos(angle) * radius));
    y[i] = Math.max(0, Math.min(1_000, center[1] + Math.sin(angle) * radius));
  }
  return { x, y };
}

const source = makeCloud();
const deck = new Deck({
  parent: container,
  views: new OrthographicView({ id: "density", flipY: false }),
  initialViewState: { target: [500, 500, 0], zoom: -0.9 },
  controller: true,
});

function binOptions(resolution: number) {
  return {
    xBins: resolution,
    yBins: resolution,
    xRange: [0, 1_000] as [number, number],
    yRange: [0, 1_000] as [number, number],
  };
}

async function update(): Promise<void> {
  resolutionSelect.disabled = true;
  const resolution = Number(resolutionSelect.value);
  status.textContent = `Computing ${resolution} × ${resolution} density grid…`;
  const started = performance.now();
  const { result, backend } = await bin2dWithBackend(source.x, source.y, binOptions(resolution));
  const elapsed = performance.now() - started;
  const cells: Cell[] = [];
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const count = result.grid[row * resolution + column];
      if (count === 0) continue;
      cells.push({
        position: [result.xEdges[column], result.yEdges[row]],
        count,
      });
    }
  }
  const cellSize = result.xEdges[1] - result.xEdges[0];
  deck.setProps({
    layers: [
      new GridCellLayer<Cell>({
        id: `density-${resolution}`,
        data: cells,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: (cell) => cell.position,
        getFillColor: (cell) => {
          const intensity = Math.sqrt(cell.count / result.maxCount);
          return [35 + Math.round(80 * intensity), 90 + Math.round(155 * intensity), 180, 225];
        },
        cellSize,
        pickable: true,
        extruded: false,
      }),
    ],
    getTooltip: ({ object }: { object?: Cell }) =>
      object ? `${object.count.toLocaleString()} source positions` : null,
  });
  fields.cells.textContent = cells.length.toLocaleString();
  fields.backend.textContent = backend;
  fields.elapsed.textContent = `${elapsed.toFixed(1)} ms`;
  fields.peak.textContent = result.maxCount.toLocaleString();
  status.textContent = `${cells.length.toLocaleString()} non-empty cells passed to deck.gl. Drag to pan; wheel to zoom.`;
  resolutionSelect.disabled = false;
}

async function start(): Promise<void> {
  resolutionSelect.disabled = true;
  status.textContent = "Warming bin2d on the real input…";
  const resolution = Number(resolutionSelect.value);
  await bin2dWithBackend(source.x, source.y, binOptions(resolution));
  await update();
}

function reportError(error: unknown): void {
  status.textContent = `Density pipeline failed: ${error instanceof Error ? error.message : String(error)}`;
  resolutionSelect.disabled = false;
}

resolutionSelect.addEventListener("change", () => void update().catch(reportError));
window.addEventListener("beforeunload", () => deck.finalize());
void start().catch(reportError);
