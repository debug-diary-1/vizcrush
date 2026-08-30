import { useCallback, useMemo, useState } from "react";
import { useDownsample, useStats, useVizcrush } from "@vizcrush/react";
import { EChart } from "./EChart";
import { makeSeries } from "./data";

type Algorithm = "lttb" | "minmax_lttb" | "m4";

interface Series {
  x: Float64Array;
  y: Float64Array;
}

const ALGORITHMS: Array<{ value: Algorithm; label: string }> = [
  { value: "lttb", label: "LTTB" },
  { value: "minmax_lttb", label: "Min-max LTTB" },
  { value: "m4", label: "M4" },
];

export function App() {
  const series = useMemo(makeSeries, []);
  return <WarmupGate series={series} />;
}

function Intro() {
  return (
    <header>
      <p className="eyebrow">vizcrush adoption example</p>
      <h1>React hooks → ECharts</h1>
      <p className="lede">
        React owns the controls, vizcrush reduces one million typed-array samples, and ECharts
        renders only the selected level of detail.
      </p>
    </header>
  );
}

function WarmupGate({ series }: { series: Series }) {
  const downsampleWarmup = useDownsample(series.x, series.y, {
    algorithm: "lttb",
    threshold: 2_000,
  });
  const statsWarmup = useStats(series.y);
  const error = downsampleWarmup.error ?? statsWarmup.error;

  if (error) {
    return (
      <main>
        <Intro />
        <p className="error">Warm-up failed: {error.message}</p>
      </main>
    );
  }

  if (!downsampleWarmup.data || !statsWarmup.data) {
    return (
      <main>
        <Intro />
        <p className="note" aria-live="polite">
          Warming the downsample and aggregate kernels on the real input…
        </p>
      </main>
    );
  }

  return <Dashboard series={series} />;
}

function Dashboard({ series }: { series: Series }) {
  const [algorithm, setAlgorithm] = useState<Algorithm>("lttb");
  const [threshold, setThreshold] = useState(2_000);
  const [setOptionElapsed, setSetOptionElapsed] = useState<number | null>(null);
  const context = useVizcrush();
  const reduced = useDownsample(series.x, series.y, { algorithm, threshold });
  const summary = useStats(reduced.data ? series.y : null);
  const handleSetOption = useCallback((elapsed: number) => setSetOptionElapsed(elapsed), []);
  const error = reduced.error ?? summary.error;

  return (
    <main>
      <Intro />

      <section className="controls" aria-label="Downsampling controls">
        <label>
          Algorithm
          <select
            value={algorithm}
            onChange={(event) => setAlgorithm(event.target.value as Algorithm)}
          >
            {ALGORITHMS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Display points
          <select value={threshold} onChange={(event) => setThreshold(Number(event.target.value))}>
            {[500, 1_000, 2_000, 5_000].map((value) => (
              <option key={value} value={value}>
                {value.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="metrics" aria-live="polite">
        <article>
          <span>Preferred backend</span>
          <strong>{context?.backend ?? "initializing"}</strong>
        </article>
        <article>
          <span>Input</span>
          <strong>{series.x.length.toLocaleString()}</strong>
        </article>
        <article>
          <span>Output</span>
          <strong>{reduced.data?.x.length.toLocaleString() ?? "—"}</strong>
        </article>
        <article>
          <span>Warm downsample</span>
          <strong>{reduced.elapsed?.toFixed(1) ?? "—"} ms</strong>
        </article>
        <article>
          <span>ECharts setOption</span>
          <strong>{setOptionElapsed?.toFixed(1) ?? "—"} ms</strong>
        </article>
        <article>
          <span>Mean ± σ</span>
          <strong>
            {summary.data
              ? `${summary.data.mean.toFixed(1)} ± ${summary.data.stdDev.toFixed(1)}`
              : "—"}
          </strong>
        </article>
      </section>

      {error ? <p className="error">{error.message}</p> : null}
      <section className="panel" aria-busy={reduced.loading || summary.loading}>
        <EChart
          x={reduced.data?.x ?? null}
          y={reduced.data?.y ?? null}
          onSetOption={handleSetOption}
        />
      </section>
      <p className="note">
        Timings cover only the named stage after one untimed real-input warm-up; startup is
        excluded. The preferred backend comes from capability detection, while a kernel may fall
        back if its lazy WASM module cannot load. Drag or wheel inside the chart to zoom.
      </p>
    </main>
  );
}
