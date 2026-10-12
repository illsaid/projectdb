import { parseSeed } from '@/audio/random';
import { isCardId } from './cards';
import type { DriftId } from './generate';
import type { DriftRequest } from './resolve';

/** `#s=<seed>` plus the recorded attempts (and a held visual seed) so the link rebuilds without re-checking. */
export function driftHash(id: DriftId): string {
  const params = new URLSearchParams({ s: id.seed, a: String(id.attempt) });
  if (id.visualSeed !== id.seed) params.set('v', id.visualSeed);
  params.set('va', String(id.visualAttempt));
  if (id.cards?.length) params.set('c', id.cards.join(','));
  return `#${params.toString()}`;
}

export const driftUrl = (id: DriftId) => `${location.origin}${location.pathname}${driftHash(id)}`;

const attemptParam = (v: string | null) => {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < 1000 ? n : undefined;
};

const cardsParam = (v: string | null) => {
  const cards = (v ?? '').split(',').filter(isCardId);
  return cards.length ? [...new Set(cards)] : undefined;
};

/** Reads a drift from the URL hash. A bare `#s=<seed>` re-runs the deterministic quality gate. */
export function parseDriftHash(hash: string): DriftRequest | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const seed = parseSeed(params.get('s') ?? '');
  if (!seed) return null;
  return {
    seed,
    visualSeed: parseSeed(params.get('v') ?? '') ?? seed,
    attempt: attemptParam(params.get('a')),
    visualAttempt: attemptParam(params.get('va')),
    cards: cardsParam(params.get('c')),
  };
}
