import type { AudioGraph } from '@/patch/types';
import { FeatureBus } from './featureBus';
import { AudioOutput, createAudioContext } from './output';
import { Player } from './player';

export const CROSSFADE_SECONDS = 8;
const LOOKAHEAD = 1.5;
const TICK_MS = 200;
const CURVE_POINTS = 64;
/** setValueCurveAtTime may not share its start time with the hold event before it. */
const CURVE_GAP = 0.005;

export interface Deck {
  id: number;
  player: Player;
  features: FeatureBus;
  gain: GainNode;
  /** Context time after which a faded-out deck is disposed; Infinity while it is the live deck. */
  retireAt: number;
}

const equalPower = (from: number, to: number) =>
  Float32Array.from({ length: CURVE_POINTS }, (_, i) => {
    const t = i / (CURVE_POINTS - 1);
    return to > from ? to * Math.sin((t * Math.PI) / 2) : from * Math.cos((t * Math.PI) / 2);
  });

/**
 * Endless playback: each drift plays on its own deck (a Player with its own engines) and a new
 * deck crossfades in over the old one, which is disposed once silent. Deck lifetimes follow the
 * audio clock, so pausing also pauses any fade in progress.
 */
export class EndlessAudio {
  readonly ctx: AudioContext;
  readonly output: AudioOutput;
  private decks: Deck[] = [];
  private nextId = 1;
  private timer: ReturnType<typeof setInterval>;
  private listeners = new Set<(decks: Deck[]) => void>();

  /** Must be called from a user gesture so the browser allows playback. */
  constructor() {
    this.ctx = createAudioContext('playback');
    this.output = new AudioOutput(this.ctx);
    void this.ctx.resume();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  get paused() {
    return this.output.paused;
  }

  get live(): Deck | null {
    return this.decks[this.decks.length - 1] ?? null;
  }

  subscribe(fn: (decks: Deck[]) => void): () => void {
    this.listeners.add(fn);
    fn([...this.decks]);
    return () => this.listeners.delete(fn);
  }

  /** Starts `graph` on a fresh deck, fading it in while every older deck fades out. */
  play(graph: AudioGraph, fade = CROSSFADE_SECONDS): Deck {
    const now = this.ctx.currentTime;
    const gain = new GainNode(this.ctx, { gain: fade > 0 ? 0 : 1 });
    gain.connect(this.output.master);
    const player = new Player(this.ctx, { destination: gain, analyse: true, taps: 'all' });
    player.reconcile(graph);
    player.schedule(now + LOOKAHEAD);
    if (fade > 0) gain.gain.setValueCurveAtTime(equalPower(0, 1), now + CURVE_GAP, fade);

    for (const old of this.decks) {
      if (old.retireAt !== Infinity) continue;
      const level = old.gain.gain.value;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(level, now);
      if (fade > 0) old.gain.gain.setValueCurveAtTime(equalPower(level, 0), now + CURVE_GAP, fade);
      else old.gain.gain.setValueAtTime(0, now + CURVE_GAP);
      old.retireAt = now + fade + 0.25;
    }

    const deck: Deck = { id: this.nextId++, player, features: new FeatureBus(() => player.computeFeatures()), gain, retireAt: Infinity };
    this.decks.push(deck);
    this.emit();
    return deck;
  }

  setPaused(paused: boolean) {
    return this.output.setPaused(paused);
  }

  close() {
    clearInterval(this.timer);
    for (const deck of this.decks) this.dispose(deck);
    this.decks = [];
    this.listeners.clear();
    this.output.close();
  }

  private tick() {
    const now = this.ctx.currentTime;
    const retired = this.decks.filter((d) => now > d.retireAt);
    if (retired.length) {
      retired.forEach((d) => this.dispose(d));
      this.decks = this.decks.filter((d) => !retired.includes(d));
      this.emit();
    }
    for (const deck of this.decks) deck.player.schedule(now + LOOKAHEAD);
  }

  private dispose(deck: Deck) {
    deck.features.close();
    deck.player.dispose();
    deck.gain.disconnect();
  }

  private emit() {
    const snapshot = [...this.decks];
    this.listeners.forEach((fn) => fn(snapshot));
  }
}
