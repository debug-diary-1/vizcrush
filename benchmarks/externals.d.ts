declare module "d3-array" {
  export function bin(): any;
}
declare module "simple-statistics" {
  export function mean(data: number[]): number;
  export function standardDeviation(data: number[]): number;
  export function min(data: number[]): number;
  export function max(data: number[]): number;
  const ss: {
    mean: typeof mean;
    standardDeviation: typeof standardDeviation;
    min: typeof min;
    max: typeof max;
  };
  export default ss;
}
declare module "rbush" {
  export default class RBush<T = any> {
    load(items: T[]): void;
    search(bbox: { minX: number; minY: number; maxX: number; maxY: number }): T[];
  }
}
declare module "kdbush" {
  export default class KDBush {
    constructor(points: Float64Array, getX?: (id: number) => number, getY?: (id: number) => number);
    range(minX: number, minY: number, maxX: number, maxY: number): number[];
    within(x: number, y: number, r: number): number[];
  }
}
declare module "downsample" {
  export function LTTB(
    data: Array<{ x: number; y: number }>,
    threshold: number,
  ): Array<{ x: number; y: number }>;
}
