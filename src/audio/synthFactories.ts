import { num, str, VOWELS } from '@/patch/definitions';
import type { NodeData } from '@/patch/types';
import { constant, crossfade, glide, startAt, stopSafely, type EngineNode, type FactoryCtx } from './factoryKit';
import { rngFor } from './random';

const MIN_STRIKE_GAP = 0.08;
const STRIKE_TAU = 0.002;
/** Room mode softens each strike's onset to a gentle swell. */
const ROOM_STRIKE_TAU = 0.03;

/**
 * Two-operator FM: a sine modulator at frequency × ratio swings the carrier's frequency by
 * index × modulator frequency, all at audio rate. Frequency, ratio and index stay modulatable
 * because the products are formed by gain nodes rather than computed on the main thread.
 */
export function fmOperator({ ctx, id, seed, origin }: FactoryCtx, data: NodeData): EngineNode {
  const freq = constant(ctx, num(data, 'frequency', 220), origin);
  const ratio = new GainNode(ctx, { gain: num(data, 'ratio', 2) });
  const carrier = new OscillatorNode(ctx, { frequency: 0, detune: num(data, 'detune') });
  const modulator = new OscillatorNode(ctx, { frequency: 0 });
  const index = new GainNode(ctx, { gain: num(data, 'index', 2) });
  const indexEnv = new GainNode(ctx, { gain: 1 });
  const depth = new GainNode(ctx, { gain: 0 });
  const env = new GainNode(ctx, { gain: 1 });
  const out = new GainNode(ctx, { gain: num(data, 'level', 0.3) });
  const section = new GainNode(ctx, { gain: 1 });

  freq.connect(carrier.frequency);
  freq.connect(ratio);
  ratio.connect(modulator.frequency);
  ratio.connect(depth.gain);
  modulator.connect(index).connect(indexEnv).connect(depth).connect(carrier.frequency);
  carrier.connect(env).connect(out).connect(section);
  const start = startAt(ctx, origin);
  carrier.start(start);
  modulator.start(start);

  // Strike times are drawn from the seed whether or not they sound, so switching modes never shifts the pattern.
  const rng = rngFor(seed, id, 'strike');
  let mode = '';
  let density = num(data, 'density', 0.3);
  let decay = num(data, 'decay', 3);
  let strikeTau = num(data, 'room') > 0 ? ROOM_STRIKE_TAU : STRIKE_TAU;
  let nextTime = origin + 0.05 + rng() * 0.5;
  let velocity = 0.55 + rng() * 0.45;
  const advance = () => {
    nextTime += Math.max(MIN_STRIKE_GAP, -Math.log(1 - rng()) / Math.max(0.01, density));
    velocity = 0.55 + rng() * 0.45;
  };

  const setMode = (next: string) => {
    if (next === mode) return;
    mode = next;
    const now = ctx.currentTime;
    for (const g of [env.gain, indexEnv.gain]) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(mode === 'strike' ? 0 : 1, now);
    }
  };
  setMode(str(data, 'env', 'hold'));

  return {
    input: null,
    output: section,
    meterTap: section,
    params: { frequency: freq.offset, ratio: ratio.gain, index: index.gain, detune: carrier.detune, level: out.gain },
    form: { level: { param: section.gain, mode: 'gain' } },
    update(d) {
      setMode(str(d, 'env', 'hold'));
      density = num(d, 'density', 0.3);
      decay = num(d, 'decay', 3);
      strikeTau = num(d, 'room') > 0 ? ROOM_STRIKE_TAU : STRIKE_TAU;
      glide(freq.offset, num(d, 'frequency', 220), ctx);
      glide(ratio.gain, num(d, 'ratio', 2), ctx);
      glide(index.gain, num(d, 'index', 2), ctx);
      glide(carrier.detune, num(d, 'detune'), ctx);
      glide(out.gain, num(d, 'level', 0.3), ctx);
    },
    schedule(until) {
      const now = ctx.currentTime;
      while (nextTime < now) advance();
      while (nextTime < until) {
        if (mode === 'strike') {
          const t = nextTime;
          const peak = t + strikeTau * 6;
          env.gain.setTargetAtTime(velocity, t, strikeTau);
          env.gain.setTargetAtTime(0, peak, decay / 4.6);
          indexEnv.gain.setTargetAtTime(1, t, strikeTau);
          indexEnv.gain.setTargetAtTime(0.12, peak, decay / 9);
        }
        advance();
      }
    },
    dispose() {
      [freq, carrier, modulator].forEach(stopSafely);
      [freq, ratio, carrier, modulator, index, indexEnv, depth, env, out, section].forEach((n) => n.disconnect());
    },
  };
}

const CHORUS_BASE = [0.014, 0.021, 0.028];
const CHORUS_PAN = [-0.7, 0.7, 0];
const CHORUS_SWING = 0.006;

/** Sine with a fixed starting phase, so the voices sweep out of step without any randomness. */
function phasedSine(ctx: BaseAudioContext, phase: number) {
  const real = new Float32Array([0, Math.sin(phase)]);
  const imag = new Float32Array([0, Math.cos(phase)]);
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

/** Two or three short delays swept by out-of-phase LFOs, spread across the stereo field. */
export function chorus({ ctx, origin }: FactoryCtx, data: NodeData): EngineNode {
  const xf = crossfade(ctx, num(data, 'mix', 0.5));
  const input = new GainNode(ctx);
  const out = new GainNode(ctx);
  const wetSum = new GainNode(ctx);
  const rate = constant(ctx, num(data, 'rate', 0.4), origin);
  const depth = constant(ctx, num(data, 'depth', 0.4), origin);
  const swing = new GainNode(ctx, { gain: CHORUS_SWING });
  depth.connect(swing);
  input.connect(xf.dry).connect(out);
  wetSum.connect(xf.wet).connect(out);

  const voices = CHORUS_BASE.map((base, i) => {
    const line = new DelayNode(ctx, { maxDelayTime: 0.05, delayTime: base });
    const lfo = new OscillatorNode(ctx, { frequency: 0, periodicWave: phasedSine(ctx, (i * 2 * Math.PI) / 3) });
    const mod = new GainNode(ctx, { gain: 0 });
    const pan = new StereoPannerNode(ctx, { pan: CHORUS_PAN[i] });
    const level = new GainNode(ctx, { gain: 1 });
    rate.connect(lfo.frequency);
    swing.connect(mod.gain);
    lfo.connect(mod).connect(line.delayTime);
    input.connect(line).connect(pan).connect(level).connect(wetSum);
    lfo.start(startAt(ctx, origin));
    return { line, lfo, mod, pan, level };
  });

  const setVoices = (d: NodeData) => {
    const count = str(d, 'voices', '3') === '2' ? 2 : 3;
    voices[2].level.gain.value = count === 3 ? 1 : 0;
    wetSum.gain.value = 0.85 / Math.sqrt(count);
  };
  setVoices(data);

  return {
    input,
    output: out,
    meterTap: out,
    params: { rate: rate.offset, depth: depth.offset, mix: xf.mix },
    update(d) {
      setVoices(d);
      glide(rate.offset, num(d, 'rate', 0.4), ctx);
      glide(depth.offset, num(d, 'depth', 0.4), ctx);
      glide(xf.mix, num(d, 'mix', 0.5), ctx);
    },
    dispose() {
      xf.dispose();
      [rate, depth].forEach(stopSafely);
      [input, out, wetSum, rate, depth, swing].forEach((n) => n.disconnect());
      for (const v of voices) {
        stopSafely(v.lfo);
        [v.line, v.lfo, v.mod, v.pan, v.level].forEach((n) => n.disconnect());
      }
    },
  };
}

/** Formant centre frequencies (Hz) and relative band levels per vowel. */
const VOWEL_TABLE: { f: [number, number, number]; a: [number, number, number] }[] = [
  { f: [800, 1150, 2800], a: [1, 0.5, 0.1] },
  { f: [400, 1600, 2700], a: [1, 0.3, 0.12] },
  { f: [300, 2200, 3000], a: [1, 0.25, 0.15] },
  { f: [450, 800, 2830], a: [1, 0.35, 0.08] },
  { f: [325, 700, 2530], a: [1, 0.25, 0.05] },
];
/** The shaper input spans vowel positions −5…15, so modulation can push morph past either end and keep cycling. */
const POS_MIN = -5;
const POS_SPAN = 20;
const CURVE_POINTS = 2001;

function vowelCurve(band: number, field: 'f' | 'a'): Float32Array {
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const pos = POS_MIN + (i / (CURVE_POINTS - 1)) * POS_SPAN;
    const wrapped = ((pos % 5) + 5) % 5;
    const lo = Math.floor(wrapped);
    const t = wrapped - lo;
    const a = VOWEL_TABLE[lo][field][band];
    const b = VOWEL_TABLE[(lo + 1) % 5][field][band];
    curve[i] = a + (b - a) * t;
  }
  return curve;
}

const vowelIndex = (d: NodeData) => Math.max(0, VOWELS.indexOf(str(d, 'vowel', 'a') as (typeof VOWELS)[number]));

/**
 * Three parallel band-passes whose centres and levels follow a vowel table. Morph (0–1) walks
 * through all five vowels from the chosen one; the walk runs through wave shapers at audio rate.
 */
export function formant({ ctx, origin }: FactoryCtx, data: NodeData): EngineNode {
  const input = new GainNode(ctx);
  const sum = new GainNode(ctx);
  const level = new GainNode(ctx, { gain: num(data, 'level', 2) });
  const vowel = constant(ctx, vowelIndex(data) - POS_MIN, origin);
  const morph = constant(ctx, num(data, 'morph', 0), origin);
  const q = constant(ctx, num(data, 'q', 10), origin);
  const detune = constant(ctx, 0, origin);
  const morphSpan = new GainNode(ctx, { gain: 4 });
  const position = new GainNode(ctx, { gain: 2 / POS_SPAN });
  // Shaper input x = 2·(pos − POS_MIN)/POS_SPAN − 1; the vowel source already carries −POS_MIN.
  const offset = constant(ctx, -POS_SPAN / 2, origin);
  morph.connect(morphSpan).connect(position);
  vowel.connect(position);
  offset.connect(position);
  sum.connect(level);

  const bands = [0, 1, 2].map((i) => {
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 0, Q: 0 });
    const amp = new GainNode(ctx, { gain: 0 });
    const freqShape = new WaveShaperNode(ctx, { curve: vowelCurve(i, 'f') });
    const ampShape = new WaveShaperNode(ctx, { curve: vowelCurve(i, 'a') });
    position.connect(freqShape).connect(bp.frequency);
    position.connect(ampShape).connect(amp.gain);
    q.connect(bp.Q);
    detune.connect(bp.detune);
    input.connect(bp).connect(amp).connect(sum);
    return { bp, amp, freqShape, ampShape };
  });

  return {
    input,
    output: level,
    meterTap: level,
    params: { morph: morph.offset, q: q.offset, level: level.gain },
    form: { cutoff: { param: detune.offset, mode: 'cents' } },
    update(d) {
      glide(vowel.offset, vowelIndex(d) - POS_MIN, ctx);
      glide(morph.offset, num(d, 'morph', 0), ctx);
      glide(q.offset, num(d, 'q', 10), ctx);
      glide(level.gain, num(d, 'level', 2), ctx);
    },
    dispose() {
      [vowel, morph, q, detune, offset].forEach(stopSafely);
      [input, sum, level, vowel, morph, q, detune, morphSpan, position, offset].forEach((n) => n.disconnect());
      for (const b of bands) [b.bp, b.amp, b.freqShape, b.ampShape].forEach((n) => n.disconnect());
    },
  };
}
