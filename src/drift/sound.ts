import { between, intBetween, pick, rngFor, shuffle, weighted, type Rng } from '@/audio/random';
import { formatPhrase, type PhraseNote } from '@/audio/loops';
import type { LoopTimbre } from '@/audio/loopVoice';
import { modulationScale, num, VOWELS } from '@/patch/definitions';
import { paramHandleId, type NodeKind, type SeedHex } from '@/patch/types';
import { PatchBuilder } from './builder';
import { cycleLengths } from './cycles';
import type { Archetype, Brightness, Traits } from './traits';

const COL = { mod: 0, source: 1, shape: 2, fx1: 3, fx2: 4, master: 5 } as const;

type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface ModulatorRole {
  id: string;
  kind: 'lfo' | 'randomWalk';
  rate: number;
}

/** What each generated module is for, so the visual layer can route by meaning. */
export interface SoundRoles {
  voices: { id: string; level: number }[];
  noises: string[];
  modulators: ModulatorRole[];
  pulse: string | null;
}

export interface Sound {
  nodes: PatchBuilder['nodes'];
  edges: PatchBuilder['edges'];
  roles: SoundRoles;
}

const ROOT_MIDI: Record<Archetype, [number, number]> = {
  drone: [31, 43],
  texture: [45, 57],
  pulse: [33, 45],
  swell: [40, 52],
  field: [55, 67],
  bells: [57, 69],
  choir: [45, 55],
  tides: [36, 48],
  machine: [33, 45],
  airports: [57, 64],
};
const REGISTER_SHIFT: Record<Brightness, number> = { dark: -5, balanced: 0, bright: 7 };

const SCALES = [
  [0, 3, 5, 7, 10],
  [0, 2, 4, 7, 9],
  [0, 2, 3, 5, 7, 9, 10],
  [0, 2, 4, 6, 7, 9, 11],
  [0, 2, 5, 7],
  [0, 1, 5, 7, 8],
];
const RATIO_SETS = [
  [1, 3 / 2, 2, 3, 4],
  [1, 5 / 4, 3 / 2, 2, 5 / 2],
  [1, 7 / 4, 2, 9 / 4, 3],
  [1, 4 / 3, 2, 8 / 3, 3],
];
const RATIO_ODDS: Record<Archetype, number> = {
  drone: 0.6,
  swell: 0.6,
  field: 0.3,
  texture: 0.15,
  pulse: 0.15,
  bells: 0.5,
  choir: 0.2,
  tides: 0.3,
  machine: 0.1,
  airports: 0,
};
const OCTAVE_SPREAD: Record<Archetype, number> = { drone: 1, swell: 2, field: 1, texture: 1, pulse: 1, bells: 2, choir: 1, tides: 1, machine: 1, airports: 1 };

/** Open note sets with no semitone steps, so any two phrase notes stay consonant. */
const LOOP_SCALES = [
  [0, 2, 4, 7, 9],
  [0, 2, 5, 7, 9],
  [0, 3, 5, 7, 10],
  [0, 4, 7, 9],
  [0, 5, 7, 10],
];
const LOOP_TIMBRE_WEIGHTS: Record<LoopTimbre, number> = { sine: 3, bell: 3, pad: 2, breath: 1.5 };
const LOOP_MAX_MIDI = 93;

/** Modulator-to-carrier ratios with the inharmonic partials that make FM read as struck metal. */
const BELL_RATIOS = [1.4, 2.76, 3.5, 1.41, 5.4, 2.0, 3.14];
const BELL_INDEX: Record<Brightness, [number, number]> = { dark: [1, 2.5], balanced: [2, 4], bright: [3.5, 6] };

const WAVE_WEIGHTS: Record<Brightness, Record<Wave, number>> = {
  dark: { sine: 3, triangle: 3, sawtooth: 1, square: 0.5 },
  balanced: { sine: 2, triangle: 2, sawtooth: 2, square: 1 },
  bright: { sine: 1, triangle: 1, sawtooth: 3, square: 2 },
};
/** Scales each waveform to roughly the RMS of a sawtooth at the same level. */
const WAVE_RMS_COMP: Record<Wave, number> = { sine: 0.82, triangle: 1, sawtooth: 1, square: 0.58 };

const CUTOFF: Record<Brightness, [number, number]> = { dark: [280, 850], balanced: [850, 2400], bright: [2200, 6000] };
const VOICE_BUDGET = 0.32;

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const clampHz = (f: number) => Math.min(3800, Math.max(24, f));
const round = (v: number, d = 4) => Number(v.toFixed(d));

function pitches(rng: Rng, archetype: Archetype, brightness: Brightness, count: number): number[] {
  const [lo, hi] = ROOT_MIDI[archetype];
  const root = intBetween(rng, lo, hi) + REGISTER_SHIFT[brightness];
  const rootHz = midiHz(root);
  if (rng() < RATIO_ODDS[archetype]) {
    const set = pick(rng, RATIO_SETS);
    const rest = shuffle(rng, set.slice(1));
    return [1, ...rest].slice(0, count).map((r) => clampHz(rootHz * r));
  }
  const scale = pick(rng, SCALES);
  const used = new Set<number>([0]);
  const out = [rootHz];
  for (let guard = 0; out.length < count && guard < 64; guard++) {
    const semis = pick(rng, scale) + 12 * intBetween(rng, 0, OCTAVE_SPREAD[archetype]);
    if (used.has(semis)) continue;
    used.add(semis);
    out.push(clampHz(midiHz(root + semis)));
  }
  return out;
}

class SoundBuilder {
  readonly b = new PatchBuilder();
  readonly roles: SoundRoles = { voices: [], noises: [], modulators: [], pulse: null };

  constructor(
    readonly rng: Rng,
    readonly traits: Traits,
  ) {}

  oscillators(count: number, waves: Record<Wave, number> = WAVE_WEIGHTS[this.traits.brightness], gainScale = 1): string[] {
    const { rng, traits } = this;
    const freqs = pitches(rng, traits.archetype, traits.brightness, count);
    const perVoice = (VOICE_BUDGET * gainScale) / Math.sqrt(count);
    return freqs.map((frequency) => {
      const wave = weighted(rng, waves);
      const level = round(perVoice * WAVE_RMS_COMP[wave] * between(rng, 0.7, 1), 3);
      const detune = Math.round(between(rng, -7, 7));
      const id = this.b.add('oscillator', COL.source, { wave, frequency: round(frequency, 2), detune, level });
      this.roles.voices.push({ id, level });
      return id;
    });
  }

  /** Struck FM operators. Sparse strikes average far below their peak, so they get a larger level budget. */
  bells(count: number): string[] {
    const { rng, traits } = this;
    const freqs = pitches(rng, traits.archetype, traits.brightness, count);
    const perVoice = 0.6 / Math.sqrt(count);
    return freqs.map((frequency) => {
      const level = round(perVoice * between(rng, 0.75, 1), 3);
      const id = this.b.add('fm', COL.source, {
        env: 'strike',
        frequency: round(frequency, 2),
        ratio: pick(rng, BELL_RATIOS),
        index: round(between(rng, ...BELL_INDEX[traits.brightness]), 2),
        detune: Math.round(between(rng, -4, 4)),
        level,
        density: round(between(rng, 0.14, 0.45), 2),
        decay: round(between(rng, 2.5, 7), 1),
      });
      this.roles.voices.push({ id, level });
      return id;
    });
  }

  /**
   * Tape-loop voices: each repeats a 1–4 note phrase from one shared consonant scale on its own
   * irrational-ratio cycle. The first voice starts within a few seconds so the drift opens with a note.
   */
  loops(count: number): { ids: string[]; rootMidi: number } {
    const { rng, traits } = this;
    const [lo, hi] = ROOT_MIDI.airports;
    const rootMidi = intBetween(rng, lo, hi) + REGISTER_SHIFT[traits.brightness];
    const scale = pick(rng, LOOP_SCALES);
    const midiOf = (deg: number) => rootMidi + scale[deg % scale.length] + 12 * Math.floor(deg / scale.length);
    const cycles = cycleLengths(rng, count);
    const perVoice = 0.42 / Math.sqrt(count);
    const ids = cycles.map((cycle, i) => {
      let deg = intBetween(rng, 0, scale.length * 2 - 1);
      while (deg > 0 && midiOf(deg) > LOOP_MAX_MIDI) deg--;
      const baseHz = midiHz(midiOf(deg));
      const noteCount = Number(weighted(rng, { 1: 2, 2: 3, 3: 2, 4: 1 }));
      const notes: PhraseNote[] = [{ ratio: 1, at: 0 }];
      let at = 0;
      for (let n = 1; n < noteCount; n++) {
        at += between(rng, 0.5, 2.6);
        if (at > cycle * 0.6) break;
        deg = Math.max(0, deg + pick(rng, [-2, -1, 1, 1, 2, 3]));
        while (deg > 0 && midiOf(deg) > LOOP_MAX_MIDI) deg--;
        notes.push({ ratio: round(midiHz(midiOf(deg)) / baseHz, 5), at: round(at, 2) });
      }
      const timbre = weighted(rng, LOOP_TIMBRE_WEIGHTS);
      const level = round(perVoice * between(rng, 0.8, 1), 3);
      const spread = count > 1 ? i / (count - 1) : 0.5;
      const id = this.b.add('loopVoice', COL.source, {
        timbre,
        frequency: round(baseHz, 2),
        phrase: formatPhrase(notes),
        cycle,
        phase: round(i === 0 ? between(rng, 0, Math.min(0.5, 3 / cycle)) : rng(), 3),
        attack: round(timbre === 'pad' ? between(rng, 0.8, 3) : between(rng, 0.05, 1.2), 2),
        release: round(timbre === 'bell' ? between(rng, 5, 12) : between(rng, 3, 10), 1),
        level,
        pan: round((spread * 2 - 1) * 0.7 + between(rng, -0.1, 0.1), 2),
      });
      this.roles.voices.push({ id, level });
      return id;
    });
    return { ids, rootMidi };
  }

  formant(morph: number, q: number, level: number) {
    return this.b.add('formant', COL.shape, { vowel: pick(this.rng, VOWELS), morph: round(morph, 3), q: round(q, 1), level: round(level, 2) });
  }

  chorus(rate: number, depth: number, mix: number, column: number = COL.fx1) {
    return this.b.add('chorus', column, { voices: pick(this.rng, ['2', '3', '3']), rate: round(rate, 2), depth: round(depth, 2), mix: round(mix, 2) });
  }

  noise(level: number, color = pick(this.rng, ['white', 'pink'])): string {
    const id = this.b.add('noise', COL.source, { color, level: round(level, 3) });
    this.roles.voices.push({ id, level });
    this.roles.noises.push(id);
    return id;
  }

  level(id: string): number {
    return num(this.b.data(id), 'level');
  }

  cutoff(scale = 1): number {
    const [lo, hi] = CUTOFF[this.traits.brightness];
    return Math.round(Math.exp(between(this.rng, Math.log(lo), Math.log(hi))) * scale);
  }

  /** Modulates `key` on `target` so it swings by at most `swing` in the target's own units. */
  modulate(source: { kind: 'lfo'; shape: Wave; rate: number } | { kind: 'randomWalk'; rate: number; step: number }, target: string, kind: NodeKind, key: string, swing: number) {
    const scale = modulationScale(kind, key);
    if (!scale) throw new Error(`${kind}.${key} is not modulatable`);
    const amount = round(Math.min(1, Math.max(0, swing / scale)), 5);
    const rate = round(source.rate, 3);
    const id =
      source.kind === 'lfo'
        ? this.b.add('lfo', COL.mod, { shape: source.shape, rate, depth: amount })
        : this.b.add('randomWalk', COL.mod, { rate, step: round(source.step, 2), range: amount });
    this.b.wire(id, target, paramHandleId(key));
    this.roles.modulators.push({ id, kind: source.kind, rate });
    return id;
  }

  slowLfo(lo = 0.012, hi = 0.09) {
    return { kind: 'lfo' as const, shape: pick<Wave>(this.rng, ['sine', 'triangle']), rate: between(this.rng, lo, hi) };
  }

  slowWalk(lo = 0.08, hi = 0.45) {
    return { kind: 'randomWalk' as const, rate: between(this.rng, lo, hi), step: between(this.rng, 0.15, 0.35) };
  }

  filter(mode: 'lowpass' | 'highpass' | 'bandpass', frequency: number, q: number, column: number = COL.shape) {
    return this.b.add('filter', column, { mode, frequency, q: round(q, 2) });
  }

  delay(time: number, feedback: number, mix: number, column: number = COL.fx1) {
    return this.b.add('delay', column, { time: round(Math.min(1.9, Math.max(0.03, time)), 3), feedback: round(feedback, 2), mix: round(mix, 2) });
  }

  tapeEcho(time: [number, number], feedback: [number, number], mix: [number, number], column: number = COL.fx2) {
    const { rng } = this;
    return this.b.add('tapeEcho', column, {
      time: round(between(rng, ...time), 2),
      feedback: round(between(rng, ...feedback), 2),
      mix: round(between(rng, ...mix), 2),
      tone: Math.round(between(rng, 1800, 3800)),
      wear: round(between(rng, 0.15, 0.6), 2),
      wow: round(between(rng, 0.2, 0.7), 2),
      flutter: round(between(rng, 6, 11), 1),
    });
  }

  reverb(decay: number, mix: number, column: number = COL.fx2) {
    return this.b.add('reverb', column, { decay: round(decay, 1), mix: round(mix, 2) });
  }

  chain(...ids: (string | null)[]) {
    const present = ids.filter((id): id is string => id !== null);
    for (let i = 0; i < present.length - 1; i++) this.b.wire(present[i], present[i + 1]);
  }

  master(volume: number) {
    return this.b.add('master', COL.master, { volume: round(volume, 2), ceiling: round(between(this.rng, -3, -1.5), 1) });
  }
}

type Topology = (s: SoundBuilder) => void;

const drone: Topology = (s) => {
  const { rng } = s;
  const voices = s.oscillators(intBetween(rng, 2, 4));
  const cutoff = s.cutoff(0.8);
  const f = s.filter('lowpass', cutoff, between(rng, 0.7, 5));
  voices.forEach((v) => s.b.wire(v, f));
  s.modulate(s.slowLfo(), f, 'filter', 'frequency', cutoff * between(rng, 0.25, 0.5));
  for (const v of voices.slice(0, 2)) s.modulate(s.slowWalk(), v, 'oscillator', 'detune', between(rng, 3, 8));
  const d = rng() < 0.35 ? s.delay(between(rng, 0.4, 1.2), between(rng, 0.3, 0.55), between(rng, 0.15, 0.3)) : null;
  const rv = s.reverb(between(rng, 5, 9), between(rng, 0.45, 0.6));
  s.chain(f, d, rv, s.master(between(rng, 0.8, 0.95)));
};

const texture: Topology = (s) => {
  const { rng } = s;
  const noiseCount = intBetween(rng, 1, 2);
  const noises = Array.from({ length: noiseCount }, () => s.noise(between(rng, 0.45, 0.75)));
  const voices = s.oscillators(intBetween(rng, 1, 2), WAVE_WEIGHTS[s.traits.brightness], 0.7);
  const bpFreq = s.cutoff();
  const bp = s.filter('bandpass', bpFreq, between(rng, 1.2, 5));
  noises.forEach((n) => s.b.wire(n, bp));
  const lpFreq = s.cutoff(0.9);
  const lp = s.filter('lowpass', lpFreq, between(rng, 0.7, 3));
  voices.forEach((v) => s.b.wire(v, lp));
  s.modulate(s.slowWalk(0.1, 0.6), bp, 'filter', 'frequency', bpFreq * between(rng, 0.3, 0.5));
  s.modulate(s.slowLfo(0.02, 0.15), noises[0], 'noise', 'level', s.level(noises[0]) * between(rng, 0.3, 0.5));
  s.modulate(s.slowLfo(), lp, 'filter', 'frequency', lpFreq * between(rng, 0.2, 0.4));
  const d = s.delay(between(rng, 0.15, 0.7), between(rng, 0.35, 0.6), between(rng, 0.25, 0.4));
  s.b.wire(bp, d);
  s.b.wire(lp, d);
  const rv = s.reverb(between(rng, 3, 6), between(rng, 0.35, 0.5));
  s.chain(d, rv, s.master(between(rng, 0.85, 1)));
};

const pulse: Topology = (s) => {
  const { rng } = s;
  const voices = s.oscillators(intBetween(rng, 2, 3), { sine: 1, triangle: 2, sawtooth: 3, square: 3 });
  const cutoff = s.cutoff(0.7);
  const f = s.filter('lowpass', cutoff, between(rng, 3, 10));
  voices.forEach((v) => s.b.wire(v, f));
  const vca = s.b.add('gain', COL.shape, { gain: 0.5 });
  s.roles.pulse = vca;
  const rate = between(rng, 1.2, 4.5);
  const beat = s.modulate({ kind: 'lfo', shape: pick<Wave>(rng, ['square', 'square', 'triangle']), rate }, vca, 'gain', 'gain', 0.5);
  s.modulate({ kind: 'randomWalk', rate: between(rng, 2, 8), step: between(rng, 0.3, 0.6) }, f, 'filter', 'frequency', cutoff * between(rng, 0.15, 0.3));
  s.modulate(s.slowLfo(0.02, 0.06), beat, 'lfo', 'rate', rate * between(rng, 0.1, 0.25));
  const d = s.delay((1 / rate) * pick(rng, [0.375, 0.5, 0.75, 1.5]), between(rng, 0.3, 0.55), between(rng, 0.2, 0.35));
  const rv = s.reverb(between(rng, 1.5, 3.5), between(rng, 0.2, 0.35));
  s.chain(f, vca, d, rv, s.master(between(rng, 0.95, 1.15)));
};

const swell: Topology = (s) => {
  const { rng } = s;
  const voices = s.oscillators(intBetween(rng, 3, 5));
  const cutoff = s.cutoff();
  const f = s.filter('lowpass', cutoff, between(rng, 0.7, 3), COL.fx1);
  for (const v of voices) {
    const g = s.b.add('gain', COL.shape, { gain: 0.5 });
    s.b.wire(v, g);
    s.b.wire(g, f);
    s.modulate(s.slowLfo(0.015, 0.11), g, 'gain', 'gain', between(rng, 0.35, 0.48));
  }
  const rv = s.reverb(between(rng, 6, 10), between(rng, 0.5, 0.65), COL.fx2);
  const d = rng() < 0.4 ? s.delay(between(rng, 0.4, 1.2), between(rng, 0.4, 0.6), between(rng, 0.2, 0.3), COL.fx2) : null;
  const tape = rng() < 0.25 ? s.tapeEcho([2, 6], [0.5, 0.75], [0.2, 0.3], COL.fx1) : null;
  s.chain(f, tape, rv, d, s.master(between(rng, 0.95, 1.15)));
};

const field: Topology = (s) => {
  const { rng } = s;
  const hiss = s.noise(between(rng, 0.25, 0.45), 'pink');
  const voices = s.oscillators(intBetween(rng, 1, 4), { sine: 4, triangle: 3, sawtooth: 0.5, square: 0.2 }, 0.85);
  const hp = s.filter('highpass', Math.round(between(rng, 300, 1400)), between(rng, 0.5, 2));
  s.b.wire(hiss, hp);
  const cutoff = s.cutoff();
  const lp = s.filter('lowpass', cutoff, between(rng, 0.7, 4));
  voices.forEach((v) => s.b.wire(v, lp));
  s.modulate(s.slowWalk(0.15, 0.7), lp, 'filter', 'frequency', cutoff * between(rng, 0.3, 0.5));
  s.modulate(s.slowLfo(0.02, 0.12), hiss, 'noise', 'level', s.level(hiss) * between(rng, 0.3, 0.5));
  for (const v of voices.slice(0, 2)) {
    s.modulate(s.slowWalk(0.1, 0.5), v, 'oscillator', 'level', s.level(v) * between(rng, 0.3, 0.5));
  }
  const d = s.delay(between(rng, 0.5, 1.4), between(rng, 0.5, 0.7), between(rng, 0.3, 0.45));
  s.b.wire(hp, d);
  s.b.wire(lp, d);
  const rv = s.reverb(between(rng, 4, 8), between(rng, 0.45, 0.6));
  s.chain(d, rv, s.master(between(rng, 0.85, 1)));
};

const bells: Topology = (s) => {
  const { rng } = s;
  const ops = s.bells(intBetween(rng, 3, 5));
  s.roles.pulse = ops[0];
  const cutoff = s.cutoff(1.6);
  const lp = s.filter('lowpass', Math.min(9000, cutoff), between(rng, 0.5, 1.5));
  ops.forEach((o) => s.b.wire(o, lp));
  for (const o of ops.slice(0, 2)) s.modulate(s.slowWalk(0.05, 0.25), o, 'fm', 'index', between(rng, 0.6, 1.4));
  s.modulate(s.slowLfo(), lp, 'filter', 'frequency', cutoff * between(rng, 0.2, 0.35));
  const d = rng() < 0.45 ? s.delay(between(rng, 0.5, 1.4), between(rng, 0.3, 0.5), between(rng, 0.15, 0.25)) : null;
  const rv = s.reverb(between(rng, 7, 10), between(rng, 0.5, 0.65));
  s.chain(lp, d, rv, s.master(between(rng, 0.9, 1.05)));
};

const choir: Topology = (s) => {
  const { rng } = s;
  const voices = s.oscillators(intBetween(rng, 3, 5), { sine: 0, triangle: 0, sawtooth: 1, square: 0 }, 1.3);
  for (const v of voices) s.b.data(v).detune = Math.round(between(rng, -14, 14));
  const vox = s.formant(between(rng, 0.1, 0.4), between(rng, 8, 14), between(rng, 2.2, 3));
  voices.forEach((v) => s.b.wire(v, vox));
  s.modulate({ kind: 'randomWalk', rate: between(rng, 0.05, 0.2), step: between(rng, 0.15, 0.3) }, vox, 'formant', 'morph', between(rng, 0.3, 0.5));
  for (const v of voices.slice(0, 3)) s.modulate(s.slowWalk(0.1, 0.4), v, 'oscillator', 'detune', between(rng, 4, 10));
  const ch = s.chorus(between(rng, 0.2, 0.6), between(rng, 0.3, 0.6), between(rng, 0.4, 0.5));
  s.modulate(s.slowLfo(0.015, 0.06), ch, 'chorus', 'depth', between(rng, 0.1, 0.2));
  const rv = s.reverb(between(rng, 5, 8), between(rng, 0.45, 0.6));
  s.chain(vox, ch, rv, s.master(between(rng, 0.9, 1.05)));
};

const tides: Topology = (s) => {
  const { rng } = s;
  const deep = s.noise(between(rng, 0.5, 0.7), 'pink');
  const surf = s.noise(between(rng, 0.35, 0.55), 'pink');
  const lowFreq = Math.round(s.cutoff(0.45));
  const low = s.filter('lowpass', lowFreq, between(rng, 4, 9));
  const bandFreq = Math.round(s.cutoff(0.9));
  const band = s.filter('bandpass', bandFreq, between(rng, 3, 7));
  s.b.wire(deep, low);
  s.b.wire(surf, band);
  s.modulate(s.slowLfo(0.02, 0.06), low, 'filter', 'frequency', lowFreq * between(rng, 0.4, 0.6));
  s.modulate(s.slowLfo(0.025, 0.07), band, 'filter', 'frequency', bandFreq * between(rng, 0.4, 0.6));
  const swellGain = s.b.add('gain', COL.fx1, { gain: 0.55 });
  s.b.wire(low, swellGain);
  s.b.wire(band, swellGain);
  const waveRate = between(rng, 0.07, 0.14);
  const wave = s.modulate({ kind: 'lfo', shape: 'sine', rate: waveRate }, swellGain, 'gain', 'gain', between(rng, 0.35, 0.45));
  s.modulate(s.slowWalk(0.05, 0.15), wave, 'lfo', 'rate', waveRate * between(rng, 0.2, 0.35));
  const ch = rng() < 0.6 ? s.chorus(between(rng, 0.05, 0.15), between(rng, 0.5, 0.8), between(rng, 0.3, 0.4), COL.fx2) : null;
  const rv = s.reverb(between(rng, 4, 7), between(rng, 0.4, 0.55), COL.fx2);
  s.chain(swellGain, ch, rv, s.master(between(rng, 0.9, 1.05)));
};

const machine: Topology = (s) => {
  const { rng } = s;
  const voices = s.oscillators(intBetween(rng, 2, 3), { sine: 0, triangle: 0, sawtooth: 0, square: 1 }, 0.9);
  const cutoff = s.cutoff(0.8);
  const f = s.filter('lowpass', cutoff, between(rng, 2, 7));
  voices.forEach((v) => s.b.wire(v, f));
  const crush = s.b.add('gain', COL.shape, { shape: 'steps', bits: intBetween(rng, 3, 6), gain: 0.7 });
  const vca = s.b.add('gain', COL.shape, { gain: 0.5 });
  s.roles.pulse = vca;
  const bpm = between(rng, 96, 132);
  const beat = bpm / 60;
  const rate = beat * pick(rng, [2, 4]);
  s.modulate({ kind: 'lfo', shape: 'square', rate }, vca, 'gain', 'gain', 0.5);
  s.modulate({ kind: 'lfo', shape: pick<Wave>(rng, ['square', 'sawtooth']), rate: beat / pick(rng, [1, 2]) }, f, 'filter', 'frequency', cutoff * between(rng, 0.3, 0.5));
  s.modulate(s.slowWalk(0.05, 0.2), voices[0], 'oscillator', 'detune', between(rng, 3, 8));
  const d = s.delay((60 / bpm) * pick(rng, [0.25, 0.5, 0.75]), between(rng, 0.25, 0.45), between(rng, 0.2, 0.3));
  const rv = s.reverb(between(rng, 1, 2), between(rng, 0.15, 0.25));
  s.chain(f, crush, vca, d, rv, s.master(between(rng, 0.9, 1.05)));
};

const airports: Topology = (s) => {
  const { rng } = s;
  const { ids, rootMidi } = s.loops(intBetween(rng, 3, 7));
  s.roles.pulse = ids[0];
  const cutoff = Math.min(9000, s.cutoff(2.2));
  const lp = s.filter('lowpass', cutoff, between(rng, 0.5, 1));
  ids.forEach((id) => s.b.wire(id, lp));
  s.modulate(s.slowLfo(0.01, 0.04), lp, 'filter', 'frequency', cutoff * between(rng, 0.15, 0.3));
  s.modulate(s.slowWalk(0.05, 0.15), ids[ids.length - 1], 'loopVoice', 'pan', between(rng, 0.2, 0.4));
  const tape = rng() < 0.4 ? s.tapeEcho([1.5, 4.5], [0.55, 0.8], [0.18, 0.3], COL.fx1) : null;
  const rv = s.reverb(between(rng, 8.5, 10), between(rng, 0.55, 0.7));
  s.chain(lp, tape, rv, s.master(between(rng, 0.9, 1.05)));
  // A quiet pad bed under roughly three in ten Airports drifts.
  if (rng() < 0.3) {
    const bedFilter = s.filter('lowpass', Math.round(between(rng, 500, 1100)), between(rng, 0.5, 1));
    for (const semis of [-12, -5]) {
      const id = s.b.add('oscillator', COL.source, {
        wave: pick(rng, ['sine', 'triangle']),
        frequency: round(clampHz(midiHz(rootMidi + semis)), 2),
        detune: Math.round(between(rng, -5, 5)),
        level: round(between(rng, 0.03, 0.05), 3),
      });
      s.b.wire(id, bedFilter);
    }
    s.modulate(s.slowLfo(0.012, 0.03), bedFilter, 'filter', 'frequency', 200);
    s.b.wire(bedFilter, rv);
  }
};

const TOPOLOGIES: Record<Archetype, Topology> = { drone, texture, pulse, swell, field, bells, choir, tides, machine, airports };

/** Deterministically builds the audio half of a drift from its effective (per-attempt) seed. */
export function generateSound(soundSeed: SeedHex, traits: Traits): Sound {
  const s = new SoundBuilder(rngFor(soundSeed, 'sound'), traits);
  TOPOLOGIES[traits.archetype](s);
  return { nodes: s.b.nodes, edges: s.b.edges, roles: s.roles };
}
