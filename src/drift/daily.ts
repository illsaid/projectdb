import { hashSeed } from '@/audio/random';
import type { SeedHex } from '@/patch/types';
import { driftName } from './names';
import type { DriftRequest } from './resolve';
import { traitsFor, type Traits } from './traits';

export interface DailyDrift {
  /** YYYY-MM-DD in UTC, so every visitor shares the same day boundary. */
  date: string;
  seed: SeedHex;
  name: string;
  traits: Traits;
}

export const utcDate = (now: Date) => now.toISOString().slice(0, 10);

/** The same drift for everyone on a given UTC day: the seed is hash('daily' + date). */
export function dailyDrift(now = new Date()): DailyDrift {
  const date = utcDate(now);
  const seed = hashSeed(`daily${date}`);
  return { date, seed, name: driftName(seed), traits: traitsFor(seed) };
}

export const dailyRequest = (daily: DailyDrift): DriftRequest => ({ seed: daily.seed, visualSeed: daily.seed });

/** Milliseconds until the next UTC midnight, when the daily drift changes. */
export function msUntilNextDay(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
