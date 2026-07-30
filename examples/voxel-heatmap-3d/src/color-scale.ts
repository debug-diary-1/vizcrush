/** Viridis-like color ramp with density-mapped alpha. */
export function viridis3d(t: number): { r: number; g: number; b: number; a: number } {
  t = Math.max(0, Math.min(1, t));

  // Viridis key stops: dark purple -> teal -> green -> yellow
  let r: number, g: number, b: number;

  if (t < 0.25) {
    const s = t / 0.25;
    r = lerp(68, 59, s);
    g = lerp(1, 82, s);
    b = lerp(84, 139, s);
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    r = lerp(59, 33, s);
    g = lerp(82, 145, s);
    b = lerp(139, 140, s);
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    r = lerp(33, 94, s);
    g = lerp(145, 201, s);
    b = lerp(140, 98, s);
  } else {
    const s = (t - 0.75) / 0.25;
    r = lerp(94, 253, s);
    g = lerp(201, 231, s);
    b = lerp(98, 37, s);
  }

  // Alpha scales from 0.3 (low density) to 1.0 (high density)
  const a = 0.3 + t * 0.7;

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
}

/** Inferno-like color ramp. */
export function inferno3d(t: number): { r: number; g: number; b: number; a: number } {
  t = Math.max(0, Math.min(1, t));

  let r: number, g: number, b: number;

  if (t < 0.25) {
    const s = t / 0.25;
    r = lerp(0, 40, s);
    g = lerp(0, 11, s);
    b = lerp(4, 84, s);
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    r = lerp(40, 148, s);
    g = lerp(11, 33, s);
    b = lerp(84, 97, s);
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    r = lerp(148, 230, s);
    g = lerp(33, 109, s);
    b = lerp(97, 23, s);
  } else {
    const s = (t - 0.75) / 0.25;
    r = lerp(230, 252, s);
    g = lerp(109, 255, s);
    b = lerp(23, 164, s);
  }

  const a = 0.3 + t * 0.7;
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
}

/** Plasma-like color ramp. */
export function plasma3d(t: number): { r: number; g: number; b: number; a: number } {
  t = Math.max(0, Math.min(1, t));

  let r: number, g: number, b: number;

  if (t < 0.25) {
    const s = t / 0.25;
    r = lerp(13, 84, s);
    g = lerp(8, 2, s);
    b = lerp(135, 163, s);
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    r = lerp(84, 175, s);
    g = lerp(2, 28, s);
    b = lerp(163, 130, s);
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    r = lerp(175, 237, s);
    g = lerp(28, 105, s);
    b = lerp(130, 37, s);
  } else {
    const s = (t - 0.75) / 0.25;
    r = lerp(237, 240, s);
    g = lerp(105, 249, s);
    b = lerp(37, 33, s);
  }

  const a = 0.3 + t * 0.7;
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
}

export type ColorScaleFn = (t: number) => { r: number; g: number; b: number; a: number };

export const COLOR_SCALES: Record<string, ColorScaleFn> = {
  viridis: viridis3d,
  inferno: inferno3d,
  plasma: plasma3d,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
