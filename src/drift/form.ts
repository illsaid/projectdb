import { LANE_FLOOR, type Form, type FormGate, type FormLane, type LaneKey, type SectionLook } from '@/audio/form';
import { between, intBetween, rngFor, shuffle, type Rng } from '@/audio/random';
import { num } from '@/patch/definitions';
import type { NodeKind, SeedHex } from '@/patch/types';
import type { Sound } from './sound';
import type { Archetype } from './traits';

export const FORM_PARAMS = ['cutoff', 'reverbMix', 'delayFeedback', 'lfoRate'] as const;
export type FormParam = (typeof FORM_PARAMS)[number];

/** Voice slots a score describes; sounds use the first N of them. */
const VOICE_SLOTS = 6;

export interface ScoreSection {
  start: number;
  duration: number;
  /** Arch-shaped intensity, 0..1, peaking mid-form. */
  intensity: number;
  voices: boolean[];
  targets: Partial<Record<FormParam, number>>;
  look: SectionLook;
}

/** A sound-independent plan: sections, fades and multipliers, later bound to a patch's modules. */
export interface Score {
  length: number;
  fadeIn: number;
  fadeOut: number;
  sections: ScoreSection[];
}

/** How far each archetype is allowed to move away from its base settings. */
const CONTRAST: Record<Archetype, number> = {
  drone: 0.6,
  texture: 0.8,
  pulse: 1,
  swell: 1.2,
  field: 0.8,
  bells: 0.7,
  choir: 1,
  tides: 0.9,
  machine: 0.9,
  airports: 0.5,
};

function sectionDurations(rng: Rng, count: number, length: number): number[] {
  const weights = Array.from({ length: count }, () => between(rng, 0.7, 1.3));
  const total = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => (w / total) * length);
}

function target(rng: Rng, param: FormParam, intensity: number, contrast: number): number {
  const lift = (intensity - 0.6) * contrast;
  switch (param) {
    case 'cutoff':
      return Math.pow(2, lift * 1.8 + between(rng, -0.35, 0.35) * contrast);
    case 'reverbMix':
      return Math.pow(2, -lift * 0.7 + between(rng, -0.25, 0.25) * contrast);
    case 'delayFeedback':
      return Math.pow(2, lift * 0.6 + between(rng, -0.3, 0.3) * contrast);
    case 'lfoRate':
      return Math.pow(2, lift * 1.2 + between(rng, -0.4, 0.4) * contrast);
  }
}

/** Deterministically plans the arc of a drift: 3–5 sections, fades, voice entries and parameter targets. */
export function generateForm(seed: SeedHex, archetype: Archetype, length: number): Score {
  const rng = rngFor(seed, 'form');
  const count = intBetween(rng, 3, length >= 60 ? 5 : 4);
  let fadeIn = between(rng, 4, 12);
  let fadeOut = between(rng, 6, 20);
  const budget = length * 0.6;
  if (fadeIn + fadeOut > budget) {
    const k = budget / (fadeIn + fadeOut);
    fadeIn *= k;
    fadeOut *= k;
  }

  const contrast = CONTRAST[archetype];
  const params = shuffle(rng, FORM_PARAMS).slice(0, intBetween(rng, 2, 4));
  const durations = sectionDurations(rng, count, length);
  let start = 0;
  let hue = 0;
  const sections = durations.map((duration, i): ScoreSection => {
    const intensity = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / count);
    const voices = Array.from({ length: VOICE_SLOTS }, (_, slot) => slot === 0 || rng() < 0.25 + intensity * 0.7);
    const targets = Object.fromEntries(params.map((p) => [p, target(rng, p, intensity, contrast)]));
    hue += between(rng, -0.07, 0.07) * contrast;
    const look: SectionLook = {
      blend: Math.max(0, between(rng, -0.15, 0.6) * intensity),
      hue,
      scale: (intensity - 0.6) * 0.3 * contrast,
    };
    const section = { start, duration, intensity, voices, targets, look };
    start += duration;
    return section;
  });
  return { length, fadeIn, fadeOut, sections };
}

const PARAM_NODE: Record<FormParam, { types: NodeKind[]; key: LaneKey; ceiling?: { data: string; max: number } }> = {
  cutoff: { types: ['filter', 'formant'], key: 'cutoff' },
  reverbMix: { types: ['reverb'], key: 'reverbMix', ceiling: { data: 'mix', max: 0.95 } },
  delayFeedback: { types: ['delay', 'tapeEcho'], key: 'delayFeedback', ceiling: { data: 'feedback', max: 0.9 } },
  lfoRate: { types: ['lfo'], key: 'lfoRate' },
};

/** Points that hold each section's value, then ramp to the next over part of the new section. */
function lanePoints(sections: ScoreSection[], values: number[], rampShare: number, maxRamp: number): [number, number][] {
  const points: [number, number][] = [[0, values[0]]];
  for (let i = 1; i < sections.length; i++) {
    const { start, duration } = sections[i];
    const ramp = Math.min(maxRamp, Math.max(1.5, duration * rampShare));
    if (values[i] === values[i - 1]) continue;
    points.push([start, values[i - 1]], [start + ramp, values[i]]);
  }
  return points;
}

/** Joins consecutive active sections into [start, end) spans. */
function gateSpans(sections: ScoreSection[], on: boolean[]): [number, number][] {
  const spans: [number, number][] = [];
  sections.forEach((s, i) => {
    if (!on[i]) return;
    const last = spans[spans.length - 1];
    if (last && last[1] === s.start) last[1] = s.start + s.duration;
    else spans.push([s.start, s.start + s.duration]);
  });
  return spans;
}

/** Ties a score to a sound's actual voices and effects, and estimates which section is loudest. */
export function bindForm(score: Score, sound: Sound): Form {
  const { sections, length, fadeIn, fadeOut } = score;
  const voices = sound.roles.voices.slice(0, VOICE_SLOTS);
  const minActive = Math.max(1, Math.round(voices.length * 0.5));
  const active = sections.map((s) => {
    const on = voices.map((_, slot) => s.voices[slot]);
    for (let slot = 0; on.filter(Boolean).length < minActive && slot < on.length; slot++) on[slot] = true;
    return on;
  });

  const lanes: FormLane[] = [];
  const master = sound.nodes.find((n) => n.type === 'master');
  if (master) {
    lanes.push({
      node: master.id,
      key: 'fade',
      points: [
        [0, LANE_FLOOR],
        [fadeIn, 1],
        [length - fadeOut, 1],
        [length, LANE_FLOOR],
      ],
    });
  }
  const gates: FormGate[] = [];
  const loops = new Set(sound.nodes.filter((n) => n.type === 'loopVoice').map((n) => n.id));
  voices.forEach((v, slot) => {
    const values = active.map((on) => (on[slot] ? 1 : LANE_FLOOR));
    if (values.every((x) => x === 1)) return;
    // Loops start and stop rather than fade, so a stopped loop's last notes still ring out.
    if (loops.has(v.id)) {
      gates.push({ node: v.id, spans: gateSpans(sections, active.map((on) => on[slot])) });
      return;
    }
    lanes.push({ node: v.id, key: 'level', points: lanePoints(sections, values, 0.3, 8) });
  });

  for (const param of Object.keys(sections[0].targets) as FormParam[]) {
    const spec = PARAM_NODE[param];
    for (const node of sound.nodes.filter((n) => spec.types.includes(n.type))) {
      const base = spec.ceiling ? num(node.data, spec.ceiling.data, 0.5) : 0;
      const cap = spec.ceiling && base > 0 ? spec.ceiling.max / base : Infinity;
      const values = sections.map((s) => Math.min(cap, s.targets[param] ?? 1));
      lanes.push({ node: node.id, key: spec.key, points: lanePoints(sections, values, 0.5, 12) });
    }
  }

  const cutoffs = sections.map((s) => Math.pow(s.targets.cutoff ?? 1, 0.3));
  const energy = active.map((on, i) => on.reduce((sum, isOn, slot) => sum + (isOn ? voices[slot].level : 0), 0) * cutoffs[i]);
  const peak = energy.indexOf(Math.max(...energy));

  return {
    length,
    fadeIn,
    fadeOut,
    sections: sections.map(({ start, duration, look }) => ({ start, duration, look })),
    peak: Math.max(0, peak),
    lanes,
    ...(gates.length ? { gates } : {}),
  };
}
