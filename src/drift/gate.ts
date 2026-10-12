import { featuresFromBuffer, spectralFlatness, WINDOW } from '@/audio/features';
import { formLook, NEUTRAL_LOOK, type Form } from '@/audio/form';
import { firstNote, loopSpec } from '@/audio/loops';
import { str } from '@/patch/definitions';
import type { VisualGraph } from '@/patch/io';
import type { GraphNode, SeedHex } from '@/patch/types';
import { PALETTE_KEY, paletteLuminanceRange, parsePalette } from '@/visual/inputs';
import type { VisualRenderer } from '@/visual/renderer';
import { createVisualState, stepVisual, visualSeedOf } from '@/visual/step';

export const PREVIEW_SECONDS = 4;
export const PREVIEW_SAMPLE_RATE = 22050;

const SETTLE_SECONDS = 0.5;
const SILENT_DB = -60;
const RMS_RANGE: [number, number] = [-30, -12];
const RMS_TARGET = -20;
const CLIP_LEVEL = 0.985;
const CLIP_RATIO = 0.0005;
const FLAT_LIMIT = 0.4;

export type AudioVerdict = 'ok' | 'silent' | 'clipping' | 'too quiet' | 'too loud' | 'spectrally flat' | 'no early note';

export const EARLY_NOTE_SECONDS = 6;

export interface AudioReport {
  verdict: AudioVerdict;
  rmsDb: number;
  peakDb: number;
  flatness: number;
  /** Lower is better; used to keep the best candidate if every attempt fails. */
  score: number;
}

const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** A short offline render of part of a drift; the first `skip` seconds are warm-up and not judged. */
export interface PreviewWindow {
  mix: AudioBuffer;
  taps: ReadonlyMap<string, Float32Array>;
  skip: number;
  /** Seconds into the form at the first sample. */
  formStart: number;
}

/** Of two reports, the one that should decide: any failure beats a pass, then the higher score. */
export function worse<T extends { verdict: string; score: number }>(a: T, b: T): T {
  if ((a.verdict === 'ok') !== (b.verdict === 'ok')) return a.verdict === 'ok' ? b : a;
  return b.score > a.score ? b : a;
}

export function assessAudio({ mix, skip }: PreviewWindow): AudioReport {
  const from = Math.min(mix.length - 1, Math.round(Math.max(SETTLE_SECONDS, skip) * mix.sampleRate));
  const channels = Array.from({ length: Math.min(2, mix.numberOfChannels) }, (_, c) => mix.getChannelData(c));
  let sumSq = 0;
  let peak = 0;
  let hot = 0;
  let count = 0;
  for (const data of channels) {
    for (let i = from; i < data.length; i++) {
      const v = Math.abs(data[i]);
      sumSq += v * v;
      if (v > peak) peak = v;
      if (v >= CLIP_LEVEL) hot++;
      count++;
    }
  }
  const rmsDb = toDb(Math.sqrt(sumSq / Math.max(1, count)));
  const peakDb = toDb(peak);

  const mono = new Float32Array(WINDOW);
  let flatSum = 0;
  let frames = 0;
  for (let start = from; start + WINDOW <= mix.length; start += WINDOW * 2) {
    let energy = 0;
    for (let i = 0; i < WINDOW; i++) {
      let s = 0;
      for (const data of channels) s += data[start + i];
      mono[i] = s / channels.length;
      energy += mono[i] * mono[i];
    }
    if (energy / WINDOW < 1e-8) continue;
    flatSum += spectralFlatness(mono);
    frames++;
  }
  const flatness = frames ? flatSum / frames : 0;

  let verdict: AudioVerdict = 'ok';
  if (rmsDb < SILENT_DB) verdict = 'silent';
  else if (hot / Math.max(1, count) > CLIP_RATIO) verdict = 'clipping';
  else if (rmsDb < RMS_RANGE[0]) verdict = 'too quiet';
  else if (rmsDb > RMS_RANGE[1]) verdict = 'too loud';
  else if (flatness > FLAT_LIMIT) verdict = 'spectrally flat';

  const score =
    Math.abs(rmsDb - RMS_TARGET) +
    (verdict === 'silent' ? 1000 : 0) +
    (verdict === 'clipping' ? 100 : 0) +
    Math.max(0, flatness - FLAT_LIMIT) * 100;
  return { verdict, rmsDb, peakDb, flatness, score };
}

/** When the first Loop Voice note sounds, read straight from the score, or null if none starts in time. */
export function earliestNote(nodes: Pick<GraphNode, 'id' | 'type' | 'data'>[], form: Form, limit = EARLY_NOTE_SECONDS): number | null {
  let best: number | null = null;
  for (const n of nodes) {
    if (n.type !== 'loopVoice') continue;
    const spans = form.gates?.find((g) => g.node === n.id)?.spans;
    const t = firstNote(loopSpec(n.data), spans, limit);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Fails a loop-based drift that would open with silence for its first six seconds. */
export function requireEarlyNote(report: AudioReport, nodes: Pick<GraphNode, 'id' | 'type' | 'data'>[], form: Form): AudioReport {
  if (earliestNote(nodes, form) !== null) return report;
  return { ...report, verdict: report.verdict === 'ok' ? 'no early note' : report.verdict, score: report.score + 50 };
}

export const VISUAL_PREVIEW = { width: 96, height: 54, fps: 15 } as const;

const FLASH_DELTA = 0.1;
const MAX_FLASHES_PER_SECOND = 3;
const MIN_PALETTE_RANGE = 0.3;
const STATIC_DIFF = 0.0015;

export type VisualVerdict = 'ok' | 'flashing' | 'low contrast' | 'static';

export interface VisualReport {
  verdict: VisualVerdict;
  flashesPerSecond: number;
  paletteRange: number;
  meanDiff: number;
  score: number;
}

/**
 * Renders the visual small and fast against the preview audio and checks it for strobing,
 * a palette without enough light/dark range, and a picture that barely moves.
 */
export function assessVisual(
  renderer: VisualRenderer,
  graph: VisualGraph,
  patchSeed: SeedHex,
  window: PreviewWindow,
  form: Form | null,
): VisualReport {
  const { taps, skip, formStart } = window;
  const sampleRate = window.mix.sampleRate;
  const { node, links } = graph;
  if (!node) return { verdict: 'ok', flashesPerSecond: 0, paletteRange: 1, meanDiff: 1, score: 0 };
  const { width, height, fps } = VISUAL_PREVIEW;
  const frames = Math.round(PREVIEW_SECONDS * fps);
  const firstFrame = Math.round(skip * fps);
  const pixels = new Uint8Array(width * height * 4);
  const count = width * height;
  let prev = new Float32Array(count);
  let cur = new Float32Array(count);
  const means: number[] = [];
  let diffSum = 0;
  const state = createVisualState(visualSeedOf(node.data, patchSeed));

  for (let f = 0; f < frames; f++) {
    const features = featuresFromBuffer(taps, sampleRate, firstFrame + f, fps);
    const look = form ? formLook(form, { time: formStart + (firstFrame + f) / fps, pass: 0 }) : NEUTRAL_LOOK;
    renderer.render(stepVisual(state, node.data, links, features, 1 / fps, look), width, height);
    renderer.readPixels(width, height, pixels);
    let sum = 0;
    let diff = 0;
    for (let i = 0; i < count; i++) {
      const l = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255;
      cur[i] = l;
      sum += l;
      if (f > 0) diff += Math.abs(l - prev[i]);
    }
    means.push(sum / count);
    if (f > 0) diffSum += diff / count;
    [prev, cur] = [cur, prev];
  }

  const flashes = means.map((m, i): number => (i > 0 && Math.abs(m - means[i - 1]) > FLASH_DELTA ? 1 : 0));
  let flashesPerSecond = 0;
  for (let i = 0; i + fps <= flashes.length; i++) {
    flashesPerSecond = Math.max(flashesPerSecond, flashes.slice(i, i + fps).reduce((s, x) => s + x, 0));
  }
  const paletteRange = paletteLuminanceRange(parsePalette(str(node.data, PALETTE_KEY, '')));
  const meanDiff = diffSum / Math.max(1, frames - 1);

  let verdict: VisualVerdict = 'ok';
  if (flashesPerSecond > MAX_FLASHES_PER_SECOND) verdict = 'flashing';
  else if (paletteRange < MIN_PALETTE_RANGE) verdict = 'low contrast';
  else if (meanDiff < STATIC_DIFF) verdict = 'static';

  const score =
    Math.max(0, flashesPerSecond - MAX_FLASHES_PER_SECOND) * 10 +
    Math.max(0, MIN_PALETTE_RANGE - paletteRange) * 50 +
    Math.max(0, STATIC_DIFF - meanDiff) * 5000;
  return { verdict, flashesPerSecond, paletteRange, meanDiff, score };
}
