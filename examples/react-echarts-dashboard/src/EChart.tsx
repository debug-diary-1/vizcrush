import { useEffect, useRef } from "react";
import { LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import type { ECharts as EChartsInstance } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, DataZoomComponent, GridComponent, TooltipComponent, CanvasRenderer]);

interface EChartProps {
  x: Float64Array | null;
  y: Float64Array | null;
  onSetOption: (elapsed: number) => void;
}

export function EChart({ x, y, onSetOption }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsInstance | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !x || !y) return;

    const points = Array.from(x, (value, index) => [value, y[index]]);
    const started = performance.now();
    chart.setOption(
      {
        animation: false,
        grid: { left: 56, right: 22, top: 26, bottom: 58 },
        tooltip: { trigger: "axis" },
        dataZoom: [{ type: "inside" }, { type: "slider", height: 20 }],
        xAxis: { type: "value", name: "sample", nameLocation: "middle", nameGap: 28 },
        yAxis: { type: "value", name: "value" },
        series: [
          {
            type: "line",
            data: points,
            showSymbol: false,
            sampling: "none",
            lineStyle: { width: 1.5, color: "#55d6be" },
          },
        ],
      },
      { notMerge: true, lazyUpdate: false },
    );
    onSetOption(performance.now() - started);
  }, [onSetOption, x, y]);

  return (
    <div
      ref={containerRef}
      className="chart"
      role="img"
      aria-label="ECharts line chart of the vizcrush-downsampled time series"
    />
  );
}
