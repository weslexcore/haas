/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import type { MaskBitmap } from "../../core/develop/masks";
import { SEGMENT_TARGETS, type SegmentTarget } from "../../core/develop/recipe";

/**
 * Scene segmentation off the main thread: SegFormer (b0, trained on ADE20K's
 * 150 scene classes) in ONNX Runtime's WebAssembly backend. The model is
 * downloaded from the Hugging Face Hub on first use and kept in the browser's
 * Cache Storage. Each request is the photo squashed to INPUT×INPUT RGBA; the
 * reply is a soft mask per target at the model's output resolution, aligned
 * with the photo's uv.
 */

/** Model files. A different checkpoint only needs the same inputs (pixel_values) and outputs (logits) and an id2label config. */
export const MODEL_BASE = "https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512/resolve/main/";
export const MODEL_FILE = "onnx/model_quantized.onnx";
export const CONFIG_FILE = "config.json";
export const INPUT = 512;
const CACHE = "photon-models";
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** ADE20K classes behind each target (matched against the model's id2label, so the indices needn't be hard-coded). */
const CLASSES: Record<Exclude<SegmentTarget, "background">, string[]> = {
  subject: ["person", "animal", "car", "bus", "truck", "van", "boat", "ship", "airplane", "bicycle", "minibike", "sculpture", "plaything"],
  people: ["person"],
  sky: ["sky"],
  vegetation: ["tree", "grass", "plant", "palm", "flower", "field"],
  water: ["water", "sea", "river", "lake", "swimming pool", "waterfall", "fountain"],
};

export interface SegmentRequest {
  id: number;
  /** INPUT × INPUT RGBA pixels of the photo, stretched to fill. */
  pixels: Uint8ClampedArray;
}

export type SegmentResponse =
  | { kind: "result"; id: number; ok: true; masks: Record<SegmentTarget, MaskBitmap> }
  | { kind: "result"; id: number; ok: false; error: string }
  | { kind: "progress"; loaded: number; total: number };

let session: Promise<{ session: ort.InferenceSession; classSets: Record<Exclude<SegmentTarget, "background">, number[]> }> | null = null;

// The runtime's own loader and binary, served by Vite as assets (the package's exports map doesn't expose
// them, so by path) rather than fetched from a CDN.
ort.env.wasm.wasmPaths = {
  mjs: new URL("../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", import.meta.url).href,
  wasm: new URL("../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", import.meta.url).href,
};

async function cachedFetch(url: string, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const host = new URL(url).host;
  const res = await fetch(url).catch(() => {
    throw new Error(`Couldn't reach ${host} to download the segmentation model. Check the connection and try again.`);
  });
  if (!res.ok) throw new Error(`Couldn't download the segmentation model (${res.status} from ${host}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  let bytes: Uint8Array;
  if (res.body && onProgress) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
    bytes = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  void cache?.put(url, new Response(bytes.slice(), { headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream" } })).catch(() => undefined);
  return bytes.buffer as ArrayBuffer;
}

function classSetsFrom(config: unknown): Record<Exclude<SegmentTarget, "background">, number[]> {
  const labels = (config as { id2label?: Record<string, string> }).id2label;
  if (!labels) throw new Error("The segmentation model's config has no class labels.");
  // Labels can be "bed " or "television receiver, television, …": take the first name, trimmed.
  const byName = new Map<string, number>();
  for (const [id, label] of Object.entries(labels)) byName.set(label.split(",")[0]!.trim().toLowerCase(), Number(id));
  const sets = {} as Record<Exclude<SegmentTarget, "background">, number[]>;
  for (const [target, names] of Object.entries(CLASSES) as Array<[Exclude<SegmentTarget, "background">, string[]]>) {
    sets[target] = names.map((n) => byName.get(n)).filter((i): i is number => i !== undefined);
    if (!sets[target].length) throw new Error(`The segmentation model has no class for ${target}.`);
  }
  return sets;
}

function load() {
  session ??= (async () => {
    const post = (loaded: number, total: number) => self.postMessage({ kind: "progress", loaded, total } satisfies SegmentResponse);
    const [model, config] = await Promise.all([cachedFetch(MODEL_BASE + MODEL_FILE, post), cachedFetch(MODEL_BASE + CONFIG_FILE)]);
    const classSets = classSetsFrom(JSON.parse(new TextDecoder().decode(config)));
    const s = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    return { session: s, classSets };
  })().catch((e: unknown) => {
    session = null; // so the next request tries again (e.g. once online)
    throw e;
  });
  return session;
}

/** ImageNet-normalised NCHW float input. */
function preprocess(pixels: Uint8ClampedArray): Float32Array {
  const n = INPUT * INPUT;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[c * n + i] = (pixels[i * 4 + c]! / 255 - MEAN[c]!) / STD[c]!;
  }
  return out;
}

/** Per-pixel softmax over the classes, summed per target, as 8-bit masks. */
function masksFrom(logits: Float32Array, dims: readonly number[], classSets: Record<Exclude<SegmentTarget, "background">, number[]>): Record<SegmentTarget, MaskBitmap> {
  const [, classes, height, width] = dims as [number, number, number, number];
  const n = width * height;
  const targets = Object.keys(classSets) as Array<Exclude<SegmentTarget, "background">>;
  const out = Object.fromEntries(SEGMENT_TARGETS.map((t) => [t, { width, height, data: new Uint8ClampedArray(n) }])) as Record<SegmentTarget, MaskBitmap>;
  const probs = new Float32Array(classes);
  for (let i = 0; i < n; i++) {
    let max = -Infinity;
    for (let c = 0; c < classes; c++) max = Math.max(max, logits[c * n + i]!);
    let sum = 0;
    for (let c = 0; c < classes; c++) {
      const e = Math.exp(logits[c * n + i]! - max);
      probs[c] = e;
      sum += e;
    }
    for (const t of targets) {
      let p = 0;
      for (const c of classSets[t]) p += probs[c]!;
      out[t].data[i] = Math.round((p / sum) * 255);
    }
    out.background.data[i] = 255 - out.subject.data[i]!;
  }
  return out;
}

self.onmessage = async (e: MessageEvent<SegmentRequest>) => {
  const { id, pixels } = e.data;
  try {
    const { session: s, classSets } = await load();
    const input = new ort.Tensor("float32", preprocess(pixels), [1, 3, INPUT, INPUT]);
    const results = await s.run({ [s.inputNames[0]!]: input });
    const logits = results[s.outputNames[0]!]!;
    const masks = masksFrom(logits.data as Float32Array, logits.dims, classSets);
    self.postMessage({ kind: "result", id, ok: true, masks } satisfies SegmentResponse);
  } catch (error) {
    self.postMessage({ kind: "result", id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies SegmentResponse);
  }
};
