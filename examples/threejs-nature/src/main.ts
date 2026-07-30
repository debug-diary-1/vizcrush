import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { bin2d } from "@vizcrush/bin";
import { buildHashGrid, hashGridQueryRadius } from "@vizcrush/spatial";
import { StreamingStats } from "@vizcrush/aggregate";

// Configuration
let BIRD_COUNT = 50,
  WATER_COUNT = 500,
  TERRAIN_RES = 128,
  timeOfDay = 12;

// vizcrush call counters (per frame)
let vcBin2d = 0,
  vcHashGrid = 0,
  vcStats = 0;

// HUD elements
const hudFps = document.getElementById("hud-fps")!;
const hudFrame = document.getElementById("hud-frame")!;
const hudParticles = document.getElementById("hud-particles")!;
const hudBirds = document.getElementById("hud-birds")!;
const hudCompute = document.getElementById("hud-compute")!;

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const controls = new OrbitControls(camera, canvas);
camera.position.set(35, 22, 45);
controls.target.set(0, 4, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI * 0.48;
controls.update();

//Auto-orbit ──
let autoOrbit = true;
let idleTimer = 0;
controls.addEventListener("start", () => {
  autoOrbit = false;
  idleTimer = 0;
});

//Lighting ──
const sun = new THREE.DirectionalLight(0xffeedd, 1.5);
sun.position.set(50, 80, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 200;
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
scene.add(sun);

const ambient = new THREE.AmbientLight(0x334466, 0.5);
scene.add(ambient);

const hemiLight = new THREE.HemisphereLight(0x88bbff, 0x445522, 0.4);
scene.add(hemiLight);

scene.fog = new THREE.FogExp2(0x88aacc, 0.004);
scene.background = new THREE.Color(0x88aacc);

const skyBounce = new THREE.HemisphereLight(0x6699cc, 0x334422, 0.25);
scene.add(skyBounce);

// Terrain height function
function terrainHeight(x: number, y: number): number {
  let h = 0;
  h += Math.sin(x * 3.14) * Math.cos(y * 2.7) * 0.5;
  h += Math.sin(x * 7.0 + 1.3) * Math.cos(y * 6.5) * 0.25;
  h += Math.sin(x * 15.0 + 3.7) * Math.cos(y * 13.0) * 0.1;
  return Math.max(0, h + 0.3);
}

//Terrain color by height (smooth interpolation) ──
function terrainColor(height: number, maxH: number): THREE.Color {
  const t = maxH > 0 ? height / maxH : 0;
  if (t < 0.3) {
    return new THREE.Color().lerpColors(
      new THREE.Color(0x2d5a1e),
      new THREE.Color(0x4a8a2e),
      t / 0.3,
    );
  } else if (t < 0.6) {
    return new THREE.Color().lerpColors(
      new THREE.Color(0x4a8a2e),
      new THREE.Color(0x8b7355),
      (t - 0.3) / 0.3,
    );
  } else if (t < 0.8) {
    return new THREE.Color().lerpColors(
      new THREE.Color(0x8b7355),
      new THREE.Color(0x999999),
      (t - 0.6) / 0.2,
    );
  } else {
    return new THREE.Color().lerpColors(
      new THREE.Color(0x999999),
      new THREE.Color(0xeeeeff),
      (t - 0.8) / 0.2,
    );
  }
}

//Build terrain using vizcrush bin2d ──
let terrainMesh: THREE.Mesh | null = null;

async function buildTerrain() {
  const res = TERRAIN_RES;

  // Generate elevation samples — vizcrush bin2d aggregates them into a grid
  const N = 10000;
  const sampleX = new Float64Array(N);
  const sampleY = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    sampleX[i] = Math.random();
    sampleY[i] = Math.random();
  }

  const heightmap = await bin2d(sampleX, sampleY, { xBins: res, yBins: res });
  vcBin2d++;

  // Build PlaneGeometry, displace vertices
  const geo = new THREE.PlaneGeometry(100, 100, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  let maxH = 0;

  for (let i = 0; i < pos.count; i++) {
    const xi = i % res;
    const yi = Math.floor(i / res);
    const nx = xi / (res - 1);
    const ny = yi / (res - 1);

    // Blend bin2d density with procedural noise for natural terrain
    const binVal = heightmap.maxCount > 0 ? heightmap.grid[yi * res + xi] / heightmap.maxCount : 0;
    const procH = terrainHeight(nx, ny);
    const h = (procH * 0.8 + binVal * 0.2) * 10; // reduced height scale

    pos.setY(i, h);
    if (h > maxH) maxH = h;
  }

  // 3x3 averaging pass to smooth out spiky terrain
  const smoothed = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const xi = i % res;
    const yi = Math.floor(i / res);
    let sum = 0;
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx2 = xi + dx;
        const ny2 = yi + dy;
        if (nx2 >= 0 && nx2 < res && ny2 >= 0 && ny2 < res) {
          sum += pos.getY(ny2 * res + nx2);
          count++;
        }
      }
    }
    smoothed[i] = sum / count;
  }
  // Apply smoothed heights and recalculate maxH
  maxH = 0;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, smoothed[i]);
    if (smoothed[i] > maxH) maxH = smoothed[i];
  }

  // Vertex colors based on height (smooth interpolation)
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    const c = terrainColor(h, maxH);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals(); // AFTER smoothing for correct lighting

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: false,
  });

  if (terrainMesh) scene.remove(terrainMesh);
  terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  scene.add(terrainMesh);
}

//Sky dome ──
function buildSky() {
  const skyGeo = new THREE.SphereGeometry(200, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x1a3a6a) },
      bottomColor: { value: new THREE.Color(0x88aacc) },
      sunColor: { value: new THREE.Color(0xffeedd) },
      sunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      varying vec3 vWorldPos;
      void main() {
        vec3 dir = normalize(vWorldPos);
        float t = max(0.0, dir.y);
        vec3 sky = mix(bottomColor, topColor, pow(t, 0.5));
        float sunDot = max(0.0, dot(dir, sunDir));
        sky += sunColor * pow(sunDot, 64.0) * 0.6;
        sky += sunColor * pow(sunDot, 8.0) * 0.15;
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  return skyMat;
}
const skyMat = buildSky();

//Sun sprite ──
const sunSprite = new THREE.Sprite(
  new THREE.SpriteMaterial({ color: 0xffffee, transparent: true, opacity: 0.8 }),
);
sunSprite.scale.set(10, 10, 1);
sunSprite.position.copy(sun.position).normalize().multiplyScalar(180);
scene.add(sunSprite);

//Water surface ──
function buildWaterSurface() {
  const waterGeo = new THREE.PlaneGeometry(100, 100, 32, 32);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1a4a6a,
    transparent: true,
    opacity: 0.6,
    roughness: 0.1,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.set(0, 2, 0); // just above the lowest terrain
  waterMesh.receiveShadow = true;
  scene.add(waterMesh);
  return waterMesh;
}
const waterSurface = buildWaterSurface();

//Waterfall particles ──
let waterParticles: {
  positions: Float64Array;
  velocities: Float64Array;
  lifetimes: Float32Array;
  count: number;
  mesh: THREE.Points;
};

function initWaterParticles(count: number) {
  if (waterParticles) scene.remove(waterParticles.mesh);

  const positions = new Float64Array(count * 3);
  const velocities = new Float64Array(count * 3);
  const lifetimes = new Float32Array(count);

  // Waterfall source: front face of the boulder cluster, clearly visible
  const cliffX = 5,
    cliffY = 10,
    cliffZ = -2;

  for (let i = 0; i < count; i++) {
    spawnWaterParticle(positions, velocities, lifetimes, i, cliffX, cliffY, cliffZ);
  }

  const geo = new THREE.BufferGeometry();
  const posF32 = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) posF32[i] = positions[i];
  geo.setAttribute("position", new THREE.BufferAttribute(posF32, 3));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(0xaaddff) },
    },
    vertexShader: `
      varying float vAlpha;
      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(6.0, 400.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;
        vAlpha = 1.0;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float a = (1.0 - d * d) * 0.8;
        vec3 col = mix(uColor, vec3(1.0), 0.5 * (1.0 - d));
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  const mesh = new THREE.Points(geo, mat);
  scene.add(mesh);

  waterParticles = { positions, velocities, lifetimes, count, mesh };
}

function spawnWaterParticle(
  pos: Float64Array,
  vel: Float64Array,
  life: Float32Array,
  i: number,
  cx: number,
  cy: number,
  cz: number,
) {
  // Spawn on the front face of the rocks, flowing outward and down
  pos[i * 3] = cx + (Math.random() - 0.5) * 2.0;
  pos[i * 3 + 1] = cy - Math.random() * 1.0; // slightly below the lip
  pos[i * 3 + 2] = cz + 1.0 + Math.random() * 0.5; // in front of rocks
  vel[i * 3] = (Math.random() - 0.5) * 0.5;
  vel[i * 3 + 1] = -0.5 - Math.random() * 1.5; // gentle downward
  vel[i * 3 + 2] = 1.0 + Math.random() * 2.0; // strong outward push
  life[i] = 2.0 + Math.random() * 3;
}

function updateWater(dt: number) {
  if (!waterParticles) return;
  const { positions, velocities, lifetimes, count, mesh } = waterParticles;
  const posAttr = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const gravity = -5.0; // slower gravity for a visible waterfall arc
  const cliffX = 5,
    cliffY = 10,
    cliffZ = -2;

  for (let i = 0; i < count; i++) {
    // Apply gravity
    velocities[i * 3 + 1] += gravity * dt;

    // Update position
    positions[i * 3] += velocities[i * 3] * dt;
    positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
    positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;

    lifetimes[i] -= dt;

    // Respawn if below ground or expired — add splash at base
    if (positions[i * 3 + 1] < 1.5 || lifetimes[i] <= 0) {
      // 30% chance to spawn as splash particle (spreads horizontally at base)
      if (positions[i * 3 + 1] < 1.5 && Math.random() < 0.3) {
        positions[i * 3] = cliffX + (Math.random() - 0.5) * 5;
        positions[i * 3 + 1] = 1.5 + Math.random() * 0.5;
        positions[i * 3 + 2] = cliffZ + (Math.random() - 0.5) * 5;
        velocities[i * 3] = (Math.random() - 0.5) * 3;
        velocities[i * 3 + 1] = Math.random() * 2;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 3;
        lifetimes[i] = 0.5 + Math.random() * 1.0;
      } else {
        spawnWaterParticle(positions, velocities, lifetimes, i, cliffX, cliffY, cliffZ);
      }
    }

    // Write to render buffer
    posAttr.setXYZ(i, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  }
  posAttr.needsUpdate = true;
}

//Bird flock (Boids with vizcrush SpatialHashGrid) ──
interface Bird {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

let birds: Bird[] = [];
let birdMesh: THREE.InstancedMesh | null = null;
const birdDummy = new THREE.Object3D();
const NEIGHBOR_RADIUS = 8;

function initBirds(count: number) {
  if (birdMesh) scene.remove(birdMesh);
  birds = [];

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * 20;
    birds.push({
      x: Math.cos(angle) * r,
      y: 20 + Math.random() * 10,
      z: Math.sin(angle) * r,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 0.5,
      vz: (Math.random() - 0.5) * 4,
    });
  }

  // Bird silhouette: V-shaped wings with body
  const birdGeo = new THREE.BufferGeometry();
  const birdVerts = new Float32Array([
    // Body (narrow triangle pointing forward)
    0, 0, 0.6, -0.15, 0.05, -0.4, 0.15, 0.05, -0.4,
    // Left wing (angled up slightly for gliding look)
    0, 0.05, 0, -1.5, 0.2, -0.2, -0.3, 0.05, -0.15,
    // Right wing
    0, 0.05, 0, 0.3, 0.05, -0.15, 1.5, 0.2, -0.2,
    // Left wing tip (tapered)
    -1.5, 0.2, -0.2, -1.8, 0.3, -0.5, -0.3, 0.05, -0.15,
    // Right wing tip (tapered)
    0.3, 0.05, -0.15, 1.8, 0.3, -0.5, 1.5, 0.2, -0.2,
  ]);
  birdGeo.setAttribute("position", new THREE.BufferAttribute(birdVerts, 3));
  birdGeo.computeVertexNormals();
  const birdMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  birdMesh = new THREE.InstancedMesh(birdGeo, birdMat, count);
  birdMesh.castShadow = true;
  scene.add(birdMesh);

  // Initial matrix
  for (let i = 0; i < count; i++) {
    birdDummy.position.set(birds[i].x, birds[i].y, birds[i].z);
    birdDummy.updateMatrix();
    birdMesh.setMatrixAt(i, birdDummy.matrix);
  }
  birdMesh.instanceMatrix.needsUpdate = true;
}

async function updateBoids(dt: number) {
  if (!birds.length || !birdMesh) return;

  const n = birds.length;

  // vizcrush: build spatial hash grid for neighbor queries
  const bx = new Float64Array(n);
  const bz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    bx[i] = birds[i].x;
    bz[i] = birds[i].z;
  }

  const grid = await buildHashGrid(bx, bz, NEIGHBOR_RADIUS);
  vcHashGrid++;

  // Boids forces
  const sep = 1.8,
    ali = 1.0,
    coh = 0.8;
  const maxSpeed = 10;
  const centerForce = 0.3;

  for (let i = 0; i < n; i++) {
    const neighbors = hashGridQueryRadius(grid, birds[i].x, birds[i].z, NEIGHBOR_RADIUS);
    vcHashGrid++;

    let sepX = 0,
      sepY = 0,
      sepZ = 0;
    let aliVx = 0,
      aliVy = 0,
      aliVz = 0;
    let cohX = 0,
      cohY = 0,
      cohZ = 0;
    let nCount = 0;
    for (const idx of neighbors) {
      if (idx === i) continue;
      const b = birds[idx];
      const dx = birds[i].x - b.x,
        dy = birds[i].y - b.y,
        dz = birds[i].z - b.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 0 && dist < NEIGHBOR_RADIUS) {
        const w = 1 / (dist * dist + 0.1); // separation weight
        sepX += dx * w;
        sepY += dy * w;
        sepZ += dz * w;
        aliVx += b.vx;
        aliVy += b.vy;
        aliVz += b.vz;
        cohX += b.x;
        cohY += b.y;
        cohZ += b.z;
        nCount++;
      }
    }
    if (nCount > 0) {
      aliVx /= nCount;
      aliVy /= nCount;
      aliVz /= nCount;
      cohX = cohX / nCount - birds[i].x;
      cohY = cohY / nCount - birds[i].y;
      cohZ = cohZ / nCount - birds[i].z;
    }
    // Apply boid forces + center attraction + altitude correction
    const bi = birds[i];
    bi.vx += (sepX * sep + (aliVx - bi.vx) * ali + cohX * coh) * dt - bi.x * centerForce * dt;
    bi.vy += (sepY * sep + (aliVy - bi.vy) * ali + cohY * coh) * dt + (22 - bi.y) * 0.5 * dt;
    bi.vz += (sepZ * sep + (aliVz - bi.vz) * ali + cohZ * coh) * dt - bi.z * centerForce * dt;
    const speed = Math.sqrt(bi.vx ** 2 + bi.vy ** 2 + bi.vz ** 2);
    if (speed > maxSpeed) {
      const s = maxSpeed / speed;
      bi.vx *= s;
      bi.vy *= s;
      bi.vz *= s;
    }
    bi.x += bi.vx * dt;
    bi.y += bi.vy * dt;
    bi.z += bi.vz * dt;
    birdDummy.position.set(bi.x, bi.y, bi.z);
    birdDummy.lookAt(bi.x + bi.vx, bi.y + bi.vy, bi.z + bi.vz);
    // Banking: tilt based on lateral acceleration (turn rate)
    const lateralTurn = Math.atan2(bi.vx, bi.vz);
    birdDummy.rotation.z = lateralTurn * 0.3;
    birdDummy.updateMatrix();
    birdMesh!.setMatrixAt(i, birdDummy.matrix);
  }

  birdMesh.instanceMatrix.needsUpdate = true;
}

//Animate water surface ──
function animateWaterSurface(t: number) {
  const geo = waterSurface.geometry;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = Math.sin(x * 0.3 + t) * 0.15 + Math.cos(z * 0.4 + t * 0.7) * 0.1;
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

//Time of day ──
function applyTimeOfDay(hour: number) {
  const t = hour / 24;
  // Sun angle
  const angle = (t - 0.25) * Math.PI * 2;
  sun.position.set(Math.cos(angle) * 80, Math.sin(angle) * 80, 30);
  sunSprite.position.copy(sun.position).normalize().multiplyScalar(180);

  // Intensity
  const elevation = Math.sin(angle);
  const intensity = Math.max(0.1, elevation) * 2.0;
  sun.intensity = intensity;

  // Sky colors based on time
  let fogColor: THREE.Color;
  let skyTop: THREE.Color;
  let skyBottom: THREE.Color;

  if (hour < 6 || hour > 20) {
    // Night
    fogColor = new THREE.Color(0x0a0a1a);
    skyTop = new THREE.Color(0x050510);
    skyBottom = new THREE.Color(0x0a0a20);
    ambient.intensity = 0.15;
  } else if (hour < 8 || hour > 18) {
    // Golden hour
    fogColor = new THREE.Color(0xcc8855);
    skyTop = new THREE.Color(0x2a2040);
    skyBottom = new THREE.Color(0xdd9955);
    ambient.intensity = 0.35;
  } else {
    // Day
    fogColor = new THREE.Color(0x88aacc);
    skyTop = new THREE.Color(0x1a3a6a);
    skyBottom = new THREE.Color(0x88aacc);
    ambient.intensity = 0.5;
  }

  (scene.fog as THREE.FogExp2).color.copy(fogColor);
  scene.background = fogColor;
  skyMat.uniforms.topColor.value.copy(skyTop);
  skyMat.uniforms.bottomColor.value.copy(skyBottom);
  skyMat.uniforms.sunDir.value.copy(sun.position).normalize();
}

//Create a tree group (trunk + layered canopy) ──
function createTree(x: number, y: number, z: number, scale: number): THREE.Group {
  const group = new THREE.Group();

  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(0.1 * scale, 0.15 * scale, 1.5 * scale, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.75 * scale;
  trunk.castShadow = true;
  group.add(trunk);

  // Canopy (3 stacked cones for pine tree look)
  const canopyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(
      0.28 + Math.random() * 0.08,
      0.6 + Math.random() * 0.2,
      0.15 + Math.random() * 0.1,
    ),
    roughness: 0.8,
  });
  for (let i = 0; i < 3; i++) {
    const r = (1.2 - i * 0.3) * scale;
    const h = (1.5 - i * 0.3) * scale;
    const canopyGeo = new THREE.ConeGeometry(r, h, 7);
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = (1.5 + i * 0.8) * scale;
    canopy.castShadow = true;
    group.add(canopy);
  }

  group.position.set(x, y, z);
  return group;
}

//Scatter trees and rocks ──
function addVegetation() {
  // Tree line: only place trees below 60% of max terrain height
  const maxTerrainH = 10; // approximate max after smoothing
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() - 0.5) * 80,
      z = (Math.random() - 0.5) * 80;
    const h = terrainHeight((x + 50) / 100, (z + 50) / 100) * 10;
    if (h > maxTerrainH * 0.6 || h < 0.5) continue;
    const s = 0.5 + Math.random() * 1.0; // vary tree sizes
    const tree = createTree(x, h, z, s);
    scene.add(tree);
  }
  // Natural boulder cluster at waterfall source — stacked rocks, not a tower
  const cliffMat = new THREE.MeshStandardMaterial({ color: 0x7a7a72, roughness: 0.95 });
  const boulders = [
    // Large base boulders forming a natural ridge
    { x: 4, y: 6, z: -5, sx: 4, sy: 3, sz: 3.5 },
    { x: 7, y: 5.5, z: -6, sx: 3.5, sy: 2.8, sz: 3 },
    { x: 3, y: 5, z: -7, sx: 3, sy: 2.5, sz: 4 },
    { x: 6, y: 7, z: -4, sx: 2.5, sy: 2, sz: 2.5 },
    // Mid-level rocks
    { x: 5, y: 8.5, z: -5.5, sx: 2.5, sy: 2, sz: 2 },
    { x: 4.5, y: 9, z: -4.5, sx: 2, sy: 1.5, sz: 2 },
    // Top rocks where water emerges
    { x: 5, y: 10.5, z: -5, sx: 2, sy: 1.2, sz: 1.8 },
    { x: 5.5, y: 10, z: -4, sx: 1.5, sy: 1, sz: 1.5 },
  ];
  for (const b of boulders) {
    const geo = new THREE.DodecahedronGeometry(1, 1);
    const mesh = new THREE.Mesh(geo, cliffMat);
    mesh.position.set(b.x, b.y, b.z);
    mesh.scale.set(b.sx, b.sy, b.sz);
    mesh.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.3);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Scattered smaller rocks around the base (splash zone)
  const rockGeo = new THREE.DodecahedronGeometry(0.6, 1);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x666660, roughness: 0.95 });
  for (let i = 0; i < 25; i++) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const angle = Math.random() * Math.PI * 2;
    const dist = 2 + Math.random() * 5;
    rock.position.set(
      5 + Math.cos(angle) * dist,
      1.5 + Math.random() * 0.5,
      -5 + Math.sin(angle) * dist,
    );
    rock.scale.set(0.4 + Math.random() * 1.0, 0.3 + Math.random() * 0.5, 0.4 + Math.random() * 1.0);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }
}

//Stats tracking (vizcrush StreamingStats) ──
const fpsTracker = new StreamingStats(120);
const frameTracker = new StreamingStats(120);

function updateHUD(dt: number) {
  const fps = dt > 0 ? 1 / dt : 0;
  fpsTracker.push(fps);
  frameTracker.push(dt * 1000);
  vcStats += 2;

  hudFps.textContent = fpsTracker.mean.toFixed(0);
  hudFrame.textContent = `${frameTracker.mean.toFixed(1)}ms`;
  hudParticles.textContent = waterParticles ? String(waterParticles.count) : "0";
  hudBirds.textContent = String(birds.length);
}

//Controls wiring ──
function wireButtons(attr: string, cb: (val: number) => void) {
  document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      cb(parseInt(btn.dataset[attr]!, 10));
    });
  });
}

function setupControls() {
  wireButtons("birds", (v) => {
    BIRD_COUNT = v;
    initBirds(v);
  });
  wireButtons("water", (v) => {
    WATER_COUNT = v;
    initWaterParticles(v);
  });
  wireButtons("terrain", (v) => {
    TERRAIN_RES = v;
    buildTerrain();
  });

  const todSlider = document.getElementById("tod-slider") as HTMLInputElement;
  const todVal = document.getElementById("tod-val")!;
  todSlider.addEventListener("input", () => {
    timeOfDay = parseFloat(todSlider.value);
    const h = Math.floor(timeOfDay),
      m = Math.round((timeOfDay - h) * 60);
    todVal.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    applyTimeOfDay(timeOfDay);
  });
}

//Resize ──
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

//Render loop ──
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05); // cap delta
  const elapsed = clock.elapsedTime;

  // Show previous frame's vizcrush counters, then reset
  hudCompute.textContent = `bin2d: ${vcBin2d} | hashGrid: ${vcHashGrid} | stats: ${vcStats}`;
  vcHashGrid = 0;
  vcStats = 0;

  // Auto-orbit
  if (autoOrbit) {
    const orbitSpeed = 0.08;
    const angle = elapsed * orbitSpeed;
    const radius = 55;
    camera.position.x = Math.cos(angle) * radius;
    camera.position.z = Math.sin(angle) * radius;
    camera.position.y = 20 + Math.sin(elapsed * 0.1) * 5;
    controls.target.set(0, 5, 0);
  } else {
    idleTimer += dt;
    if (idleTimer > 15) autoOrbit = true; // resume after 15s idle
  }

  controls.update();

  // Update scene elements
  updateBoids(dt);
  updateWater(dt);
  animateWaterSurface(elapsed);
  updateHUD(dt);

  renderer.render(scene, camera);
}

//Initialize ──
async function init() {
  setupControls();
  applyTimeOfDay(timeOfDay);
  await buildTerrain();
  addVegetation();
  initWaterParticles(WATER_COUNT);
  initBirds(BIRD_COUNT);
  animate();
}

init();
