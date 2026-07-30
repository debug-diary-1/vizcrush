const SIZES = [100_000, 500_000, 1_000_000];
const RUNS = 20;

for (const size of SIZES) {
  const data = new Float64Array(size);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 1000;

  const times: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const copy = Array.from(data);
    const t0 = performance.now();
    copy.sort((a, b) => a - b);
    times.push(performance.now() - t0);
  }

  times.sort((a, b) => a - b);
  console.log(`sort (Array.sort) ${size.toLocaleString()}:`);
  console.log(`  median: ${times[Math.floor(RUNS / 2)].toFixed(2)}ms`);
  console.log(`  p95:    ${times[Math.floor(RUNS * 0.95)].toFixed(2)}ms`);
  console.log(`  min:    ${times[0].toFixed(2)}ms`);
}
