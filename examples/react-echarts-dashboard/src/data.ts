const POINT_COUNT = 1_000_000;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

export function makeSeries(): { x: Float64Array; y: Float64Array } {
  const next = random(42);
  const x = new Float64Array(POINT_COUNT);
  const y = new Float64Array(POINT_COUNT);

  for (let i = 0; i < POINT_COUNT; i += 1) {
    x[i] = i;
    const trend = i / POINT_COUNT;
    y[i] = Math.sin(i / 8_000) * 18 + Math.sin(i / 770) * 4 + trend * 12 + (next() - 0.5) * 3;
  }

  return { x, y };
}
