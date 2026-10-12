import { num, str } from '@/patch/definitions';
import type { AudioKind, NodeData } from '@/patch/types';
import { crossfade, glide, startAt, stopSafely, type EngineNode, type FactoryCtx } from './factoryKit';
import { cachedBuffer } from './bufferCache';
import { rngFor, type Rng } from './random';
import { loopVoice } from './loopVoice';
import { chorus, fmOperator, formant } from './synthFactories';
import { tapeEcho } from './tapeEcho';

function makeNoiseBuffer(ctx: BaseAudioContext, color: string, rng: Rng): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 6);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const out = buffer.getChannelData(0);
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
  }
  return buffer;
}

function makeImpulse(ctx: BaseAudioContext, decay: number, rng: Rng): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sr * decay));
  const buffer = ctx.createBuffer(2, length, sr);
  const fadeIn = Math.floor(sr * 0.004);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const env = Math.exp((-6.9 * t) / decay) * (i < fadeIn ? i / fadeIn : 1);
      data[i] = (rng() * 2 - 1) * env;
    }
  }
  return buffer;
}

const SOFT_CLIP_HEADROOM = 4;

/** c·tanh(x/c) over ±HEADROOM, so the output can never exceed the ceiling c. */
function softClipCurve(ceilingDb: number): Float32Array {
  const c = Math.pow(10, ceilingDb / 20);
  const n = 8192;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * SOFT_CLIP_HEADROOM;
    curve[i] = c * Math.tanh(x / c);
  }
  return curve;
}

/** Staircase quantiser after a gentle tanh drive: a bit-reduced edge without a sample-rate reducer. */
function stepCurve(bits: number): Float32Array {
  const n = 4096;
  const levels = 2 ** Math.round(bits) / 2;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = Math.tanh(((i / (n - 1)) * 2 - 1) * 1.5) / Math.tanh(1.5);
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

function softCurve(): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 2.5) / Math.tanh(2.5);
  return curve;
}

function oscillator({ ctx, origin }: FactoryCtx, data: NodeData): EngineNode {
  const osc = new OscillatorNode(ctx, {
    type: str(data, 'wave', 'sawtooth') as OscillatorType,
    frequency: num(data, 'frequency', 110),
    detune: num(data, 'detune'),
  });
  const out = new GainNode(ctx, { gain: num(data, 'level', 0.3) });
  const section = new GainNode(ctx, { gain: 1 });
  osc.connect(out).connect(section);
  osc.start(startAt(ctx, origin));
  return {
    input: null,
    output: section,
    meterTap: section,
    params: { frequency: osc.frequency, detune: osc.detune, level: out.gain },
    form: { level: { param: section.gain, mode: 'gain' } },
    update(d) {
      osc.type = str(d, 'wave', 'sawtooth') as OscillatorType;
      glide(osc.frequency, num(d, 'frequency', 110), ctx);
      glide(osc.detune, num(d, 'detune'), ctx);
      glide(out.gain, num(d, 'level', 0.3), ctx);
    },
    dispose() {
      stopSafely(osc);
      [osc, out, section].forEach((n) => n.disconnect());
    },
  };
}

function noise({ ctx, id, seed, origin }: FactoryCtx, data: NodeData): EngineNode {
  const out = new GainNode(ctx, { gain: num(data, 'level', 0.3) });
  const section = new GainNode(ctx, { gain: 1 });
  out.connect(section);
  let color = '';
  let src: AudioBufferSourceNode | null = null;

  const setColor = (next: string) => {
    if (next === color) return;
    color = next;
    if (src) {
      stopSafely(src);
      src.disconnect();
    }
    src = new AudioBufferSourceNode(ctx, {
      buffer: cachedBuffer(ctx, `noise:${seed}:${id}:${color}`, () => makeNoiseBuffer(ctx, color, rngFor(seed, id, `noise-${color}`))),
      loop: true,
    });
    src.connect(out);
    src.start(startAt(ctx, origin));
  };
  setColor(str(data, 'color', 'white'));

  return {
    input: null,
    output: section,
    meterTap: section,
    params: { level: out.gain },
    form: { level: { param: section.gain, mode: 'gain' } },
    update(d) {
      setColor(str(d, 'color', 'white'));
      glide(out.gain, num(d, 'level', 0.3), ctx);
    },
    dispose() {
      if (src) {
        stopSafely(src);
        src.disconnect();
      }
      out.disconnect();
      section.disconnect();
    },
  };
}

function filter({ ctx }: FactoryCtx, data: NodeData): EngineNode {
  const biquad = new BiquadFilterNode(ctx, {
    type: str(data, 'mode', 'lowpass') as BiquadFilterType,
    frequency: num(data, 'frequency', 1200),
    Q: num(data, 'q', 1),
  });
  return {
    input: biquad,
    output: biquad,
    meterTap: biquad,
    params: { frequency: biquad.frequency, q: biquad.Q },
    form: { cutoff: { param: biquad.detune, mode: 'cents' } },
    update(d) {
      biquad.type = str(d, 'mode', 'lowpass') as BiquadFilterType;
      glide(biquad.frequency, num(d, 'frequency', 1200), ctx);
      glide(biquad.Q, num(d, 'q', 1), ctx);
    },
    dispose() {
      biquad.disconnect();
    },
  };
}

function gain({ ctx }: FactoryCtx, data: NodeData): EngineNode {
  const input = new GainNode(ctx);
  const shaper = new WaveShaperNode(ctx);
  const g = new GainNode(ctx, { gain: num(data, 'gain', 0.8) });
  input.connect(shaper).connect(g);
  let shapeKey = '';
  const setShape = (d: NodeData) => {
    const shape = str(d, 'shape', 'clean');
    const bits = num(d, 'bits', 4);
    const key = shape === 'steps' ? `steps-${Math.round(bits)}` : shape;
    if (key === shapeKey) return;
    shapeKey = key;
    shaper.curve = shape === 'steps' ? stepCurve(bits) : shape === 'soft' ? softCurve() : null;
  };
  setShape(data);
  return {
    input,
    output: g,
    meterTap: g,
    params: { gain: g.gain },
    update(d) {
      setShape(d);
      glide(g.gain, num(d, 'gain', 0.8), ctx);
    },
    dispose() {
      [input, shaper, g].forEach((n) => n.disconnect());
    },
  };
}

function delay({ ctx }: FactoryCtx, data: NodeData): EngineNode {
  const xf = crossfade(ctx, num(data, 'mix', 0.4));
  const input = new GainNode(ctx);
  // Zero-time delay on the dry path keeps patch-level feedback loops through this module legal in Web Audio.
  const dryTap = new DelayNode(ctx, { maxDelayTime: 0.01, delayTime: 0 });
  const line = new DelayNode(ctx, { maxDelayTime: 2.5, delayTime: num(data, 'time', 0.35) });
  const fb = new GainNode(ctx, { gain: num(data, 'feedback', 0.45) });
  const fbForm = new GainNode(ctx, { gain: 1 });
  const damp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6000 });
  const out = new GainNode(ctx);
  input.connect(dryTap).connect(xf.dry).connect(out);
  input.connect(line);
  line.connect(damp).connect(fb).connect(fbForm).connect(line);
  line.connect(xf.wet).connect(out);
  return {
    input,
    output: out,
    meterTap: out,
    params: { time: line.delayTime, feedback: fb.gain, mix: xf.mix },
    form: { delayFeedback: { param: fbForm.gain, mode: 'gain' } },
    update(d) {
      glide(line.delayTime, num(d, 'time', 0.35), ctx);
      glide(fb.gain, num(d, 'feedback', 0.45), ctx);
      glide(xf.mix, num(d, 'mix', 0.4), ctx);
    },
    dispose() {
      xf.dispose();
      [input, dryTap, line, fb, fbForm, damp, out].forEach((n) => n.disconnect());
    },
  };
}

function reverb({ ctx, id, seed, realtime }: FactoryCtx, data: NodeData): EngineNode {
  const xf = crossfade(ctx, num(data, 'mix', 0.35));
  const input = new GainNode(ctx);
  const conv = new ConvolverNode(ctx);
  const out = new GainNode(ctx);
  input.connect(xf.dry).connect(out);
  input.connect(conv).connect(xf.wet).connect(out);

  let decay = num(data, 'decay', 3);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const buildIR = () => {
    conv.buffer = cachedBuffer(ctx, `ir:${seed}:${id}:${decay}`, () => makeImpulse(ctx, decay, rngFor(seed, id, 'ir')));
  };
  buildIR();

  return {
    input,
    output: out,
    meterTap: out,
    params: { mix: xf.mix },
    form: { reverbMix: { param: xf.scale, mode: 'gain' } },
    update(d) {
      glide(xf.mix, num(d, 'mix', 0.35), ctx);
      const next = num(d, 'decay', 3);
      if (next !== decay) {
        decay = next;
        if (!realtime) return buildIR();
        if (timer) clearTimeout(timer);
        timer = setTimeout(buildIR, 120);
      }
    },
    dispose() {
      if (timer) clearTimeout(timer);
      xf.dispose();
      [input, conv, out].forEach((n) => n.disconnect());
    },
  };
}

function lfo({ ctx, origin }: FactoryCtx, data: NodeData): EngineNode {
  const osc = new OscillatorNode(ctx, {
    type: str(data, 'shape', 'sine') as OscillatorType,
    frequency: num(data, 'rate', 0.5),
  });
  const depth = new GainNode(ctx, { gain: num(data, 'depth', 0.25) });
  osc.connect(depth);
  osc.start(startAt(ctx, origin));
  return {
    input: null,
    output: depth,
    meterTap: depth,
    params: { rate: osc.frequency, depth: depth.gain },
    form: { lfoRate: { param: osc.detune, mode: 'cents' } },
    update(d) {
      osc.type = str(d, 'shape', 'sine') as OscillatorType;
      glide(osc.frequency, num(d, 'rate', 0.5), ctx);
      glide(depth.gain, num(d, 'depth', 0.25), ctx);
    },
    dispose() {
      stopSafely(osc);
      osc.disconnect();
      depth.disconnect();
    },
  };
}

function randomWalk({ ctx, id, seed, origin }: FactoryCtx, data: NodeData): EngineNode {
  const rng = rngFor(seed, id, 'walk');
  const source = new ConstantSourceNode(ctx, { offset: 0 });
  const range = new GainNode(ctx, { gain: num(data, 'range', 0.25) });
  source.connect(range);

  let rate = num(data, 'rate', 2);
  let step = num(data, 'step', 0.25);
  let value = rng() * 2 - 1;
  let nextTime = origin + 1 / rate;
  const advance = () => {
    value += (rng() * 2 - 1) * step;
    if (value > 1) value = 2 - value;
    if (value < -1) value = -2 - value;
    nextTime += 1 / Math.max(0.01, rate);
  };
  source.offset.setValueAtTime(value, startAt(ctx, origin));
  source.start(startAt(ctx, origin));

  return {
    input: null,
    output: range,
    meterTap: range,
    params: { range: range.gain },
    update(d) {
      rate = num(d, 'rate', 2);
      step = num(d, 'step', 0.25);
      glide(range.gain, num(d, 'range', 0.25), ctx);
    },
    schedule(until) {
      // Steps that fell behind still consume the random stream, so the walk stays on its seeded path.
      const now = ctx.currentTime;
      if (nextTime < now) {
        while (nextTime < now) advance();
        source.offset.setValueAtTime(value, now);
      }
      while (nextTime < until) {
        const at = nextTime;
        advance();
        source.offset.linearRampToValueAtTime(value, at);
      }
    },
    dispose() {
      stopSafely(source);
      source.disconnect();
      range.disconnect();
    },
  };
}

function master({ ctx, destination }: FactoryCtx, data: NodeData): EngineNode {
  const input = new GainNode(ctx, { gain: num(data, 'volume', 0.8) });
  const limiter = new DynamicsCompressorNode(ctx, {
    threshold: num(data, 'ceiling', -3),
    knee: 0,
    ratio: 20,
    attack: 0.002,
    release: 0.15,
  });
  let ceiling = num(data, 'ceiling', -3);
  const headroom = new GainNode(ctx, { gain: 1 / SOFT_CLIP_HEADROOM });
  const clipper = new WaveShaperNode(ctx, { curve: softClipCurve(ceiling), oversample: '4x' });
  // The form fade sits after the ceiling so two crossfading passes can never sum above it.
  const fade = new GainNode(ctx, { gain: 1 });
  input.connect(limiter).connect(headroom).connect(clipper).connect(fade).connect(destination);
  return {
    input,
    output: null,
    meterTap: fade,
    params: {},
    form: { fade: { param: fade.gain, mode: 'gain' } },
    update(d) {
      glide(input.gain, num(d, 'volume', 0.8), ctx);
      const next = num(d, 'ceiling', -3);
      if (next !== ceiling) {
        ceiling = next;
        glide(limiter.threshold, ceiling, ctx);
        clipper.curve = softClipCurve(ceiling);
      }
    },
    dispose() {
      [input, limiter, headroom, clipper, fade].forEach((n) => n.disconnect());
    },
  };
}

const FACTORIES: Record<AudioKind, (f: FactoryCtx, data: NodeData) => EngineNode> = {
  oscillator,
  noise,
  filter,
  gain,
  delay,
  reverb,
  lfo,
  randomWalk,
  master,
  fm: fmOperator,
  chorus,
  formant,
  loopVoice,
  tapeEcho,
};

export function createEngineNode(kind: AudioKind, f: FactoryCtx, data: NodeData): EngineNode {
  return FACTORIES[kind](f, data);
}
