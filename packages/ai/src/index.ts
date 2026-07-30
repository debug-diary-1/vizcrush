// @vizcrush/ai — AI-native data analysis primitives
// Pure JS implementations. There is no WASM dispatch here — unlike the other
// packages, this one doesn't cross into the `vizcrush-ai` Rust crate at all.
// That crate is a documented placeholder for future SIMD work (see
// docs/developer-guide/packages.md); the JS implementations are the only
// shipped implementation today and are fast enough for current use cases.

// ─── Natural Language Query Parser ───

export interface QueryResult {
  operation: string;
  params: Record<string, any>;
  description: string;
}

export function parseDataQuery(
  query: string,
  _dataInfo: { length: number; hasTimestamps: boolean },
): QueryResult {
  const q = query.toLowerCase().trim();

  // Filter: "show spikes above N" / "filter above N" / "values greater than N"
  const aboveMatch = q.match(
    /(?:above|greater than|over|exceeding|spikes? above)\s+(\d+(?:\.\d+)?)/,
  );
  if (aboveMatch) {
    return {
      operation: "filter",
      params: { min: parseFloat(aboveMatch[1]) },
      description: `Filter values above ${aboveMatch[1]}`,
    };
  }

  // Filter: "below N" / "less than N"
  const belowMatch = q.match(/(?:below|less than|under)\s+(\d+(?:\.\d+)?)/);
  if (belowMatch) {
    return {
      operation: "filter",
      params: { max: parseFloat(belowMatch[1]) },
      description: `Filter values below ${belowMatch[1]}`,
    };
  }

  // Time range: "last hour" / "last N minutes"
  if (/last\s+hour/.test(q)) {
    return {
      operation: "filter",
      params: { timeRange: "last_hour" },
      description: "Filter to last hour",
    };
  }
  const lastMinMatch = q.match(/last\s+(\d+)\s+min/);
  if (lastMinMatch) {
    return {
      operation: "filter",
      params: { timeRange: `last_${lastMinMatch[1]}m` },
      description: `Filter to last ${lastMinMatch[1]} minutes`,
    };
  }

  // Anomaly detection
  if (/anomal|outlier|unusual|abnormal/.test(q)) {
    return {
      operation: "anomaly",
      params: { sensitivity: 3 },
      description: "Detect statistical anomalies",
    };
  }

  // Downsample: "downsample to N points"
  const dsMatch = q.match(/downsample.*?(\d+)/);
  if (dsMatch) {
    return {
      operation: "downsample",
      params: { target: parseInt(dsMatch[1], 10) },
      description: `LTTB downsample to ${dsMatch[1]}`,
    };
  }

  // Trend
  if (/trend|direction|slope|going up|going down/.test(q)) {
    return {
      operation: "summarize",
      params: { focus: "trend" },
      description: "Analyze data trend",
    };
  }

  // Summarize (catch-all for summary-like queries)
  if (/summar|overview|describe|profile|stats/.test(q)) {
    return {
      operation: "summarize",
      params: {},
      description: "Generate data summary",
    };
  }

  // Default fallback
  return {
    operation: "summarize",
    params: {},
    description: "Generate data summary",
  };
}

// ─── Anomaly Detection ───

export interface Anomaly {
  index: number;
  value: number;
  zScore: number;
  type: "spike" | "dip" | "shift";
}

function median(arr: Float64Array): number {
  const sorted = Float64Array.from(arr).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(arr: Float64Array): number {
  const med = median(arr);
  const deviations = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    deviations[i] = Math.abs(arr[i] - med);
  }
  return median(deviations);
}

export function detectAnomalies(data: Float64Array, sensitivity: number = 3): Anomaly[] {
  if (data.length < 5) return [];

  const med = median(data);
  let madVal = mad(data);
  // MAD-based modified Z-score (0.6745 is the 0.75th quantile of the standard normal)
  const k = 0.6745;
  const threshold = sensitivity;

  // If MAD is 0 (e.g. constant data with a few outliers), fall back to mean absolute deviation
  if (madVal === 0) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - med);
    madVal = sum / data.length;
  }

  const anomalies: Anomaly[] = [];

  // For shift detection, compute a running mean over a window
  const windowSize = Math.max(5, Math.floor(data.length / 20));

  for (let i = 0; i < data.length; i++) {
    const modifiedZ = madVal === 0 ? 0 : ((data[i] - med) * k) / madVal;

    if (Math.abs(modifiedZ) > threshold) {
      // Classify: check if it's a sustained shift or a point anomaly
      let isShift = false;
      if (i >= windowSize) {
        // Check if the surrounding window also deviates
        let shiftCount = 0;
        const start = Math.max(0, i - windowSize);
        const end = Math.min(data.length, i + windowSize);
        for (let j = start; j < end; j++) {
          const jz = madVal === 0 ? 0 : ((data[j] - med) * k) / madVal;
          if (Math.abs(jz) > threshold * 0.5) shiftCount++;
        }
        isShift = shiftCount > windowSize;
      }

      let type: "spike" | "dip" | "shift";
      if (isShift) {
        type = "shift";
      } else if (modifiedZ > 0) {
        type = "spike";
      } else {
        type = "dip";
      }

      anomalies.push({
        index: i,
        value: data[i],
        zScore: Math.round(modifiedZ * 1000) / 1000,
        type,
      });
    }
  }

  return anomalies;
}

export function detectChangepoints(data: Float64Array, minSegment: number = 10): number[] {
  if (data.length < minSegment * 2) return [];

  // CUSUM-based changepoint detection
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;

  const changepoints: number[] = [];
  let cumSum = 0;
  let cumSumMin = 0;
  let cumSumMax = 0;
  let lastCp = 0;

  // Estimate std for threshold
  let variance = 0;
  for (let i = 0; i < data.length; i++) {
    variance += (data[i] - mean) ** 2;
  }
  const std = Math.sqrt(variance / data.length);
  const threshold = std * 1.5;

  for (let i = 0; i < data.length; i++) {
    cumSum += data[i] - mean;

    if (cumSum - cumSumMin > threshold && i - lastCp >= minSegment) {
      changepoints.push(i);
      lastCp = i;
      cumSum = 0;
      cumSumMin = 0;
      cumSumMax = 0;
    } else if (cumSumMax - cumSum > threshold && i - lastCp >= minSegment) {
      changepoints.push(i);
      lastCp = i;
      cumSum = 0;
      cumSumMin = 0;
      cumSumMax = 0;
    }

    if (cumSum < cumSumMin) cumSumMin = cumSum;
    if (cumSum > cumSumMax) cumSumMax = cumSum;
  }

  return changepoints;
}

// ─── Auto Configuration ───

export interface AutoConfig {
  algorithm: "lttb" | "minmax_lttb" | "m4";
  targetPoints: number;
  binResolution: number | null;
  spatialIndex: "quadtree" | "octree" | "none";
  streaming: { windowSize: number; updateInterval: number } | null;
  estimatedSpeedup: number;
  reasoning: string;
}

export function autoOptimize(
  x: Float64Array,
  y: Float64Array,
  screenWidth: number = 1920,
): AutoConfig {
  const n = x.length;
  const targetPoints = Math.min(n, screenWidth * 2);

  // Analyze data characteristics
  // 1. Check monotonicity of x (time-series indicator)
  let isMonotonic = true;
  for (let i = 1; i < Math.min(n, 1000); i++) {
    if (x[i] < x[i - 1]) {
      isMonotonic = false;
      break;
    }
  }

  // 2. Check spikiness: ratio of max absolute diff to mean absolute diff
  let sumAbsDiff = 0;
  let maxAbsDiff = 0;
  for (let i = 1; i < n; i++) {
    const d = Math.abs(y[i] - y[i - 1]);
    sumAbsDiff += d;
    if (d > maxAbsDiff) maxAbsDiff = d;
  }
  const meanAbsDiff = sumAbsDiff / (n - 1 || 1);
  const spikeRatio = meanAbsDiff === 0 ? 1 : maxAbsDiff / meanAbsDiff;
  const isSpiky = spikeRatio > 10;

  // 3. Check if data is large enough for streaming
  const isLarge = n > 500_000;

  // Decide algorithm
  let algorithm: "lttb" | "minmax_lttb" | "m4";
  let reasoning: string;

  if (!isMonotonic) {
    algorithm = "m4";
    reasoning = `Non-monotonic x-axis detected (scatter-like data). Using M4 aggregation for ${n} points → ${targetPoints}.`;
  } else if (isSpiky) {
    algorithm = "minmax_lttb";
    reasoning = `Spiky time-series detected (spike ratio ${spikeRatio.toFixed(1)}). Using MinMax+LTTB to preserve extrema in ${n} points → ${targetPoints}.`;
  } else {
    algorithm = "lttb";
    reasoning = `Smooth monotonic time-series. Using LTTB for ${n} points → ${targetPoints}.`;
  }

  // Spatial index recommendation
  const spatialIndex = !isMonotonic ? "quadtree" : "none";

  // Streaming recommendation
  const streaming = isLarge ? { windowSize: Math.min(100_000, n), updateInterval: 1000 } : null;

  if (streaming) {
    reasoning += ` Large dataset — streaming recommended with ${streaming.windowSize} window.`;
  }

  // Bin resolution for heatmaps
  const binResolution = !isMonotonic ? Math.min(256, Math.ceil(Math.sqrt(n))) : null;

  const estimatedSpeedup = n > targetPoints ? Math.round((n / targetPoints) * 10) / 10 : 1;

  return {
    algorithm,
    targetPoints,
    binResolution,
    spatialIndex,
    streaming,
    estimatedSpeedup,
    reasoning,
  };
}

// ─── Data Summarization ───

export interface DataSummary {
  trend: "increasing" | "decreasing" | "stable" | "volatile";
  trendSlope: number;
  range: { min: number; max: number; span: number };
  distribution: { mean: number; median: number; stddev: number; skewness: number };
  spikeCount: number;
  anomalyCount: number;
  summary: string;
}

export function summarize(x: Float64Array, y: Float64Array): DataSummary {
  const n = y.length;
  if (n === 0) {
    return {
      trend: "stable",
      trendSlope: 0,
      range: { min: 0, max: 0, span: 0 },
      distribution: { mean: 0, median: 0, stddev: 0, skewness: 0 },
      spikeCount: 0,
      anomalyCount: 0,
      summary: "Empty dataset.",
    };
  }

  // Basic stats
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    sum += y[i];
    if (y[i] < min) min = y[i];
    if (y[i] > max) max = y[i];
  }
  const mean = sum / n;
  const med = median(y);

  // Variance, stddev, skewness
  let variance = 0;
  let cubedSum = 0;
  for (let i = 0; i < n; i++) {
    const d = y[i] - mean;
    variance += d * d;
    cubedSum += d * d * d;
  }
  variance /= n;
  const stddev = Math.sqrt(variance);
  const skewness = stddev === 0 ? 0 : cubedSum / n / (stddev * stddev * stddev);

  // Linear regression for trend slope (simple OLS)
  let sumX = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
  }
  const denominator = n * sumX2 - sumX * sumX;
  const trendSlope = denominator === 0 ? 0 : (n * sumXY - sumX * sum) / denominator;

  // Classify trend
  const normalizedSlope = stddev === 0 ? 0 : (trendSlope * (x[n - 1] - x[0])) / stddev;
  let trend: "increasing" | "decreasing" | "stable" | "volatile";

  // Check volatility: coefficient of variation
  const cv = mean === 0 ? 0 : stddev / Math.abs(mean);
  if (cv > 1) {
    trend = "volatile";
  } else if (normalizedSlope > 0.5) {
    trend = "increasing";
  } else if (normalizedSlope < -0.5) {
    trend = "decreasing";
  } else {
    trend = "stable";
  }

  // Count spikes (values beyond 2 stddev from mean)
  let spikeCount = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(y[i] - mean) > 2 * stddev) spikeCount++;
  }

  // Anomaly count
  const anomalies = detectAnomalies(y);
  const anomalyCount = anomalies.length;

  // Time span description
  const xSpan = x[n - 1] - x[0];
  let timeDesc = "";
  if (xSpan > 0) {
    const hours = xSpan / 3600;
    if (hours >= 24) {
      timeDesc = `spanning ${(hours / 24).toFixed(1)} days`;
    } else if (hours >= 1) {
      timeDesc = `spanning ${hours.toFixed(1)} hours`;
    } else {
      timeDesc = `spanning ${(xSpan / 60).toFixed(1)} minutes`;
    }
  }

  const summary =
    `Dataset: ${n} points${timeDesc ? " " + timeDesc : ""}. ` +
    `Trend: ${trend} (slope ${trendSlope.toFixed(4)}). ` +
    `Range: [${min.toFixed(2)}, ${max.toFixed(2)}], mean ${mean.toFixed(2)}, stddev ${stddev.toFixed(2)}. ` +
    `${spikeCount} spikes, ${anomalyCount} anomalies detected.`;

  return {
    trend,
    trendSlope: Math.round(trendSlope * 10000) / 10000,
    range: { min, max, span: max - min },
    distribution: {
      mean: Math.round(mean * 10000) / 10000,
      median: Math.round(med * 10000) / 10000,
      stddev: Math.round(stddev * 10000) / 10000,
      skewness: Math.round(skewness * 10000) / 10000,
    },
    spikeCount,
    anomalyCount,
    summary,
  };
}

export function summarizeForLLM(x: Float64Array, y: Float64Array): string {
  const s = summarize(x, y);
  const n = y.length;

  const xSpan = x.length > 0 ? x[x.length - 1] - x[0] : 0;
  let timeDesc = "";
  if (xSpan > 0) {
    const hours = xSpan / 3600;
    if (hours >= 24) {
      timeDesc = `spanning ${(hours / 24).toFixed(1)} days`;
    } else if (hours >= 1) {
      timeDesc = `spanning ${hours.toFixed(1)} hours`;
    } else {
      timeDesc = `spanning ${(xSpan / 60).toFixed(1)} minutes`;
    }
  }

  // Recommend downsampling
  let recommendation = "";
  if (n > 5000) {
    const config = autoOptimize(x, y);
    recommendation = ` Recommended: ${config.algorithm.toUpperCase()} downsampling to ${config.targetPoints} points (${config.estimatedSpeedup}x reduction).`;
  }

  return (
    `This dataset contains ${n.toLocaleString()} time-series points${timeDesc ? " " + timeDesc : ""}. ` +
    `${s.trend.charAt(0).toUpperCase() + s.trend.slice(1)} trend (slope ${s.trendSlope}/unit). ` +
    `Mean: ${s.distribution.mean}, range: [${s.range.min.toFixed(2)}, ${s.range.max.toFixed(2)}]. ` +
    `${s.spikeCount} spike events exceeding 2 stddev. ${s.anomalyCount} anomalies detected.` +
    recommendation
  );
}

// ─── Shape Embeddings ───

export function computeShapeVector(data: Float64Array, dimensions: number = 16): Float64Array {
  const vec = new Float64Array(dimensions);
  const n = data.length;
  if (n === 0) return vec;

  // Normalize data to [0, 1]
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
    sum += data[i];
  }
  const range = max - min || 1;
  const mean = sum / n;

  const normalized = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    normalized[i] = (data[i] - min) / range;
  }

  // Feature 0-7: Normalized histogram (8 bins)
  const histBins = 8;
  for (let i = 0; i < n; i++) {
    let b = Math.floor(normalized[i] * histBins);
    if (b >= histBins) b = histBins - 1;
    vec[b] += 1 / n;
  }

  // Feature 8: Trend slope (normalized)
  let sumI = 0;
  let sumIY = 0;
  let sumI2 = 0;
  for (let i = 0; i < n; i++) {
    sumI += i;
    sumIY += i * normalized[i];
    sumI2 += i * i;
  }
  const denom = n * sumI2 - sumI * sumI;
  vec[8] = denom === 0 ? 0 : (n * sumIY - ((sumI * sum) / n) * n) / denom;
  // Clamp slope to reasonable range
  vec[8] = Math.max(-1, Math.min(1, (n * sumIY - (sumI * (sum - n * min)) / range) / (denom || 1)));

  // Feature 9: Volatility (mean absolute successive difference / range)
  let sumAbsDiff = 0;
  for (let i = 1; i < n; i++) {
    sumAbsDiff += Math.abs(normalized[i] - normalized[i - 1]);
  }
  vec[9] = n > 1 ? sumAbsDiff / (n - 1) : 0;

  // Feature 10: Spike ratio (fraction of points > 2 stddev from mean)
  let variance = 0;
  for (let i = 0; i < n; i++) {
    variance += (data[i] - mean) ** 2;
  }
  const stddev = Math.sqrt(variance / n);
  let spikeCount = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(data[i] - mean) > 2 * stddev) spikeCount++;
  }
  vec[10] = spikeCount / n;

  // Feature 11-14: Autocorrelation at lags 1, 2, 4, 8
  const lags = [1, 2, 4, 8];
  for (let li = 0; li < lags.length; li++) {
    const lag = lags[li];
    if (lag >= n) {
      vec[11 + li] = 0;
      continue;
    }
    let num = 0;
    let den = 0;
    for (let i = 0; i < n - lag; i++) {
      num += (data[i] - mean) * (data[i + lag] - mean);
    }
    for (let i = 0; i < n; i++) {
      den += (data[i] - mean) ** 2;
    }
    vec[11 + li] = den === 0 ? 0 : num / den;
  }

  // Feature 15: Normalized mean
  if (dimensions > 15) {
    vec[15] = (mean - min) / range;
  }

  return vec;
}

export function shapeSimilarity(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length || a.length === 0) return 0;

  // Cosine similarity
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, dotProduct / denom));
}
