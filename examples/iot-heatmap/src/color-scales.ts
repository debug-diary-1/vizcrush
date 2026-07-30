/**
 * Approximated perceptual color ramps.
 * Each function takes a value t in [0, 1] and returns an RGB CSS string.
 */

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Attempt to approximate the Viridis perceptual colormap.
 * Ramps from dark purple through teal to bright yellow.
 */
export function viridis(t: number): string {
  t = Math.max(0, Math.min(1, t));
  // Piecewise-linear approximation of Viridis
  const r = clamp(68 + t * (253 - 68));
  const g = clamp(1 + t * (231 - 1));
  const b = clamp(84 + (1 - Math.abs(t - 0.5) * 2) * (170 - 84));
  return `rgb(${r},${g},${b})`;
}

/**
 * Approximate the Plasma perceptual colormap.
 * Ramps from dark blue through magenta/pink to bright yellow.
 */
export function plasma(t: number): string {
  t = Math.max(0, Math.min(1, t));
  // Dark blue -> purple -> magenta -> orange -> yellow
  let r: number, g: number, b: number;
  if (t < 0.25) {
    const s = t / 0.25;
    r = clamp(13 + s * (126 - 13));
    g = clamp(8 + s * (3 - 8));
    b = clamp(135 + s * (168 - 135));
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    r = clamp(126 + s * (203 - 126));
    g = clamp(3 + s * (37 - 3));
    b = clamp(168 + s * (121 - 168));
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    r = clamp(203 + s * (248 - 203));
    g = clamp(37 + s * (120 - 37));
    b = clamp(121 + s * (42 - 121));
  } else {
    const s = (t - 0.75) / 0.25;
    r = clamp(248 + s * (240 - 248));
    g = clamp(120 + s * (249 - 120));
    b = clamp(42 + s * (33 - 42));
  }
  return `rgb(${r},${g},${b})`;
}

/**
 * Approximate the Inferno perceptual colormap.
 * Ramps from black through dark red/orange to bright yellow-white.
 */
export function inferno(t: number): string {
  t = Math.max(0, Math.min(1, t));
  let r: number, g: number, b: number;
  if (t < 0.25) {
    const s = t / 0.25;
    r = clamp(0 + s * (87 - 0));
    g = clamp(0 + s * (16 - 0));
    b = clamp(4 + s * (110 - 4));
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    r = clamp(87 + s * (188 - 87));
    g = clamp(16 + s * (55 - 16));
    b = clamp(110 + s * (84 - 110));
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    r = clamp(188 + s * (249 - 188));
    g = clamp(55 + s * (142 - 55));
    b = clamp(84 + s * (9 - 84));
  } else {
    const s = (t - 0.75) / 0.25;
    r = clamp(249 + s * (252 - 249));
    g = clamp(142 + s * (255 - 142));
    b = clamp(9 + s * (164 - 9));
  }
  return `rgb(${r},${g},${b})`;
}
