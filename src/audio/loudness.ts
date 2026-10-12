import { num } from '@/patch/definitions';
import type { PatchFile } from '@/patch/types';

export type LoudnessTarget = -14 | -23 | null;

export const LOUDNESS_TARGETS: { value: LoudnessTarget; label: string; hint: string }[] = [
  { value: -14, label: '−14 LUFS', hint: 'Web' },
  { value: -23, label: '−23 LUFS', hint: 'Broadcast' },
  { value: null, label: 'Off', hint: 'As rendered' },
];

export interface LoudnessResult {
  /** Integrated loudness before and after normalising, in LUFS (−Infinity when silent). */
  measured: number;
  final: number;
  peakDb: number;
  /** True when the ceiling stopped the render from reaching the target. */
  limited: boolean;
}

const fmt = (v: number, unit: string) => (Number.isFinite(v) ? `${v.toFixed(1)} ${unit}` : 'silent');

/** One line for the export dialogs, e.g. "−14.0 LUFS · peak −3.2 dBFS". */
export function loudnessSummary(r: LoudnessResult): string {
  const base = `${fmt(r.final, 'LUFS')} · peak ${fmt(r.peakDb, 'dBFS')}`;
  return r.limited ? `${base} · held back by the ceiling` : base;
}

const BLOCK = 0.4;
const STEP = 0.1;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = 10;
const MAX_BOOST_DB = 24;
const TOLERANCE = 0.2;
const MAX_PASSES = 4;

type Biquad = [b0: number, b1: number, b2: number, a1: number, a2: number];

/** ITU-R BS.1770-4 K-weighting (pre-filter shelf + RLB high-pass), derived for any sample rate. */
function kWeighting(fs: number): [Biquad, Biquad] {
  let K = Math.tan((Math.PI * 1681.974450955533) / fs);
  let Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = [
    (Vh + (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - Vh)) / a0,
    (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0,
    (1 - K / Q + K * K) / a0,
  ];
  K = Math.tan((Math.PI * 38.13547087602444) / fs);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const highPass: Biquad = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, highPass];
}

function filter(input: Float32Array, [b0, b1, b2, a1, a2]: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

const toLufs = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);

/** Gated integrated loudness (BS.1770-4) of stereo channels at `sampleRate`. */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const stages = kWeighting(sampleRate);
  const weighted = channels.map((c) => stages.reduce(filter, c));
  const block = Math.round(BLOCK * sampleRate);
  const step = Math.round(STEP * sampleRate);
  const length = weighted[0]?.length ?? 0;
  if (length < block) return -Infinity;

  const powers: number[] = [];
  for (let start = 0; start + block <= length; start += step) {
    let power = 0;
    for (const data of weighted) {
      let sum = 0;
      for (let i = start; i < start + block; i++) sum += data[i] * data[i];
      power += sum / block;
    }
    powers.push(power);
  }
  const mean = (list: number[]) => list.reduce((s, p) => s + p, 0) / list.length;
  const loud = powers.filter((p) => toLufs(p) > ABSOLUTE_GATE);
  if (!loud.length) return -Infinity;
  const relative = toLufs(mean(loud)) - RELATIVE_GATE;
  const gated = loud.filter((p) => toLufs(p) > relative);
  return gated.length ? toLufs(mean(gated)) : -Infinity;
}

const peakOf = (channels: Float32Array[]) => channels.reduce((m, c) => c.reduce((p, v) => Math.max(p, Math.abs(v)), m), 0);
const toDb = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/** The Master module's ceiling in dBFS, which normalising must not exceed. */
export function patchCeilingDb(patch: PatchFile): number {
  const master = patch.nodes.find((n) => n.type === 'master');
  return master ? num(master.data, 'ceiling', -3) : -3;
}

/**
 * Measures the buffer and, if a target is set, scales it in place toward that loudness. Samples
 * pushed past the ceiling go through the same c·tanh(x/c) curve the Master uses, so peaks stay
 * under it; the gain is refined over a few passes because that curve slightly lowers loudness.
 */
export function normalizeLoudness(buffer: AudioBuffer, target: LoudnessTarget, ceilingDb: number): LoudnessResult {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const measured = integratedLoudness(channels, buffer.sampleRate);
  if (target === null || !Number.isFinite(measured)) {
    return { measured, final: measured, peakDb: toDb(peakOf(channels)), limited: false };
  }

  const original = channels.map((c) => c.slice());
  const ceiling = Math.pow(10, ceilingDb / 20);
  let gainDb = Math.min(MAX_BOOST_DB, target - measured);
  let final = measured;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const gain = Math.pow(10, gainDb / 20);
    const clip = peakOf(original) * gain > ceiling;
    original.forEach((src, ch) => {
      const dst = channels[ch];
      for (let i = 0; i < src.length; i++) {
        const v = src[i] * gain;
        dst[i] = clip ? ceiling * Math.tanh(v / ceiling) : v;
      }
    });
    final = integratedLoudness(channels, buffer.sampleRate);
    const miss = target - final;
    if (Math.abs(miss) <= TOLERANCE || gainDb >= MAX_BOOST_DB) break;
    gainDb = Math.min(MAX_BOOST_DB, gainDb + miss);
  }
  return { measured, final, peakDb: toDb(peakOf(channels)), limited: final < target - 1 };
}
