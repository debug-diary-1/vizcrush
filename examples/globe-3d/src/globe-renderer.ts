/**
 * Wireframe globe renderer.
 *
 * Draws latitude/longitude grid lines using Canvas 2D,
 * projected via a simple perspective + orbit rotation.
 */

export interface Rotation {
  yaw: number; // horizontal rotation (radians)
  pitch: number; // vertical tilt (radians)
}

export type ProjectFn = (
  x: number,
  y: number,
  z: number,
) => { sx: number; sy: number; visible: boolean } | null;

const GLOBE_RADIUS = 200;

/**
 * Create a 3D -> 2D projection function for the given canvas size and rotation.
 */
function makeProjection(w: number, h: number, rotation: Rotation, perspectiveD: number): ProjectFn {
  const cosY = Math.cos(rotation.yaw);
  const sinY = Math.sin(rotation.yaw);
  const cosP = Math.cos(rotation.pitch);
  const sinP = Math.sin(rotation.pitch);

  const cx = w / 2;
  const cy = h / 2;

  return (x: number, y: number, z: number) => {
    // Rotate around Y axis (yaw)
    const x1 = x * cosY - z * sinY;
    const z1 = x * sinY + z * cosY;
    const y1 = y;

    // Rotate around X axis (pitch)
    const y2 = y1 * cosP - z1 * sinP;
    const z2 = y1 * sinP + z1 * cosP;
    const x2 = x1;

    // Perspective
    const depth = z2 + perspectiveD;
    if (depth <= 10) return null;

    const scale = perspectiveD / depth;
    const sx = cx + x2 * scale;
    const sy = cy - y2 * scale;

    // visible = front hemisphere (z2 > 0 relative to camera means back)
    const visible = z2 >= -5;

    return { sx, sy, visible };
  };
}

/**
 * Draw the wireframe globe and return the projection function
 * so the caller can project data points onto the same view.
 */
export function renderGlobe(canvas: HTMLCanvasElement, rotation: Rotation): ProjectFn {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }

  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const perspectiveD = 600;
  const project = makeProjection(w, h, rotation, perspectiveD);

  const toRad = Math.PI / 180;

  // Draw latitude lines every 30 degrees
  ctx.strokeStyle = "rgba(60, 70, 120, 0.35)";
  ctx.lineWidth = 0.5;

  for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
    const latRad = latDeg * toRad;
    const r = GLOBE_RADIUS * Math.cos(latRad);
    const yPos = GLOBE_RADIUS * Math.sin(latRad);

    ctx.beginPath();
    let started = false;

    for (let lngDeg = 0; lngDeg <= 360; lngDeg += 3) {
      const lngRad = lngDeg * toRad;
      const x = r * Math.cos(lngRad);
      const z = r * Math.sin(lngRad);

      const p = project(x, yPos, z);
      if (!p) continue;

      if (!started) {
        ctx.moveTo(p.sx, p.sy);
        started = true;
      } else {
        ctx.lineTo(p.sx, p.sy);
      }
    }
    ctx.stroke();
  }

  // Draw longitude lines every 30 degrees
  for (let lngDeg = 0; lngDeg < 180; lngDeg += 30) {
    const lngRad = lngDeg * toRad;

    ctx.beginPath();
    let started = false;

    for (let latDeg = -90; latDeg <= 90; latDeg += 3) {
      const latRad = latDeg * toRad;
      const x = GLOBE_RADIUS * Math.cos(latRad) * Math.cos(lngRad);
      const y = GLOBE_RADIUS * Math.sin(latRad);
      const z = GLOBE_RADIUS * Math.cos(latRad) * Math.sin(lngRad);

      const p = project(x, y, z);
      if (!p) continue;

      if (!started) {
        ctx.moveTo(p.sx, p.sy);
        started = true;
      } else {
        ctx.lineTo(p.sx, p.sy);
      }
    }
    ctx.stroke();

    // Opposite side of same longitude circle
    ctx.beginPath();
    started = false;

    for (let latDeg = -90; latDeg <= 90; latDeg += 3) {
      const latRad = latDeg * toRad;
      const x = GLOBE_RADIUS * Math.cos(latRad) * Math.cos(lngRad + Math.PI);
      const y = GLOBE_RADIUS * Math.sin(latRad);
      const z = GLOBE_RADIUS * Math.cos(latRad) * Math.sin(lngRad + Math.PI);

      const p = project(x, y, z);
      if (!p) continue;

      if (!started) {
        ctx.moveTo(p.sx, p.sy);
        started = true;
      } else {
        ctx.lineTo(p.sx, p.sy);
      }
    }
    ctx.stroke();
  }

  // Draw equator with slightly brighter style
  ctx.strokeStyle = "rgba(80, 100, 160, 0.5)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  let eqStarted = false;
  for (let lngDeg = 0; lngDeg <= 360; lngDeg += 2) {
    const lngRad = lngDeg * toRad;
    const x = GLOBE_RADIUS * Math.cos(lngRad);
    const z = GLOBE_RADIUS * Math.sin(lngRad);
    const p = project(x, 0, z);
    if (!p) continue;
    if (!eqStarted) {
      ctx.moveTo(p.sx, p.sy);
      eqStarted = true;
    } else {
      ctx.lineTo(p.sx, p.sy);
    }
  }
  ctx.stroke();

  // Draw globe outline (circle)
  const cx = w / 2;
  const cy = h / 2;
  const screenRadius = GLOBE_RADIUS * (perspectiveD / perspectiveD);
  ctx.strokeStyle = "rgba(80, 100, 180, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, screenRadius, 0, Math.PI * 2);
  ctx.stroke();

  return project;
}

/**
 * Convert lat/lng/altitude to 3D cartesian coordinates on the globe.
 *   x = R * cos(lat) * cos(lng)
 *   y = R * sin(lat)
 *   z = R * cos(lat) * sin(lng)
 * Altitude scales the radius slightly.
 */
export function geoTo3d(
  lat: number,
  lng: number,
  alt: number,
): { x: number; y: number; z: number } {
  const toRad = Math.PI / 180;
  const latR = lat * toRad;
  const lngR = lng * toRad;
  const R = GLOBE_RADIUS + alt * 2; // altitude scaled for visibility

  return {
    x: R * Math.cos(latR) * Math.cos(lngR),
    y: R * Math.sin(latR),
    z: R * Math.cos(latR) * Math.sin(lngR),
  };
}
