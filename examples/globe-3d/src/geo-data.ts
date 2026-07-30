/**
 * Geographic data generators for the globe example.
 * All return lat/lng in degrees, altitude in km, value as a generic metric.
 */

export interface GeoDataSet {
  lat: Float64Array;
  lng: Float64Array;
  alt: Float64Array;
  value: Float64Array;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Random float in [lo, hi). */
function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/** Interpolate a great circle arc between two lat/lng pairs. */
function greatCirclePoints(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  steps: number,
  altPeak: number,
): Array<{ lat: number; lng: number; alt: number }> {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const la1 = lat1 * toRad;
  const lo1 = lng1 * toRad;
  const la2 = lat2 * toRad;
  const lo2 = lng2 * toRad;

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((la2 - la1) / 2) ** 2 +
          Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2,
      ),
    );

  const pts: Array<{ lat: number; lng: number; alt: number }> = [];

  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const sinD = Math.sin(d);
    if (sinD < 1e-10) {
      // Degenerate: same point
      pts.push({ lat: lat1, lng: lng1, alt: 0 });
      continue;
    }
    const a = Math.sin((1 - f) * d) / sinD;
    const b = Math.sin(f * d) / sinD;
    const x = a * Math.cos(la1) * Math.cos(lo1) + b * Math.cos(la2) * Math.cos(lo2);
    const y = a * Math.cos(la1) * Math.sin(lo1) + b * Math.cos(la2) * Math.sin(lo2);
    const z = a * Math.sin(la1) + b * Math.sin(la2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg;
    const lng = Math.atan2(y, x) * toDeg;
    // Arc altitude: parabolic peaking at midpoint
    const alt = altPeak * 4 * f * (1 - f);
    pts.push({ lat, lng, alt });
  }

  return pts;
}

/* ------------------------------------------------------------------ */
/*  Major airports (approximate lat/lng)                               */
/* ------------------------------------------------------------------ */
const AIRPORTS: [number, number][] = [
  [40.6, -73.8], // JFK
  [51.5, -0.5], // LHR
  [35.5, 139.8], // NRT
  [25.3, 55.4], // DXB
  [1.4, 104.0], // SIN
  [-33.9, 151.2], // SYD
  [33.9, -118.4], // LAX
  [49.0, 2.6], // CDG
  [22.3, 113.9], // HKG
  [-23.4, -46.5], // GRU
  [55.6, 37.4], // SVO
  [13.7, 100.7], // BKK
  [37.5, 127.0], // ICN
  [28.6, 77.1], // DEL
  [-1.3, 36.9], // NBO
  [41.3, 2.1], // BCN
  [35.8, -5.3], // TNG
  [30.0, 31.4], // CAI
];

/**
 * Generate flight path points along great circle arcs between random airports.
 */
export function generateFlightPaths(n: number): GeoDataSet {
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  const alt = new Float64Array(n);
  const value = new Float64Array(n);

  const pointsPerRoute = 40;
  const numRoutes = Math.ceil(n / pointsPerRoute);
  let idx = 0;

  for (let r = 0; r < numRoutes && idx < n; r++) {
    const a = AIRPORTS[Math.floor(Math.random() * AIRPORTS.length)];
    let b = a;
    while (b === a) {
      b = AIRPORTS[Math.floor(Math.random() * AIRPORTS.length)];
    }

    const altPeak = rand(8, 12); // cruising altitude in km (scaled for vis)
    const pts = greatCirclePoints(a[0], a[1], b[0], b[1], pointsPerRoute, altPeak);

    for (let i = 0; i < pts.length && idx < n; i++) {
      lat[idx] = pts[i].lat;
      lng[idx] = pts[i].lng;
      alt[idx] = pts[i].alt;
      value[idx] = altPeak; // route altitude as value
      idx++;
    }
  }

  return { lat, lng, alt, value };
}

/* ------------------------------------------------------------------ */
/*  Tectonic plate boundary approximations                             */
/* ------------------------------------------------------------------ */

/** Points along the Ring of Fire and Mid-Atlantic Ridge. */
const PLATE_ZONES: Array<{
  latRange: [number, number];
  lngRange: [number, number];
  weight: number;
}> = [
  // Ring of Fire: Pacific Rim
  { latRange: [-45, -35], lngRange: [-75, -70], weight: 1 }, // Chile
  { latRange: [-10, 5], lngRange: [-80, -75], weight: 1 }, // Ecuador/Colombia
  { latRange: [10, 25], lngRange: [-105, -95], weight: 1 }, // Mexico
  { latRange: [30, 55], lngRange: [-130, -120], weight: 1 }, // US West Coast
  { latRange: [50, 62], lngRange: [-170, -145], weight: 1.5 }, // Alaska
  { latRange: [30, 45], lngRange: [130, 145], weight: 1.5 }, // Japan
  { latRange: [5, 20], lngRange: [120, 130], weight: 1 }, // Philippines
  { latRange: [-10, 0], lngRange: [100, 120], weight: 1.2 }, // Indonesia
  { latRange: [-45, -35], lngRange: [165, 180], weight: 1 }, // New Zealand
  // Mid-Atlantic Ridge
  { latRange: [60, 66], lngRange: [-20, -10], weight: 1 }, // Iceland
  { latRange: [30, 45], lngRange: [-35, -25], weight: 0.8 }, // Mid-Atlantic
  { latRange: [0, 15], lngRange: [-30, -20], weight: 0.8 }, // Equatorial Atlantic
  { latRange: [-30, -10], lngRange: [-20, -5], weight: 0.8 }, // South Atlantic
  // Mediterranean / Alpine belt
  { latRange: [35, 42], lngRange: [20, 45], weight: 1 }, // Turkey/Greece
  { latRange: [25, 35], lngRange: [55, 70], weight: 1 }, // Iran/Pakistan
];

/**
 * Generate earthquake points along tectonic plate boundaries.
 * Magnitude encoded as altitude.
 */
export function generateEarthquakes(n: number): GeoDataSet {
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  const alt = new Float64Array(n);
  const value = new Float64Array(n);

  // Weighted random zone selection
  const totalWeight = PLATE_ZONES.reduce((s, z) => s + z.weight, 0);

  for (let i = 0; i < n; i++) {
    let r = Math.random() * totalWeight;
    let zone = PLATE_ZONES[0];
    for (const z of PLATE_ZONES) {
      r -= z.weight;
      if (r <= 0) {
        zone = z;
        break;
      }
    }

    lat[i] = rand(zone.latRange[0], zone.latRange[1]);
    lng[i] = rand(zone.lngRange[0], zone.lngRange[1]);

    // Magnitude 2..9 (Gutenberg-Richter-ish: most are small)
    const mag = 2 + Math.pow(Math.random(), 3) * 7;
    alt[i] = mag * 0.8; // altitude proportional to magnitude
    value[i] = mag;
  }

  return { lat, lng, alt, value };
}

/* ------------------------------------------------------------------ */
/*  Major shipping lanes                                               */
/* ------------------------------------------------------------------ */

const SHIPPING_ROUTES: Array<[[number, number], [number, number]]> = [
  // Trans-Pacific
  [
    [35, 140],
    [34, -118],
  ],
  [
    [22, 114],
    [34, -118],
  ],
  // Trans-Atlantic
  [
    [40, -74],
    [51, 1],
  ],
  [
    [30, -90],
    [43, -9],
  ],
  // Suez route
  [
    [1, 104],
    [30, 32],
  ],
  [
    [30, 32],
    [37, -6],
  ],
  // Cape route
  [
    [1, 104],
    [-34, 18],
  ],
  [
    [-34, 18],
    [-23, -43],
  ],
  // Panama route
  [
    [34, -118],
    [9, -79],
  ],
  [
    [9, -79],
    [40, -74],
  ],
  // Northern Europe
  [
    [51, 1],
    [59, 18],
  ],
  [
    [51, 1],
    [54, 10],
  ],
  // Asia intra
  [
    [35, 140],
    [22, 114],
  ],
  [
    [22, 114],
    [1, 104],
  ],
  [
    [1, 104],
    [13, 80],
  ],
];

/**
 * Generate shipping route points along major trade lanes.
 */
export function generateShippingRoutes(n: number): GeoDataSet {
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  const alt = new Float64Array(n);
  const value = new Float64Array(n);

  const pointsPerRoute = 30;
  const numRoutes = Math.ceil(n / pointsPerRoute);
  let idx = 0;

  for (let r = 0; r < numRoutes && idx < n; r++) {
    const route = SHIPPING_ROUTES[Math.floor(Math.random() * SHIPPING_ROUTES.length)];
    const [a, b] = route;

    // Ships stay near sea level, small arc
    const pts = greatCirclePoints(a[0], a[1], b[0], b[1], pointsPerRoute, 0.5);

    // Add some lateral scatter to simulate different ships
    const scatter = rand(-2, 2);

    for (let i = 0; i < pts.length && idx < n; i++) {
      lat[idx] = pts[i].lat + scatter * Math.cos(i * 0.3);
      lng[idx] = pts[i].lng + scatter * Math.sin(i * 0.3);
      alt[idx] = pts[i].alt;
      value[idx] = rand(10, 50); // cargo tonnage (abstract)
      idx++;
    }
  }

  return { lat, lng, alt, value };
}
