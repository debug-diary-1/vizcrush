export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface LinearScale {
  (value: number): number;
  domain(): [number, number];
  domain(d: [number, number]): LinearScale;
  range(): [number, number];
}

/**
 * Creates D3-compatible linear scale objects using plain linear interpolation.
 * No d3 import required.
 */
export function createScales(
  bounds: Bounds,
  width: number,
  height: number,
): { xScale: LinearScale; yScale: LinearScale } {
  const xScale = makeLinearScale([bounds.xMin, bounds.xMax], [0, width]);
  const yScale = makeLinearScale(
    [bounds.yMin, bounds.yMax],
    [height, 0], // y is inverted in screen space
  );

  return { xScale, yScale };
}

function makeLinearScale(
  initialDomain: [number, number],
  initialRange: [number, number],
): LinearScale {
  let d: [number, number] = [...initialDomain] as [number, number];
  let r: [number, number] = [...initialRange] as [number, number];

  const scale = ((value: number): number => {
    const t = (value - d[0]) / (d[1] - d[0] || 1);
    return r[0] + t * (r[1] - r[0]);
  }) as LinearScale;

  scale.domain = function (newDomain?: [number, number]): any {
    if (newDomain === undefined) return [...d] as [number, number];
    d = [...newDomain] as [number, number];
    return scale;
  };

  scale.range = function (): [number, number] {
    return [...r] as [number, number];
  };

  return scale;
}
