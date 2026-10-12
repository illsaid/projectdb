import { num } from '@/patch/definitions';
import type { NodeData } from '@/patch/types';
import { crossfade, glide, startAt, stopSafely, type EngineNode, type FactoryCtx } from './factoryKit';
import { cachedBuffer } from './bufferCache';
import { rngFor } from './random';

const MAX_FEEDBACK = 0.97;
const WOW_CENTS = 6;
const FLUTTER_CENTS = 2;
/** The saturator's curve covers ±DRIVE_RANGE, so loud repeats bend smoothly instead of clipping. */
const DRIVE_RANGE = 4;

/**
 * A sine on the delay time at rate f with depth A seconds bends pitch by up to 2πfA,
 * so the depth that gives a fixed cents swing shrinks as the rate rises.
 */
const depthFor = (cents: number, rate: number) => (2 ** (cents / 1200) - 1) / (2 * Math.PI * Math.max(0.01, rate));

const wearCutoff = (wear: number) => 16000 * 0.12 ** Math.min(1, Math.max(0, wear));
const hissLevel = (wear: number, feedback: number) => wear * 0.02 * (1 - Math.min(MAX_FEEDBACK, feedback));

function tanhCurve(): Float32Array {
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * DRIVE_RANGE);
  return curve;
}

function hiss(ctx: BaseAudioContext, seed: string, id: string): AudioBuffer {
  return cachedBuffer(ctx, `hiss:${seed}:${id}`, () => {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 3), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rng = rngFor(seed, id, 'hiss');
    for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
    return buffer;
  });
}

/**
 * Long tape-style echo. Every repeat passes through wow and flutter (delay-time modulation),
 * a tanh saturator with unity small-signal gain, a tone lowpass and a wear lowpass, so repeats
 * darken as they pile up. The saturator bounds the loop, so even full feedback cannot run away.
 */
export function tapeEcho({ ctx, id, seed, origin }: FactoryCtx, data: NodeData): EngineNode {
  const xf = crossfade(ctx, num(data, 'mix', 0.3));
  const input = new GainNode(ctx);
  const dryTap = new DelayNode(ctx, { maxDelayTime: 0.01, delayTime: 0 });
  const sum = new GainNode(ctx);
  const line = new DelayNode(ctx, { maxDelayTime: 8.5, delayTime: num(data, 'time', 3) });
  const pre = new GainNode(ctx, { gain: 1 / DRIVE_RANGE });
  const sat = new WaveShaperNode(ctx, { curve: tanhCurve(), oversample: '2x' });
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: num(data, 'tone', 3200), Q: 0.5 });
  const worn = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: wearCutoff(num(data, 'wear', 0.3)), Q: 0.4 });
  const fb = new GainNode(ctx, { gain: Math.min(MAX_FEEDBACK, num(data, 'feedback', 0.6)) });
  const fbForm = new GainNode(ctx, { gain: 1 });
  const out = new GainNode(ctx);

  input.connect(dryTap).connect(xf.dry).connect(out);
  input.connect(sum).connect(line).connect(pre).connect(sat).connect(tone).connect(worn);
  worn.connect(fb).connect(fbForm).connect(sum);
  worn.connect(xf.wet).connect(out);

  const start = startAt(ctx, origin);
  const wow = new OscillatorNode(ctx, { frequency: num(data, 'wow', 0.4) });
  const wowDepth = new GainNode(ctx, { gain: depthFor(WOW_CENTS, num(data, 'wow', 0.4)) });
  const flutter = new OscillatorNode(ctx, { frequency: num(data, 'flutter', 8) });
  const flutterDepth = new GainNode(ctx, { gain: depthFor(FLUTTER_CENTS, num(data, 'flutter', 8)) });
  wow.connect(wowDepth).connect(line.delayTime);
  flutter.connect(flutterDepth).connect(line.delayTime);

  const noise = new AudioBufferSourceNode(ctx, { buffer: hiss(ctx, seed, id), loop: true });
  const noiseGain = new GainNode(ctx, { gain: hissLevel(num(data, 'wear', 0.3), num(data, 'feedback', 0.6)) });
  noise.connect(noiseGain).connect(sum);
  [wow, flutter, noise].forEach((s) => s.start(start));

  return {
    input,
    output: out,
    meterTap: out,
    params: { time: line.delayTime, feedback: fb.gain, mix: xf.mix },
    form: { delayFeedback: { param: fbForm.gain, mode: 'gain' } },
    update(d) {
      const feedback = Math.min(MAX_FEEDBACK, num(d, 'feedback', 0.6));
      const wear = num(d, 'wear', 0.3);
      glide(line.delayTime, num(d, 'time', 3), ctx);
      glide(fb.gain, feedback, ctx);
      glide(xf.mix, num(d, 'mix', 0.3), ctx);
      glide(tone.frequency, num(d, 'tone', 3200), ctx);
      glide(worn.frequency, wearCutoff(wear), ctx);
      glide(noiseGain.gain, hissLevel(wear, feedback), ctx);
      glide(wow.frequency, num(d, 'wow', 0.4), ctx);
      glide(wowDepth.gain, depthFor(WOW_CENTS, num(d, 'wow', 0.4)), ctx);
      glide(flutter.frequency, num(d, 'flutter', 8), ctx);
      glide(flutterDepth.gain, depthFor(FLUTTER_CENTS, num(d, 'flutter', 8)), ctx);
    },
    dispose() {
      [wow, flutter, noise].forEach(stopSafely);
      xf.dispose();
      [input, dryTap, sum, line, pre, sat, tone, worn, fb, fbForm, out, wow, wowDepth, flutter, flutterDepth, noise, noiseGain].forEach((n) =>
        n.disconnect(),
      );
    },
  };
}
