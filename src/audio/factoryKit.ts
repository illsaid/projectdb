import type { NodeData } from '@/patch/types';
import type { LaneKey } from './form';
import type { GateSpans } from './loops';

/** A param a score can automate: 'gain' takes the multiplier directly, 'cents' takes it as a pitch ratio. */
export interface FormTarget {
  param: AudioParam;
  mode: 'gain' | 'cents';
}

export interface EngineNode {
  input: AudioNode | null;
  output: AudioNode | null;
  meterTap: AudioNode;
  params: Record<string, AudioParam>;
  /** Dedicated params reserved for score automation, so they never fight user edits or modulation. */
  form?: Partial<Record<LaneKey, FormTarget>>;
  /** Event-driven modules only: score spans in which new events may start. */
  setGate?(spans: GateSpans | null): void;
  update(data: NodeData): void;
  schedule?(until: number): void;
  dispose(): void;
}

export interface FactoryCtx {
  ctx: BaseAudioContext;
  id: string;
  seed: string;
  realtime: boolean;
  destination: AudioNode;
  /** Context time the engine's timeline starts at; sources start here so every pass sounds the same. */
  origin: number;
}

const SMOOTHING = 0.015;

export function glide(param: AudioParam, value: number, ctx: BaseAudioContext) {
  param.setTargetAtTime(value, ctx.currentTime, SMOOTHING);
}

export function stopSafely(node: AudioScheduledSourceNode) {
  try {
    node.stop();
  } catch {
    // already stopped
  }
}

export const startAt = (ctx: BaseAudioContext, origin: number) => Math.max(ctx.currentTime, origin);

/** A started ConstantSource: lets one modulatable AudioParam fan out to several destinations. */
export function constant(ctx: BaseAudioContext, offset: number, origin: number) {
  const node = new ConstantSourceNode(ctx, { offset });
  node.start(startAt(ctx, origin));
  return node;
}

/** Equal-sum crossfade: wet = mix, dry = 1 − mix, both driven by one modulatable signal. */
export function crossfade(ctx: BaseAudioContext, mix: number) {
  const mixSource = new ConstantSourceNode(ctx, { offset: mix });
  const scale = new GainNode(ctx, { gain: 1 });
  const one = new ConstantSourceNode(ctx, { offset: 1 });
  const invert = new GainNode(ctx, { gain: -1 });
  const dry = new GainNode(ctx, { gain: 0 });
  const wet = new GainNode(ctx, { gain: 0 });
  mixSource.connect(scale);
  scale.connect(wet.gain);
  scale.connect(invert).connect(dry.gain);
  one.connect(dry.gain);
  mixSource.start();
  one.start();
  return {
    dry,
    wet,
    mix: mixSource.offset,
    scale: scale.gain,
    dispose() {
      stopSafely(mixSource);
      stopSafely(one);
      [mixSource, scale, one, invert, dry, wet].forEach((n) => n.disconnect());
    },
  };
}
