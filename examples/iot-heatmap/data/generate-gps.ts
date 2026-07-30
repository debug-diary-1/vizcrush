/**
 * Node.js script that generates 500K clustered GPS coordinates in the NYC area.
 * Outputs JSON to stdout: { lat, lng, temperature }[]
 *
 * Usage:
 *   npx tsx data/generate-gps.ts > data/gps-data.json
 */

const N = 500_000;

// 5 NYC-area clusters with characteristic base temperatures
const clusters = [
  { lat: 40.7128, lng: -74.006, baseTemp: 72 }, // Lower Manhattan
  { lat: 40.758, lng: -73.9855, baseTemp: 78 }, // Times Square (urban heat island)
  { lat: 40.6892, lng: -74.0445, baseTemp: 65 }, // Liberty Island (water-cooled)
  { lat: 40.7484, lng: -73.9857, baseTemp: 75 }, // Empire State Building area
  { lat: 40.7614, lng: -73.9776, baseTemp: 70 }, // MoMA / Midtown
];

// Box-Muller transform for normal distribution
function randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

interface GpsPoint {
  lat: number;
  lng: number;
  temperature: number;
}

const points: GpsPoint[] = Array.from({ length: N });

for (let i = 0; i < N; i++) {
  // Pick a random cluster (weighted slightly toward denser areas)
  const ci = Math.floor(Math.random() * clusters.length);
  const c = clusters[ci];

  // Spread with Gaussian distribution (~0.008 degrees, roughly 0.5-1 km)
  const latSpread = 0.008;
  const lngSpread = 0.01;

  const lat = c.lat + randn() * latSpread;
  const lng = c.lng + randn() * lngSpread;

  // Temperature: base + gaussian noise + distance-based cooling
  const dist = Math.sqrt((lat - c.lat) ** 2 + (lng - c.lng) ** 2);
  const temperature = c.baseTemp + randn() * 3 - dist * 100;

  points[i] = {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    temperature: Math.round(temperature * 10) / 10,
  };
}

process.stdout.write(JSON.stringify(points));
