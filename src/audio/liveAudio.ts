import type { AudioGraph } from '@/patch/types';
import { FeatureBus } from './featureBus';
import { AudioOutput, createAudioContext } from './output';
import { Player } from './player';

const LOOKAHEAD = 1.5;
const TICK_MS = 200;

export interface LiveAudio {
  player: Player;
  ctx: AudioContext;
  output: AudioOutput;
  features: FeatureBus;
  reconcile(graph: AudioGraph): void;
  close(): void;
}

/** Must be called from a user gesture so the browser allows playback. */
export async function startLiveAudio(): Promise<LiveAudio> {
  const ctx = createAudioContext('interactive');
  const output = new AudioOutput(ctx);
  try {
    await ctx.resume();
  } catch (err) {
    output.close();
    throw err;
  }
  const player = new Player(ctx, { destination: output.master, analyse: true, taps: 'all' });
  const features = new FeatureBus(() => player.computeFeatures());
  const tick = () => player.schedule(ctx.currentTime + LOOKAHEAD);
  const timer = setInterval(tick, TICK_MS);
  return {
    player,
    ctx,
    output,
    features,
    reconcile(graph) {
      player.reconcile(graph);
      tick();
    },
    close() {
      clearInterval(timer);
      features.close();
      player.dispose();
      output.close();
    },
  };
}
