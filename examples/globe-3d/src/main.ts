import { init } from "@vizcrush/core";
import { buildOctree, queryRange3d } from "@vizcrush/spatial3d";
import {
  generateFlightPaths,
  generateEarthquakes,
  generateShippingRoutes,
  type GeoDataSet,
} from "./geo-data";
import { renderGlobe, geoTo3d, type Rotation } from "./globe-renderer";

/* ------------------------------------------------------------------ */
/*  DOM references                                                     */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const _ctx = canvas.getContext("2d")!;

const statBackend = document.getElementById("stat-backend")!;
const statTotal = document.getElementById("stat-total")!;
const statVisible = document.getElementById("stat-visible")!;
const statQuery = document.getElementById("stat-query")!;

const dataButtons = document.querySelectorAll<HTMLButtonElement>(".controls button[data-type]");

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */
const POINT_COUNT = 100_000;
let dataType: "flights" | "earthquakes" | "shipping" = "flights";
let geoData: GeoDataSet;

// 3D cartesian arrays (converted from lat/lng)
let cartX: Float64Array;
let cartY: Float64Array;
let cartZ: Float64Array;
let octree: Awaited<ReturnType<typeof buildOctree>> | null = null;

const rotation: Rotation = {
  yaw: -0.3,
  pitch: 0.25,
};

/* ------------------------------------------------------------------ */
/*  Data generation                                                    */
/* ------------------------------------------------------------------ */
function generateData(type: typeof dataType): GeoDataSet {
  switch (type) {
    case "flights":
      return generateFlightPaths(POINT_COUNT);
    case "earthquakes":
      return generateEarthquakes(POINT_COUNT);
    case "shipping":
      return generateShippingRoutes(POINT_COUNT);
  }
}

function convertToCartesian(geo: GeoDataSet): {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
} {
  const n = geo.lat.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const p = geoTo3d(geo.lat[i], geo.lng[i], geo.alt[i]);
    x[i] = p.x;
    y[i] = p.y;
    z[i] = p.z;
  }

  return { x, y, z };
}

/* ------------------------------------------------------------------ */
/*  Colour by data type                                                */
/* ------------------------------------------------------------------ */
function getColor(type: typeof dataType, value: number, visible: boolean): string {
  const alpha = visible ? 0.9 : 0.2;

  switch (type) {
    case "flights": {
      // Blue to cyan based on altitude
      const t = Math.min(1, value / 12);
      const r = Math.round(30 + 60 * t);
      const g = Math.round(120 + 100 * t);
      const b = Math.round(200 + 55 * (1 - t));
      return `rgba(${r},${g},${b},${alpha})`;
    }
    case "earthquakes": {
      // Green to red based on magnitude
      const t = Math.min(1, (value - 2) / 7);
      const r = Math.round(40 + 215 * t);
      const g = Math.round(200 - 160 * t);
      const b = Math.round(40);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    case "shipping": {
      // Teal to orange based on cargo value
      const t = Math.min(1, value / 50);
      const r = Math.round(40 + 180 * t);
      const g = Math.round(180 - 40 * t);
      const b = Math.round(160 - 120 * t);
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */
async function bootstrap() {
  const gpu = await init();
  statBackend.textContent = gpu.backend;
  await rebuild();
}

async function rebuild() {
  // Generate geo data
  geoData = generateData(dataType);

  // Convert to 3D cartesian
  const cart = convertToCartesian(geoData);
  cartX = cart.x;
  cartY = cart.y;
  cartZ = cart.z;

  statTotal.textContent = POINT_COUNT.toLocaleString();

  // Build octree on 3D cartesian points
  octree = await buildOctree(cartX, cartY, cartZ);

  render();
}

/* ------------------------------------------------------------------ */
/*  Render                                                             */
/* ------------------------------------------------------------------ */
function render() {
  if (!octree) return;

  // Draw globe wireframe and get projection function
  const project = renderGlobe(canvas, rotation);

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  // Query visible hemisphere: use the rotation to determine which half of
  // the bounding box is facing the camera. We query a broad range and use
  // the projection's visibility check per-point.
  const t0 = performance.now();

  // Query all points (octree makes this fast for spatial locality)
  const allIndices = queryRange3d(octree, {
    xMin: octree.bounds.xMin,
    xMax: octree.bounds.xMax,
    yMin: octree.bounds.yMin,
    yMax: octree.bounds.yMax,
    zMin: octree.bounds.zMin,
    zMax: octree.bounds.zMax,
  });

  const queryMs = performance.now() - t0;
  statQuery.textContent = `${queryMs.toFixed(1)} ms`;

  // Cap rendering for Canvas 2D performance
  const MAX_RENDER = 60_000;
  const step = Math.max(1, Math.floor(allIndices.length / MAX_RENDER));

  // Project and render data points
  const dpr = window.devicePixelRatio || 1;
  const ctxDraw = canvas.getContext("2d")!;
  ctxDraw.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Bucket by colour for batched drawing
  const bucketCount = 8;
  const buckets: Array<Array<{ sx: number; sy: number; size: number; visible: boolean }>> =
    Array.from({ length: bucketCount }, () => []);

  let visibleCount = 0;

  for (let i = 0; i < allIndices.length; i += step) {
    const idx = allIndices[i];
    const px = cartX[idx];
    const py = cartY[idx];
    const pz = cartZ[idx];

    const p = project(px, py, pz);
    if (!p) continue;
    if (p.sx < -10 || p.sx > w + 10 || p.sy < -10 || p.sy > h + 10) continue;

    // Point size: larger for earthquakes (magnitude), smaller for others
    let size: number;
    if (dataType === "earthquakes") {
      size = Math.max(0.8, geoData.value[idx] * 0.35);
    } else {
      size = p.visible ? 1.2 : 0.6;
    }

    if (p.visible) visibleCount++;

    const val = geoData.value[idx];
    const maxVal = dataType === "earthquakes" ? 9 : dataType === "flights" ? 12 : 50;
    const bucket = Math.min(
      bucketCount - 1,
      Math.floor((Math.min(val, maxVal) / maxVal) * bucketCount),
    );

    buckets[bucket].push({
      sx: p.sx,
      sy: p.sy,
      size,
      visible: p.visible,
    });
  }

  // Draw back-hemisphere points first (dimmer), then front
  for (let pass = 0; pass < 2; pass++) {
    const drawVisible = pass === 1;

    for (let b = 0; b < bucketCount; b++) {
      const pts = buckets[b].filter((p) => p.visible === drawVisible);
      if (pts.length === 0) continue;

      const t = b / (bucketCount - 1);
      const valForColor =
        dataType === "earthquakes" ? 2 + t * 7 : dataType === "flights" ? t * 12 : t * 50;

      ctxDraw.fillStyle = getColor(dataType, valForColor, drawVisible);
      ctxDraw.beginPath();

      for (let j = 0; j < pts.length; j++) {
        const pt = pts[j];
        ctxDraw.moveTo(pt.sx + pt.size, pt.sy);
        ctxDraw.arc(pt.sx, pt.sy, pt.size, 0, Math.PI * 2);
      }
      ctxDraw.fill();
    }
  }

  statVisible.textContent = `${visibleCount.toLocaleString()} / ${Math.min(allIndices.length, MAX_RENDER).toLocaleString()}`;
}

/* ------------------------------------------------------------------ */
/*  Interaction: mouse drag to orbit                                   */
/* ------------------------------------------------------------------ */
let dragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener("mousedown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  rotation.yaw += dx * 0.005;
  rotation.pitch = Math.max(
    -Math.PI / 2 + 0.05,
    Math.min(Math.PI / 2 - 0.05, rotation.pitch + dy * 0.005),
  );
  render();
});

window.addEventListener("mouseup", () => {
  dragging = false;
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    // No zoom for globe — just re-render (could add zoom later)
    render();
  },
  { passive: false },
);

/* ------------------------------------------------------------------ */
/*  Data type selector                                                 */
/* ------------------------------------------------------------------ */
dataButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const type = btn.dataset.type as typeof dataType;
    if (type && type !== dataType) {
      dataType = type;
      dataButtons.forEach((b) => b.classList.toggle("active", b.dataset.type === type));
      rebuild();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Resize                                                             */
/* ------------------------------------------------------------------ */
window.addEventListener("resize", () => render());

/* ------------------------------------------------------------------ */
/*  Go                                                                 */
/* ------------------------------------------------------------------ */
bootstrap();
