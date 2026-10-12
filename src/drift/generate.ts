import type { Form } from '@/audio/form';
import { hashSeed } from '@/audio/random';
import type { PatchFile, SeedHex } from '@/patch/types';
import { applyCards } from './cards';
import { bindForm, generateForm } from './form';
import { driftName } from './names';
import { generateSound, type Sound } from './sound';
import { traitsFor, type Traits } from './traits';
import { generateVisual } from './visual';

/** Everything needed to rebuild a drift exactly: base seeds, the quality-gate attempts that passed, and any cards drawn. */
export interface DriftId {
  seed: SeedHex;
  attempt: number;
  visualSeed: SeedHex;
  visualAttempt: number;
  /** Drift Card ids, applied in order on top of the generated patch. */
  cards?: string[];
}

/** Attempt 0 uses the seed itself; later attempts use hash(seed + attempt). */
export const attemptSeed = (seed: SeedHex, attempt: number, salt: string): SeedHex =>
  attempt === 0 ? seed : hashSeed(seed, salt, attempt);

export const soundSeedOf = (id: Pick<DriftId, 'seed' | 'attempt'>) => attemptSeed(id.seed, id.attempt, 'sound');
export const visualSeedFor = (id: Pick<DriftId, 'visualSeed' | 'visualAttempt'>) =>
  attemptSeed(id.visualSeed, id.visualAttempt, 'visual');

/** The audio half of a drift: its modules, the traits that shaped them, and the score they play. */
export interface SoundPlan {
  sound: Sound;
  traits: Traits;
  form: Form;
}

export function soundFor(id: Pick<DriftId, 'seed' | 'attempt'>): SoundPlan {
  const traits = traitsFor(id.seed);
  const seed = soundSeedOf(id);
  const sound = generateSound(seed, traits);
  return { sound, traits, form: bindForm(generateForm(seed, traits.archetype, traits.length), sound) };
}

export function composePatch(id: DriftId, { sound, traits, form }: SoundPlan): PatchFile {
  const visual = generateVisual(visualSeedFor(id), traitsFor(id.visualSeed), sound, traits.archetype);
  const patch: PatchFile = {
    format: 'patcher',
    version: 2,
    name: driftName(id.seed),
    seed: soundSeedOf(id),
    nodes: [...sound.nodes, visual.node],
    edges: [...sound.edges, ...visual.edges],
    form,
  };
  return id.cards?.length ? applyCards(patch, id.cards) : patch;
}

/** Deterministically builds the full patch (sound and visual) for a drift. */
export function generatePatch(id: SeedHex | DriftId): PatchFile {
  const full: DriftId = typeof id === 'string' ? { seed: id, attempt: 0, visualSeed: id, visualAttempt: 0 } : id;
  return composePatch(full, soundFor(full));
}
