import type { AudioGraph } from '@/patch/types';
import { Player } from './player';

const EDGE_FADE = 0.03;
/** Offline rendering pauses this often to build upcoming passes, mirroring the live scheduler. */
const TICK_SECONDS = 1;
const LOOKAHEAD = 1.5;
export const MAX_TAPS = 30;
const TOO_BIG = 'This browser could not set aside enough memory for the render. Try a shorter duration or a lower sample rate.';

export interface OfflineRender {
  mix: AudioBuffer;
  /** Mono signal of each requested node's analysis tap, sample-aligned with the mix. */
  taps: Map<string, Float32Array>;
}

/**
 * Renders the patch with the stereo mix on channels 0–1 and each tapped node on its own
 * extra channel, so analysis sees exactly what the live analyser would. `formOffset` starts the
 * render that many seconds into the form.
 */
export async function renderOffline(
  graph: AudioGraph,
  seconds: number,
  sampleRate: number,
  tapIds: string[] = [],
  formOffset = 0,
): Promise<OfflineRender> {
  if (tapIds.length > MAX_TAPS) throw new Error(`At most ${MAX_TAPS} modules can drive visuals at once.`);
  const length = Math.max(1, Math.round(seconds * sampleRate));
  const channels = 2 + tapIds.length;
  let ctx: OfflineAudioContext;
  try {
    ctx = new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate });
  } catch {
    throw new Error(TOO_BIG);
  }
  ctx.destination.channelCount = channels;
  ctx.destination.channelCountMode = 'explicit';
  ctx.destination.channelInterpretation = 'discrete';

  const merger = new ChannelMergerNode(ctx, { numberOfInputs: channels });
  merger.connect(ctx.destination);
  const mixIn = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  mixIn.connect(split);
  split.connect(merger, 0, 0);
  split.connect(merger, 1, 1);

  const player = new Player(ctx, { destination: mixIn, analyse: false, taps: tapIds, start: -formOffset });
  player.reconcile(graph);
  tapIds.forEach((id, i) => player.tap(id)?.connect(merger, 0, 2 + i));
  // Engines without offline suspend (older WebKit) get the whole score up front instead.
  const scheduleAll = () => player.schedule(seconds + LOOKAHEAD);
  if (typeof ctx.suspend !== 'function') {
    scheduleAll();
  } else {
    player.schedule(LOOKAHEAD);
    for (let t = TICK_SECONDS; t < seconds; t += TICK_SECONDS) {
      ctx
        .suspend(t)
        .then(() => {
          player.schedule(t + TICK_SECONDS + LOOKAHEAD);
          return ctx.resume();
        })
        .catch(scheduleAll);
    }
  }
  const rendered = await ctx.startRendering().catch(() => {
    throw new Error(TOO_BIG);
  });
  player.dispose();

  const mix = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
  const fade = Math.min(Math.floor(EDGE_FADE * sampleRate), Math.floor(length / 2));
  for (let ch = 0; ch < 2; ch++) {
    const data = rendered.getChannelData(ch).slice();
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      data[i] *= g;
      data[length - 1 - i] *= g;
    }
    mix.copyToChannel(data, ch);
  }
  const taps = new Map(tapIds.map((id, i) => [id, rendered.getChannelData(2 + i)]));
  return { mix, taps };
}

export function encodeWav16(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const view = new DataView(new ArrayBuffer(44 + dataSize));

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const chData = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, chData[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
