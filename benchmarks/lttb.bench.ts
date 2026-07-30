import { lttbSync } from "@vizcrush/downsample";

const SIZES = [100_000, 500_000, 1_000_000, 5_000_000];
const TARGET = 1_000;
const RUNS = 100;

for (const size of SIZES) {
  const x = new Float64Array(size);
  const y = new Float64Array(size);
  let val = 0;
  for (let i = 0; i < size; i++) {
    x[i] = i;
    val += (Math.random() - 0.498) * 10;
    y[i] = val;
  }

  // Warmup
  for (let i = 0; i < 5; i++) lttbSync(x, y, TARGET);

  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    lttbSync(x, y, TARGET);
    times.push(performance.now() - t0);
  }

  times.sort((a, b) => a - b);
  console.log(`LTTB ${size.toLocaleString()} → ${TARGET}:`);
  console.log(`  median: ${times[Math.floor(RUNS / 2)].toFixed(2)}ms`);
  console.log(`  p95:    ${times[Math.floor(RUNS * 0.95)].toFixed(2)}ms`);
  console.log(`  min:    ${times[0].toFixed(2)}ms`);
  console.log(`  backend: js`);
}
