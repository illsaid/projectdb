/** A sounding note as the pools see it: when it starts, when it falls silent, and how to cut it short. */
export interface Voice {
  start: number;
  end: number;
  release(at: number): void;
}

/** Seconds a stolen voice takes to fade out. */
export const STEAL_FADE = 0.05;
/** Notes the whole context may hold at once; roughly what a mid-range phone renders at under half load. */
const CONTEXT_VOICES = 24;

/**
 * Caps how many notes overlap. Notes are judged by their own start time, so a new note only
 * competes with notes already sounding at that moment; when the pool is full the oldest of those
 * is faded out over STEAL_FADE.
 */
export class VoicePool {
  private voices: Voice[] = [];

  constructor(private limit: number) {}

  claim(voice: Voice) {
    const t = voice.start;
    this.voices = this.voices.filter((v) => v.end > t);
    const sounding = this.voices.filter((v) => v.start <= t);
    if (sounding.length >= this.limit) {
      const oldest = sounding.reduce((a, b) => (b.start < a.start ? b : a));
      oldest.release(t);
      oldest.end = t;
    }
    this.voices.push(voice);
  }
}

const shared = new WeakMap<BaseAudioContext, VoicePool>();

/** The pool every note on this context also joins, so many loops together stay within budget. */
export function contextPool(ctx: BaseAudioContext): VoicePool {
  let pool = shared.get(ctx);
  if (!pool) {
    pool = new VoicePool(CONTEXT_VOICES);
    shared.set(ctx, pool);
  }
  return pool;
}
