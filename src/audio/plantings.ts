import { EventScheduler } from './events';
import { playLoopNote, ROOM_MIN_ATTACK, whiteNoise } from './loopVoice';
import { contextPool, VoicePool } from './voicePool';

export const PLANT_TIMBRES = ['sine', 'bell'] as const;

/** A note the listener planted; times are seconds after playback started. */
export interface Planting {
  at: number;
  frequency: number;
  /** Seconds between repeats. */
  cycle: number;
  /** Seconds until the note has faded away completely. */
  fade: number;
  pan: number;
  timbre: (typeof PLANT_TIMBRES)[number];
}

const PLANT_LEVEL = 0.16;
const ATTACK = 0.08;
const RELEASE = 7;
const MAX_NOTES = 8;

export const plantRepeats = (p: Planting) => Math.ceil(p.fade / p.cycle);
export const plantNoteTime = (p: Planting, index: number) => (index < plantRepeats(p) ? p.at + index * p.cycle : Infinity);
/** In room mode a planting, like a loop, sounds only every other cycle. */
export const plantSkips = (index: number, room: boolean) => room && index % 2 === 1;

/** How loud a planting still is at time t, easing from 1 to 0 over its fade. */
export function plantLevel(p: Planting, t: number): number {
  if (t < p.at) return 0;
  const left = 1 - (t - p.at) / p.fade;
  return left <= 0 ? 0 : left * left;
}

const plantKey = (p: Planting) => `${p.at}:${p.frequency}:${p.cycle}`;

interface Voice {
  planting: Planting;
  scheduler: EventScheduler;
  pan: StereoPannerNode;
}

/**
 * Plays planted notes on the audio clock, anchored to the moment playback started, so a stored
 * set of plantings replays exactly as it was planted.
 */
export class PlantLayer {
  readonly output: GainNode;
  private voices = new Map<string, Voice>();
  private live = new Set<{ stop(): void }>();
  private start = 0;
  private room = false;
  private transpose = 1;
  private pools: VoicePool[];

  constructor(private ctx: BaseAudioContext) {
    this.output = new GainNode(ctx, { gain: PLANT_LEVEL });
    this.pools = [new VoicePool(MAX_NOTES), contextPool(ctx)];
  }

  set(plantings: Planting[], start: number, room: boolean, transpose = 1) {
    this.room = room;
    this.transpose = transpose;
    if (start !== this.start) {
      this.clear();
      this.start = start;
    }
    const keep = new Set(plantings.map(plantKey));
    for (const [key, voice] of this.voices) {
      if (keep.has(key)) continue;
      voice.pan.disconnect();
      this.voices.delete(key);
    }
    for (const p of plantings) {
      const key = plantKey(p);
      if (this.voices.has(key)) continue;
      const pan = new StereoPannerNode(this.ctx, { pan: Math.max(-1, Math.min(1, p.pan)) });
      pan.connect(this.output);
      this.voices.set(key, { planting: p, pan, scheduler: new EventScheduler((i) => this.start + plantNoteTime(p, i)) });
    }
  }

  schedule(until: number) {
    const now = this.ctx.currentTime;
    for (const { planting: p, scheduler, pan } of this.voices.values()) {
      scheduler.pull(now, until, (time, index) => {
        if (plantSkips(index, this.room)) return;
        const level = plantLevel(p, time - this.start);
        if (level < 0.01) return;
        const handle = playLoopNote(
          this.ctx,
          pan,
          {
            time,
            frequency: p.frequency * this.transpose,
            timbre: p.timbre,
            attack: this.room ? ROOM_MIN_ATTACK : ATTACK,
            release: RELEASE,
            velocity: level,
          },
          () => whiteNoise(this.ctx, 'plant', 'plant'),
          this.pools,
          () => this.live.delete(handle),
        );
        this.live.add(handle);
      });
    }
  }

  dispose() {
    this.clear();
    this.output.disconnect();
  }

  private clear() {
    this.live.forEach((n) => n.stop());
    this.live.clear();
    for (const v of this.voices.values()) v.pan.disconnect();
    this.voices.clear();
  }
}
