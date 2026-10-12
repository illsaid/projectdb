export const FEATURE_KEYS = ['rms', 'low', 'mid', 'high', 'onset', 'value'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, number>;
export type FeatureMap = ReadonlyMap<string, Features>;

/** Analysis frame: the newest WINDOW samples, preceded by WINDOW samples used for onset comparison. */
export const WINDOW = 1024;
export const SPAN = WINDOW * 2;

const LOW_HZ = 250;
const HIGH_HZ = 2000;
const FLOOR_DB = -60;
const ONSET_GATE_DB = -50;
const ONSET_FULL_RISE_DB = 6;

const hann = Float32Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)));
const hannPower = hann.reduce((s, w) => s + w * w, 0);
const bitrev = (() => {
  const bits = Math.log2(WINDOW);
  return Uint16Array.from({ length: WINDOW }, (_, i) => {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    return r;
  });
})();
const cosT = Float32Array.from({ length: WINDOW / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / WINDOW));
const sinT = Float32Array.from({ length: WINDOW / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / WINDOW));
const re = new Float32Array(WINDOW);
const im = new Float32Array(WINDOW);

function powerSpectrum(frame: Float32Array) {
  for (let i = 0; i < WINDOW; i++) {
    re[bitrev[i]] = frame[i] * hann[i];
    im[bitrev[i]] = 0;
  }
  for (let size = 2; size <= WINDOW; size <<= 1) {
    const half = size >> 1;
    const step = WINDOW / size;
    for (let start = 0; start < WINDOW; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const c = cosT[k * step];
        const s = sinT[k * step];
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/**
 * Wiener entropy of one WINDOW-long frame: geometric over arithmetic mean of the power spectrum.
 * Near 0 for tonal material, around 0.5 for white noise.
 */
export function spectralFlatness(frame: Float32Array): number {
  powerSpectrum(frame);
  let logSum = 0;
  let sum = 0;
  const bins = WINDOW / 2 - 2;
  for (let k = 2; k < WINDOW / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k] + 1e-12;
    logSum += Math.log(p);
    sum += p;
  }
  return Math.exp(logSum / bins) / (sum / bins);
}

const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));
const norm = (rms: number) => Math.min(1, Math.max(0, (toDb(rms * Math.SQRT2) - FLOOR_DB) / -FLOOR_DB));

function rmsOf(span: Float32Array, from: number) {
  let s = 0;
  for (let i = from; i < from + WINDOW; i++) s += span[i] * span[i];
  return Math.sqrt(s / WINDOW);
}

/**
 * Pure feature extraction from SPAN samples whose last sample is "now".
 * rms and band energies are dB-normalised to 0..1, onset is a 0..1 rise trigger, value is the raw latest sample.
 */
export function featuresFromWindow(span: Float32Array, sampleRate: number): Features {
  const prevRms = rmsOf(span, 0);
  const curRms = rmsOf(span, WINDOW);
  powerSpectrum(span.subarray(WINDOW));

  const binHz = sampleRate / WINDOW;
  let low = 0;
  let mid = 0;
  let high = 0;
  for (let k = 1; k < WINDOW / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k];
    const hz = k * binHz;
    if (hz < LOW_HZ) low += p;
    else if (hz < HIGH_HZ) mid += p;
    else high += p;
  }
  const bandRms = (p: number) => Math.sqrt((2 * p) / (WINDOW * hannPower));

  const curDb = toDb(curRms);
  const rise = curDb - toDb(prevRms);
  const onset = curDb > ONSET_GATE_DB ? Math.min(1, Math.max(0, rise / ONSET_FULL_RISE_DB)) : 0;

  return {
    rms: norm(curRms),
    low: norm(bandRms(low)),
    mid: norm(bandRms(mid)),
    high: norm(bandRms(high)),
    onset,
    value: span[SPAN - 1],
  };
}

const scratch = new Float32Array(SPAN);

/** Same features as the live engine, computed from offline-rendered per-node buffers at a video frame. */
export function featuresFromBuffer(
  buffers: ReadonlyMap<string, Float32Array>,
  sampleRate: number,
  frameIndex: number,
  fps: number,
): Map<string, Features> {
  const end = Math.round((frameIndex / fps) * sampleRate);
  const start = end - SPAN;
  const out = new Map<string, Features>();
  for (const [id, data] of buffers) {
    for (let i = 0; i < SPAN; i++) {
      const j = start + i;
      scratch[i] = j >= 0 && j < data.length ? data[j] : 0;
    }
    out.set(id, featuresFromWindow(scratch, sampleRate));
  }
  return out;
}
