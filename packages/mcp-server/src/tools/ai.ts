import {
  parseDataQuery,
  detectAnomalies,
  autoOptimize,
  summarize,
  summarizeForLLM,
  computeShapeVector,
  shapeSimilarity,
} from "@vizcrush/ai";
import type {
  SummarizeInputType,
  DetectAnomaliesInputType,
  AutoOptimizeInputType,
  ParseQueryInputType,
  ShapeSimilarityInputType,
} from "../schemas.js";

export function handleSummarize(input: SummarizeInputType) {
  const y = new Float64Array(input.data);
  const x = new Float64Array(input.data.length);
  for (let i = 0; i < input.data.length; i++) x[i] = i;

  const start = performance.now();
  const result = summarize(x, y);
  const llmSummary = summarizeForLLM(x, y);
  const elapsed = performance.now() - start;

  return {
    ...result,
    llm_summary: llmSummary,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

export function handleDetectAnomalies(input: DetectAnomaliesInputType) {
  const data = new Float64Array(input.data);
  const start = performance.now();
  const anomalies = detectAnomalies(data, input.sensitivity);
  const elapsed = performance.now() - start;

  return {
    anomalies: anomalies.map((a) => ({
      index: a.index,
      value: a.value,
      z_score: a.zScore,
      type: a.type,
    })),
    count: anomalies.length,
    data_length: input.data.length,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

export function handleAutoOptimize(input: AutoOptimizeInputType) {
  const x = new Float64Array(input.x);
  const y = new Float64Array(input.y);
  const start = performance.now();
  const config = autoOptimize(x, y, input.screen_width);
  const elapsed = performance.now() - start;

  return {
    algorithm: config.algorithm,
    target_points: config.targetPoints,
    bin_resolution: config.binResolution,
    spatial_index: config.spatialIndex,
    streaming: config.streaming,
    estimated_speedup: config.estimatedSpeedup,
    reasoning: config.reasoning,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

export function handleParseQuery(input: ParseQueryInputType) {
  const start = performance.now();
  const result = parseDataQuery(input.query, {
    length: input.data_length,
    hasTimestamps: true,
  });
  const elapsed = performance.now() - start;

  return {
    operation: result.operation,
    params: result.params,
    description: result.description,
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

export function handleShapeSimilarity(input: ShapeSimilarityInputType) {
  const a = new Float64Array(input.a);
  const b = new Float64Array(input.b);
  const start = performance.now();

  const vecA = computeShapeVector(a);
  const vecB = computeShapeVector(b);
  const similarity = shapeSimilarity(vecA, vecB);
  const elapsed = performance.now() - start;

  return {
    similarity: Math.round(similarity * 10000) / 10000,
    shape_vector_a: Array.from(vecA),
    shape_vector_b: Array.from(vecB),
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}
