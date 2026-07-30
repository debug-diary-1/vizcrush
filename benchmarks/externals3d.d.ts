declare module "sparse-octree" {
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
  }
  export class Box3 {
    constructor(min?: Vector3, max?: Vector3);
    min: Vector3;
    max: Vector3;
  }
  export class PointOctree<T = any> {
    constructor(min: Vector3, max: Vector3, bias?: number, maxPoints?: number, maxDepth?: number);
    set(point: Vector3, data: T): void;
    findPoints(
      point: Vector3,
      radius: number,
      skipSelf?: boolean,
    ): Array<{ point: Vector3; data: T; distance: number }>;
    cull(region: any): any;
    pointCount: number;
  }
  export class OctreeRaycaster {}
}
