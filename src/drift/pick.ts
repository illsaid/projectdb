import { randomSeed } from '@/audio/random';
import type { SeedHex } from '@/patch/types';
import type { DriftStore } from './store';
import { matchesLocks, NO_LOCKS, traitsFor, type Locks } from './traits';

const MAX_DRAWS = 4000;

/** Draws fresh random seeds until one matches the locks and has never been heard in this browser. */
export async function freshSeed(store: DriftStore | null, locks: Locks = NO_LOCKS): Promise<SeedHex> {
  let fallback: SeedHex | null = null;
  for (let i = 0; i < MAX_DRAWS; i++) {
    const seed = randomSeed();
    if (!matchesLocks(traitsFor(seed), locks)) continue;
    fallback ??= seed;
    if (!store || !(await store.hasSeen(seed))) return seed;
  }
  if (fallback) return fallback;
  throw new Error('No seed matches these locks.');
}
