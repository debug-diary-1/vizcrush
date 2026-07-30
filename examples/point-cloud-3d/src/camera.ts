/**
 * Simple orbit camera with perspective projection.
 * All matrices are column-major Float64Array(16).
 */
export class OrbitCamera {
  /** Spherical coordinates around target */
  private theta = Math.PI / 4; // horizontal angle
  private phi = Math.PI / 3; // vertical angle (from top)
  private radius = 350;

  target: [number, number, number] = [0, 0, 0];
  fov = (60 * Math.PI) / 180;
  near = 1;
  far = 2000;

  get position(): [number, number, number] {
    const sinPhi = Math.sin(this.phi);
    return [
      this.target[0] + this.radius * sinPhi * Math.cos(this.theta),
      this.target[1] + this.radius * Math.cos(this.phi),
      this.target[2] + this.radius * sinPhi * Math.sin(this.theta),
    ];
  }

  /**
   * Orbit around the target.
   * @param dx - horizontal delta (pixels)
   * @param dy - vertical delta (pixels)
   */
  rotate(dx: number, dy: number): void {
    this.theta -= dx * 0.005;
    this.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.phi - dy * 0.005));
  }

  /**
   * Zoom in/out by adjusting radius.
   * @param delta - positive = zoom out, negative = zoom in
   */
  zoom(delta: number): void {
    this.radius = Math.max(20, Math.min(1500, this.radius + delta * 0.5));
  }

  /**
   * Build a lookAt view matrix (column-major).
   */
  getViewMatrix(): Float64Array {
    const eye = this.position;
    const [tx, ty, tz] = this.target;

    // Forward (camera looks from eye to target)
    let fx = tx - eye[0];
    let fy = ty - eye[1];
    let fz = tz - eye[2];
    const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz);
    fx /= fLen;
    fy /= fLen;
    fz /= fLen;

    // Up = (0, 1, 0)
    const ux = 0,
      uy = 1,
      uz = 0;

    // Right = forward x up
    let rx = fy * uz - fz * uy;
    let ry = fz * ux - fx * uz;
    let rz = fx * uy - fy * ux;
    const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
    rx /= rLen;
    ry /= rLen;
    rz /= rLen;

    // Recalculate up = right x forward
    const upx = ry * fz - rz * fy;
    const upy = rz * fx - rx * fz;
    const upz = rx * fy - ry * fx;

    // Column-major 4x4
    const m = new Float64Array(16);
    m[0] = rx;
    m[1] = upx;
    m[2] = -fx;
    m[3] = 0;
    m[4] = ry;
    m[5] = upy;
    m[6] = -fy;
    m[7] = 0;
    m[8] = rz;
    m[9] = upz;
    m[10] = -fz;
    m[11] = 0;
    m[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
    m[13] = -(upx * eye[0] + upy * eye[1] + upz * eye[2]);
    m[14] = fx * eye[0] + fy * eye[1] + fz * eye[2];
    m[15] = 1;

    return m;
  }

  /**
   * Build a perspective projection matrix (column-major).
   */
  getProjectionMatrix(aspect: number): Float64Array {
    const f = 1.0 / Math.tan(this.fov / 2);
    const nf = 1 / (this.near - this.far);

    const m = new Float64Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (this.far + this.near) * nf;
    m[11] = -1;
    m[14] = 2 * this.far * this.near * nf;
    // all others default to 0
    return m;
  }

  /**
   * Return projection * view (column-major).
   */
  getMVPMatrix(aspect: number): Float64Array {
    const view = this.getViewMatrix();
    const proj = this.getProjectionMatrix(aspect);
    return mat4Multiply(proj, view);
  }
}

/**
 * Multiply two column-major 4x4 matrices: result = A * B
 */
function mat4Multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}
