/**
 * Node.js script that generates synthetic BTC-like candle data.
 * Produces a JSON array of {time, open, high, low, close, volume} objects
 * using a random walk starting at 45000 with volatility spikes.
 *
 * Outputs 2M candles to stdout as JSON.
 *
 * Usage:
 *   node --loader ts-node/esm data/generate-data.ts > data/candles.json
 */

const NUM_CANDLES = 2_000_000;
const START_PRICE = 45_000;
const MIN_PRICE = 10_000;
const MAX_PRICE = 100_000;

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function generate(): Candle[] {
  const candles: Candle[] = Array.from({ length: NUM_CANDLES });
  let price = START_PRICE;

  // Start at 2021-01-01T00:00:00Z, 1-minute candles
  const baseTime = 1609459200;

  for (let i = 0; i < NUM_CANDLES; i++) {
    const open = price;

    // Determine candle volatility — occasional spikes mimic crypto behavior
    const isSpike = Math.random() < 0.003;
    const volatility = isSpike ? 800 + Math.random() * 1200 : 20 + Math.random() * 60;

    // Slight upward drift
    const drift = (Math.random() - 0.498) * volatility * 0.1;

    // Generate intra-candle moves
    const move1 = (Math.random() - 0.5) * volatility;
    const move2 = (Math.random() - 0.5) * volatility;
    const move3 = (Math.random() - 0.5) * volatility;

    const close = clamp(open + drift + move3 * 0.3);
    const high = clamp(Math.max(open, close, open + Math.abs(move1), open + Math.abs(move2)));
    const low = clamp(Math.min(open, close, open - Math.abs(move1), open - Math.abs(move2)));

    // Volume correlates loosely with volatility
    const baseVolume = 0.5 + Math.random() * 2;
    const volume = parseFloat((baseVolume * (isSpike ? 5 + Math.random() * 10 : 1)).toFixed(4));

    candles[i] = {
      time: baseTime + i * 60,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume,
    };

    // Advance price for next candle
    price = close;
  }

  return candles;
}

function clamp(p: number): number {
  return Math.max(MIN_PRICE, Math.min(MAX_PRICE, p));
}

function round(n: number): number {
  return parseFloat(n.toFixed(2));
}

const candles = generate();
process.stdout.write(JSON.stringify(candles));
