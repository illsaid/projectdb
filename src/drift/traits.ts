import { pick, rngFor, weighted } from '@/audio/random';
import type { SeedHex } from '@/patch/types';

export const ARCHETYPES = ['drone', 'texture', 'pulse', 'swell', 'field', 'bells', 'choir', 'tides', 'machine', 'airports'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** Relative odds a fresh seed lands on each archetype; the busier ones are a little rarer. */
const ARCHETYPE_WEIGHTS: Record<Archetype, number> = {
  drone: 1.1,
  texture: 1,
  pulse: 0.9,
  swell: 1.1,
  field: 1,
  bells: 1,
  choir: 1,
  tides: 1,
  machine: 0.8,
  airports: 1,
};

export const BRIGHTNESS = ['dark', 'balanced', 'bright'] as const;
export type Brightness = (typeof BRIGHTNESS)[number];

export const LENGTHS = [30, 60, 180] as const;
export type DriftLength = (typeof LENGTHS)[number];

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  drone: 'Drone',
  texture: 'Texture',
  pulse: 'Pulse',
  swell: 'Swell',
  field: 'Field',
  bells: 'Bells',
  choir: 'Choir',
  tides: 'Tides',
  machine: 'Machine',
  airports: 'Airports',
};

export const BRIGHTNESS_LABEL: Record<Brightness, string> = {
  dark: 'Dark',
  balanced: 'Balanced',
  bright: 'Bright',
};

export const lengthLabel = (s: number) => (s >= 60 ? `${s / 60} min` : `${s} s`);

export interface Traits {
  archetype: Archetype;
  brightness: Brightness;
  length: DriftLength;
}

/** The high-level character of a seed. Fixed per seed, independent of quality-gate attempts. */
export function traitsFor(seed: SeedHex): Traits {
  const rng = rngFor(seed, 'traits');
  return {
    archetype: weighted(rng, ARCHETYPE_WEIGHTS),
    brightness: pick(rng, BRIGHTNESS),
    length: pick(rng, LENGTHS),
  };
}

export type Hold = 'none' | 'visual' | 'sound';

export interface Locks {
  archetype: Archetype | null;
  brightness: Brightness | null;
  length: DriftLength | null;
  hold: Hold;
}

export const NO_LOCKS: Locks = { archetype: null, brightness: null, length: null, hold: 'none' };

export const activeLockCount = (l: Locks) =>
  [l.archetype, l.brightness, l.length].filter((v) => v !== null).length + (l.hold === 'none' ? 0 : 1);

export function matchesLocks(traits: Traits, locks: Locks): boolean {
  return (
    (!locks.archetype || traits.archetype === locks.archetype) &&
    (!locks.brightness || traits.brightness === locks.brightness) &&
    (!locks.length || traits.length === locks.length)
  );
}
