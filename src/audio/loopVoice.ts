import { num, str } from '@/patch/definitions';
import type { NodeData } from '@/patch/types';
import { cachedBuffer } from './bufferCache';
import { EventScheduler } from './events';
import { glide, stopSafely, type EngineNode, type FactoryCtx } from './factoryKit';
import { gateOpen, loopSpec, loopSkips, noteTime, type GateSpans, type LoopSpec } from './loops';
import { rngFor } from './random';
import { contextPool, STEAL_FADE, VoicePool, type Voice } from './voicePool';

export const LOOP_TIMBRES = ['sine', 'bell', 'pad', 'breath'] as const;
export type LoopTimbre = (typeof LOOP_TIMBRES)[number];

/** Roughly evens out perceived loudness between timbres at the same level. */
const TIMBRE_GAIN: Record<LoopTimbre, number> = { sine: 1, bell: 0.9, pad: 0.55, breath: 1.3 };

interface Note {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

export function whiteNoise(ctx: BaseAudioContext, seed: string, id: string): AudioBuffer {
  return cachedBuffer(ctx, `breath:${seed}:${id}`, () => {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rng = rngFor(seed, id, 'breath');
    for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
    return buffer;
  });
}

export interface LoopNote {
  time: number;
  frequency: number;
  timbre: LoopTimbre;
  attack: number;
  release: number;
  velocity: number;
}

/** In room mode loops sound only every other cycle and never start faster than this. */
export const ROOM_MIN_ATTACK = 0.35;
/** Overlapping notes one loop may hold; long releases on a fast phrase would otherwise pile up. */
const NOTES_PER_LOOP = 6;

/** Freezes a param's automation at `t`, keeping its value there continuous. */
function holdAt(param: AudioParam, t: number, fallback: number) {
  if ('cancelAndHoldAtTime' in param) {
    param.cancelAndHoldAtTime(t);
  } else {
    (param as AudioParam).cancelScheduledValues(t);
    (param as AudioParam).linearRampToValueAtTime(fallback, t);
  }
}

/**
 * Starts one self-cleaning note voice into `dest` and enters it in every pool, so a full pool can
 * steal it. Returns a handle that cuts it short.
 */
export function playLoopNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  spec: LoopNote,
  noise: () => AudioBuffer,
  pools: VoicePool[],
  onEnded: () => void,
) {
  const { time, attack, release, timbre } = spec;
  const freq = Math.min(8000, spec.frequency);
  const velocity = spec.velocity * (TIMBRE_GAIN[timbre] ?? 1);
  const end = time + attack + release * 1.25;

  const env = new GainNode(ctx, { gain: 0 });
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(velocity, time + attack);
  env.gain.setTargetAtTime(0, time + attack, release / 4.5);
  env.connect(dest);
  const n: Note = { sources: [], nodes: [env] };
  const osc = (type: OscillatorType, frequency: number, detune = 0) => {
    const o = new OscillatorNode(ctx, { type, frequency, detune });
    n.sources.push(o);
    n.nodes.push(o);
    return o;
  };

  if (timbre === 'bell') {
    const carrier = osc('sine', freq);
    const mod = osc('sine', freq * 3.5);
    const depth = new GainNode(ctx, { gain: 0 });
    depth.gain.setValueAtTime(freq * 2.2, time);
    depth.gain.setTargetAtTime(freq * 0.15, time, Math.max(0.3, release / 6));
    mod.connect(depth).connect(carrier.frequency);
    carrier.connect(env);
    n.nodes.push(depth);
  } else if (timbre === 'pad') {
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.6, frequency: freq * 1.5 });
    lp.frequency.setValueAtTime(freq * 1.5, time);
    lp.frequency.linearRampToValueAtTime(Math.min(9000, freq * 4), time + attack);
    lp.frequency.setTargetAtTime(freq * 1.5, time + attack, release / 3);
    osc('sawtooth', freq, -7).connect(lp);
    osc('sawtooth', freq, 7).connect(lp);
    lp.connect(env);
    n.nodes.push(lp);
  } else if (timbre === 'breath') {
    const buffer = noise();
    const src = new AudioBufferSourceNode(ctx, { buffer, loop: true, loopStart: 0, loopEnd: buffer.duration });
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: freq, Q: 22 });
    const air = new GainNode(ctx, { gain: 2.6 });
    const tone = new GainNode(ctx, { gain: 0.35 });
    src.connect(bp).connect(air).connect(env);
    osc('sine', freq).connect(tone).connect(env);
    n.sources.push(src);
    n.nodes.push(src, bp, air, tone);
  } else {
    osc('sine', freq).connect(env);
  }

  const teardown = () => n.nodes.forEach((node) => node.disconnect());
  for (const s of n.sources) {
    s.start(time);
    s.stop(end);
  }
  n.sources[0].onended = () => {
    teardown();
    onEnded();
  };

  const voice: Voice = {
    start: time,
    end,
    release(at) {
      const t = Math.max(at, time, ctx.currentTime);
      const attackLevel = velocity * Math.min(1, (t - time) / Math.max(0.001, attack));
      holdAt(env.gain, t, attackLevel);
      env.gain.setTargetAtTime(0, t, STEAL_FADE / 4);
      for (const s of n.sources) {
        try {
          s.stop(t + STEAL_FADE * 1.5);
        } catch {
          // older engines refuse a second stop(); the original stop time still ends the note
        }
      }
    },
  };
  pools.forEach((p) => p.claim(voice));

  return {
    stop() {
      voice.end = -Infinity;
      n.sources.forEach(stopSafely);
      teardown();
    },
  };
}

type NoteHandle = ReturnType<typeof playLoopNote>;

/**
 * Plays a short phrase once per cycle, like a tape loop. Notes come from a look-ahead scheduler on
 * the audio clock; each note is its own short-lived voice, so long releases overlap freely.
 * The score can open and close the loop per section; a note that has started always rings out.
 */
export function loopVoice({ ctx, id, seed, origin }: FactoryCtx, data: NodeData): EngineNode {
  const bus = new GainNode(ctx, { gain: 1 });
  const level = new GainNode(ctx, { gain: num(data, 'level', 0.3) });
  const pan = new StereoPannerNode(ctx, { pan: num(data, 'pan', 0) });
  const section = new GainNode(ctx, { gain: 1 });
  bus.connect(level).connect(pan).connect(section);

  let current = data;
  let spec: LoopSpec = loopSpec(data);
  let gate: GateSpans | null = null;
  const getNoise = () => whiteNoise(ctx, seed, id);
  const live = new Set<NoteHandle>();
  const pools = [new VoicePool(NOTES_PER_LOOP), contextPool(ctx)];
  const makeScheduler = () => new EventScheduler((i) => origin + noteTime(spec, i));
  let scheduler = makeScheduler();

  const play = (time: number, index: number) => {
    if (loopSkips(spec, current, index)) return;
    const room = num(current, 'room') > 0;
    const note = spec.notes[index % spec.notes.length];
    const handle = playLoopNote(
      ctx,
      bus,
      {
        time,
        frequency: num(current, 'frequency', 523.25) * note.ratio,
        timbre: str(current, 'timbre', 'sine') as LoopTimbre,
        attack: Math.min(3, Math.max(room ? ROOM_MIN_ATTACK : 0.05, num(current, 'attack', 0.4))),
        release: Math.min(12, Math.max(1, num(current, 'release', 5))),
        velocity: 0.7 + 0.3 * rngFor(seed, id, 'velocity', index)(),
      },
      getNoise,
      pools,
      () => live.delete(handle),
    );
    live.add(handle);
  };

  return {
    input: null,
    output: section,
    meterTap: section,
    params: { level: level.gain, pan: pan.pan },
    form: { level: { param: section.gain, mode: 'gain' } },
    setGate(spans) {
      gate = spans;
    },
    update(d) {
      current = d;
      const next = loopSpec(d);
      if (JSON.stringify(next) !== JSON.stringify(spec)) {
        spec = next;
        scheduler = makeScheduler();
      }
      glide(level.gain, num(d, 'level', 0.3), ctx);
      glide(pan.pan, num(d, 'pan', 0), ctx);
    },
    schedule(until) {
      scheduler.pull(ctx.currentTime, until, (time, index) => {
        if (gateOpen(gate, time - origin)) play(time, index);
      });
    },
    dispose() {
      live.forEach((n) => n.stop());
      live.clear();
      [bus, level, pan, section].forEach((node) => node.disconnect());
    },
  };
}
