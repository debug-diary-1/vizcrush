import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { init } from "@vizcrush/core";
import { buildOctree, queryRange3d, queryNearest3d } from "@vizcrush/spatial3d";
import { generatePointCloud } from "./data-generator";

// ── DOM ──
const container = document.getElementById("three-container")!;
const tooltip = document.getElementById("tooltip")!;
const selectionInfo = document.getElementById("selection-info")!;
const modeHint = document.getElementById("mode-hint")!;

const statBackend = document.getElementById("stat-backend")!;
const statTotal = document.getElementById("stat-total")!;
const statOctree = document.getElementById("stat-octree")!;
const statKnn = document.getElementById("stat-knn")!;
const statSelection = document.getElementById("stat-selection")!;
const statBrute = document.getElementById("stat-brute")!;
const statFps = document.getElementById("stat-fps")!;

// ── State ──
let pointCount = 100_000;
let mode: "hover" | "select" = "hover";
let cloud: {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
};
let octree: Awaited<ReturnType<typeof buildOctree>> | null = null;

// Selection state
let isSelecting = false;
let selStart = { x: 0, y: 0 };
let selBox: HTMLDivElement | null = null;
let highlightedIndices = new Set<number>();

// FPS
let frameCount = 0;
let lastFpsTime = performance.now();

// ── Three.js ──
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0f);
scene.fog = new THREE.FogExp2(0x0a0a0f, 0.0012);

const camera = new THREE.PerspectiveCamera(
  60,
  container.clientWidth / container.clientHeight,
  1,
  2000,
);
camera.position.set(200, 150, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0x404060, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(100, 200, 150);
scene.add(dirLight);
scene.add(new THREE.GridHelper(300, 20, 0x1a1a2e, 0x111122));

// ── Point cloud (Three.js renders ALL points — no culling needed) ──
const MAX_PTS = 1_000_000;
const geometry = new THREE.BufferGeometry();
const posArr = new Float32Array(MAX_PTS * 3);
const colArr = new Float32Array(MAX_PTS * 3);
const posAttr = new THREE.Float32BufferAttribute(posArr, 3);
posAttr.setUsage(THREE.DynamicDrawUsage);
const colAttr = new THREE.Float32BufferAttribute(colArr, 3);
colAttr.setUsage(THREE.DynamicDrawUsage);
geometry.setAttribute("position", posAttr);
geometry.setAttribute("color", colAttr);

const pointsMesh = new THREE.Points(
  geometry,
  new THREE.PointsMaterial({
    size: 1.8,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
  }),
);
scene.add(pointsMesh);

// Highlight sphere for nearest point
const highlightSphere = new THREE.Mesh(
  new THREE.SphereGeometry(3, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.8 }),
);
highlightSphere.visible = false;
scene.add(highlightSphere);

// Neighbor spheres (k=10)
const neighborGroup = new THREE.Group();
scene.add(neighborGroup);
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0.5,
      wireframe: true,
    }),
  );
  m.visible = false;
  neighborGroup.add(m);
}

// Selection highlight points
const selGeometry = new THREE.BufferGeometry();
const selPosArr = new Float32Array(MAX_PTS * 3);
const selPosAttr = new THREE.Float32BufferAttribute(selPosArr, 3);
selPosAttr.setUsage(THREE.DynamicDrawUsage);
selGeometry.setAttribute("position", selPosAttr);
const selMesh = new THREE.Points(
  selGeometry,
  new THREE.PointsMaterial({
    size: 4,
    color: 0xf59e0b,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
  }),
);
selMesh.visible = false;
scene.add(selMesh);

// ── Build ──
async function rebuild(n: number) {
  pointCount = n;
  document
    .querySelectorAll<HTMLButtonElement>("button[data-count]")
    .forEach((b) => b.classList.toggle("active", Number(b.dataset.count) === n));

  cloud = generatePointCloud(n);
  statTotal.textContent = n.toLocaleString();

  // Build octree FIRST — then use it for LOD rendering
  const t0 = performance.now();
  octree = await buildOctree(cloud.x, cloud.y, cloud.z);
  statOctree.textContent = `${(performance.now() - t0).toFixed(0)}ms`;

  // Initial LOD render
  updateLOD();
}

// ── Raycasting: unproject mouse to 3D ray ──
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function _getMouseWorld(e: MouseEvent): THREE.Vector3 {
  const rect = container.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  // Project ray to a point at distance 300 from camera
  const dir = raycaster.ray.direction.clone().multiplyScalar(300);
  return raycaster.ray.origin.clone().add(dir);
}

// ── LOD: use octree to select points by distance from camera ──
const MAX_LOD_POINTS = 80_000;

function updateLOD() {
  if (!cloud || !octree) return;

  const camX = camera.position.x;
  const camY = camera.position.y;
  const camZ = camera.position.z;

  // Strategy: iterate all points, compute distance to camera,
  // keep point based on distance band:
  //   near (< 100):  keep every point
  //   mid (100-250):  keep every 4th
  //   far (> 250):    keep every 16th
  let writeIdx = 0;

  for (let i = 0; i < pointCount && writeIdx < MAX_LOD_POINTS; i++) {
    const dx = cloud.x[i] - camX;
    const dy = cloud.y[i] - camY;
    const dz = cloud.z[i] - camZ;
    const distSq = dx * dx + dy * dy + dz * dz;

    // LOD decimation based on distance
    let keep: boolean;
    if (distSq < 10000) {
      // near: < 100 units
      keep = true;
    } else if (distSq < 62500) {
      // mid: 100-250 units
      keep = (i & 3) === 0; // every 4th
    } else {
      // far: > 250 units
      keep = (i & 15) === 0; // every 16th
    }

    if (keep) {
      const off = writeIdx * 3;
      posArr[off] = cloud.x[i];
      posArr[off + 1] = cloud.y[i];
      posArr[off + 2] = cloud.z[i];
      colArr[off] = cloud.r[i];
      colArr[off + 1] = cloud.g[i];
      colArr[off + 2] = cloud.b[i];
      writeIdx++;
    }
  }

  geometry.setDrawRange(0, writeIdx);
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;

  statRendered.textContent = `${writeIdx.toLocaleString()} / ${pointCount.toLocaleString()} (LOD)`;
}

// ── Hover: vizcrush kNN vs brute force ──
let hoverCount = 0;
let lastBruteMs = 0;

function handleHover(e: MouseEvent) {
  if (mode !== "hover" || !octree || !cloud) return;

  // Throttle: only process every 3rd mousemove for performance
  hoverCount++;
  if (hoverCount % 3 !== 0) return;

  const rect = container.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const target = raycaster.ray.origin
    .clone()
    .add(raycaster.ray.direction.clone().multiplyScalar(camera.position.length()));

  // vizcrush kNN — find 10 nearest to the target
  const t0 = performance.now();
  const nearest = queryNearest3d(octree, target.x, target.y, target.z, 10);
  const knnMs = performance.now() - t0;
  statKnn.textContent = `${knnMs.toFixed(2)}ms`;
  statKnn.className = "stat-value fast";

  // Brute force: only run every 30th hover to avoid killing FPS
  // This is just for comparison display — not needed for the feature
  if (hoverCount % 30 === 0) {
    const t1 = performance.now();
    const bfDists: { d: number; i: number }[] = [];
    for (let i = 0; i < pointCount; i++) {
      const dx = cloud.x[i] - target.x;
      const dy = cloud.y[i] - target.y;
      const dz = cloud.z[i] - target.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (bfDists.length < 10 || d < bfDists[bfDists.length - 1].d) {
        bfDists.push({ d, i });
        bfDists.sort((a, b) => a.d - b.d);
        if (bfDists.length > 10) bfDists.length = 10;
      }
    }
    lastBruteMs = performance.now() - t1;
    statBrute.textContent = `${lastBruteMs.toFixed(2)}ms`;
  }

  if (nearest.length === 0) {
    tooltip.style.display = "none";
    highlightSphere.visible = false;
    neighborGroup.children.forEach((c) => (c.visible = false));
    return;
  }

  const idx = nearest[0];
  const px = cloud.x[idx],
    py = cloud.y[idx],
    pz = cloud.z[idx];
  const dx = px - target.x,
    dy = py - target.y,
    dz = pz - target.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Highlight nearest
  highlightSphere.position.set(px, py, pz);
  highlightSphere.visible = true;

  // Show k neighbors
  for (let i = 0; i < 10; i++) {
    const child = neighborGroup.children[i];
    if (i < nearest.length) {
      const ni = nearest[i];
      child.position.set(cloud.x[ni], cloud.y[ni], cloud.z[ni]);
      child.visible = true;
    } else {
      child.visible = false;
    }
  }

  // Tooltip
  document.getElementById("tt-idx")!.textContent = String(idx);
  document.getElementById("tt-pos")!.textContent =
    `${px.toFixed(1)}, ${py.toFixed(1)}, ${pz.toFixed(1)}`;
  document.getElementById("tt-dist")!.textContent = dist.toFixed(2);
  document.getElementById("tt-k")!.textContent = `${nearest.length} found`;
  document.getElementById("tt-time")!.textContent =
    `vizcrush: ${knnMs.toFixed(2)}ms | Brute force: ${lastBruteMs.toFixed(2)}ms | ${(lastBruteMs / Math.max(0.01, knnMs)).toFixed(0)}x faster`;
  tooltip.style.display = "block";
  tooltip.style.left = `${e.clientX - container.getBoundingClientRect().left + 15}px`;
  tooltip.style.top = `${e.clientY - container.getBoundingClientRect().top - 10}px`;
}

// ── Box Selection: vizcrush range query ──
function startSelect(e: MouseEvent) {
  if (mode !== "select") return;
  isSelecting = true;
  selStart = { x: e.clientX, y: e.clientY };
  controls.enabled = false;

  selBox = document.createElement("div");
  selBox.style.cssText =
    "position:absolute;border:2px solid #8b5cf6;background:rgba(139,92,246,0.1);pointer-events:none;z-index:5;";
  container.appendChild(selBox);
}

function updateSelect(e: MouseEvent) {
  if (!isSelecting || !selBox) return;
  const rect = container.getBoundingClientRect();
  const x1 = Math.min(selStart.x, e.clientX) - rect.left;
  const y1 = Math.min(selStart.y, e.clientY) - rect.top;
  const w = Math.abs(e.clientX - selStart.x);
  const h = Math.abs(e.clientY - selStart.y);
  selBox.style.left = `${x1}px`;
  selBox.style.top = `${y1}px`;
  selBox.style.width = `${w}px`;
  selBox.style.height = `${h}px`;
}

function endSelect(e: MouseEvent) {
  if (!isSelecting || !octree) return;
  isSelecting = false;
  controls.enabled = true;
  if (selBox) {
    selBox.remove();
    selBox = null;
  }

  const rect = container.getBoundingClientRect();
  const x1 = ((Math.min(selStart.x, e.clientX) - rect.left) / rect.width) * 2 - 1;
  const x2 = ((Math.max(selStart.x, e.clientX) - rect.left) / rect.width) * 2 - 1;
  const y1 = -(((Math.max(selStart.y, e.clientY) - rect.top) / rect.height) * 2 - 1);
  const y2 = -(((Math.min(selStart.y, e.clientY) - rect.top) / rect.height) * 2 - 1);

  // Unproject corners to 3D bounding box
  const corners = [
    new THREE.Vector3(x1, y1, 0.5).unproject(camera),
    new THREE.Vector3(x2, y2, 0.5).unproject(camera),
    new THREE.Vector3(x1, y2, 0.5).unproject(camera),
    new THREE.Vector3(x2, y1, 0.5).unproject(camera),
  ];

  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity,
    zMin = Infinity,
    zMax = -Infinity;
  for (const c of corners) {
    if (c.x < xMin) xMin = c.x;
    if (c.x > xMax) xMax = c.x;
    if (c.y < yMin) yMin = c.y;
    if (c.y > yMax) yMax = c.y;
    if (c.z < zMin) zMin = c.z;
    if (c.z > zMax) zMax = c.z;
  }

  // Expand box a bit for better results
  const pad = 30;
  xMin -= pad;
  xMax += pad;
  yMin -= pad;
  yMax += pad;
  zMin -= pad;
  zMax += pad;

  // vizcrush range query
  const t0 = performance.now();
  const selected = queryRange3d(octree, { xMin, xMax, yMin, yMax, zMin, zMax });
  const queryMs = performance.now() - t0;
  statSelection.textContent = `${selected.length.toLocaleString()} pts in ${queryMs.toFixed(2)}ms`;

  // Brute force comparison
  const t1 = performance.now();
  let bfCount = 0;
  for (let i = 0; i < pointCount; i++) {
    if (
      cloud.x[i] >= xMin &&
      cloud.x[i] <= xMax &&
      cloud.y[i] >= yMin &&
      cloud.y[i] <= yMax &&
      cloud.z[i] >= zMin &&
      cloud.z[i] <= zMax
    )
      bfCount++;
  }
  const bfMs = performance.now() - t1;

  // Highlight selected points
  highlightedIndices.clear();
  const maxHighlight = Math.min(selected.length, 100_000);
  for (let i = 0; i < maxHighlight; i++) {
    const idx = selected[i];
    selPosArr[i * 3] = cloud.x[idx];
    selPosArr[i * 3 + 1] = cloud.y[idx];
    selPosArr[i * 3 + 2] = cloud.z[idx];
    highlightedIndices.add(idx);
  }
  selGeometry.setDrawRange(0, maxHighlight);
  selPosAttr.needsUpdate = true;
  selMesh.visible = maxHighlight > 0;

  // Show selection info
  const selContent = document.getElementById("sel-content")!;
  selContent.innerHTML = `
    <div style="margin:4px 0;color:#e0e0e8">${selected.length.toLocaleString()} points selected</div>
    <div style="font-size:10px;color:#34d399">vizcrush: ${queryMs.toFixed(2)}ms</div>
    <div style="font-size:10px;color:#f87171">Brute force: ${bfMs.toFixed(2)}ms</div>
    <div style="font-size:10px;color:#a5b4fc;margin-top:4px">${(bfMs / Math.max(0.01, queryMs)).toFixed(0)}x faster with octree</div>
  `;
  selectionInfo.style.display = "block";
}

// ── Event listeners ──
// Decouple hover from mousemove: store latest mouse position,
// process kNN in rAF idle time instead of blocking every mousemove
let pendingHover: MouseEvent | null = null;
let hoverRafId = 0;

container.addEventListener("mousemove", (e) => {
  if (mode === "hover") {
    // Just store the event — don't process immediately
    pendingHover = e;
    // Schedule processing on next idle frame (deduplicates rapid moves)
    if (!hoverRafId) {
      hoverRafId = requestAnimationFrame(() => {
        hoverRafId = 0;
        if (pendingHover) {
          handleHover(pendingHover);
          pendingHover = null;
        }
      });
    }
  }
  if (mode === "select") updateSelect(e);
});

container.addEventListener("mousedown", (e) => {
  if (mode === "select" && e.button === 0) startSelect(e);
});

container.addEventListener("mouseup", (e) => {
  if (mode === "select") endSelect(e);
});

container.addEventListener("mouseleave", () => {
  tooltip.style.display = "none";
  highlightSphere.visible = false;
  neighborGroup.children.forEach((c) => (c.visible = false));
});

// Mode buttons
document.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.action as "hover" | "select";
    document
      .querySelectorAll<HTMLButtonElement>("button[data-action]")
      .forEach((b) => b.classList.toggle("active", b.dataset.action === mode));

    tooltip.style.display = "none";
    selectionInfo.style.display = "none";
    selMesh.visible = false;
    highlightSphere.visible = false;
    neighborGroup.children.forEach((c) => (c.visible = false));

    container.style.cursor = mode === "hover" ? "crosshair" : "crosshair";
    modeHint.textContent =
      mode === "hover"
        ? "Hover over points — vizcrush finds nearest in <1ms via octree kNN"
        : "Click and drag to box-select — vizcrush range query finds points instantly";
  });
});

// Point count buttons
document.querySelectorAll<HTMLButtonElement>("button[data-count]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const n = Number(btn.dataset.count);
    if (n && n !== pointCount) rebuild(n);
  });
});

// Resize
window.addEventListener("resize", () => {
  const w = container.clientWidth,
    h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ── Animate ──
let lastCamX = 0,
  lastCamY = 0,
  lastCamZ = 0;
let lodFrameSkip = 0;

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // Update LOD when camera moves (check every 5 frames to avoid overhead)
  lodFrameSkip++;
  if (lodFrameSkip >= 5) {
    lodFrameSkip = 0;
    const cx = camera.position.x,
      cy = camera.position.y,
      cz = camera.position.z;
    const moved = Math.abs(cx - lastCamX) + Math.abs(cy - lastCamY) + Math.abs(cz - lastCamZ);
    if (moved > 2) {
      updateLOD();
      lastCamX = cx;
      lastCamY = cy;
      lastCamZ = cz;
    }
  }

  renderer.render(scene, camera);

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    statFps.textContent = String(Math.round((frameCount * 1000) / (now - lastFpsTime)));
    frameCount = 0;
    lastFpsTime = now;
  }
}

// ── Bootstrap ──
async function bootstrap() {
  const gpu = await init();
  statBackend.textContent = gpu.backend;
  await rebuild(pointCount);
  animate();
}

bootstrap();
