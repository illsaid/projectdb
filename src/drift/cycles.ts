import { between, shuffle, type Rng } from '@/audio/random';

/** Ratios with no simple relationship to each other, so loops drift in and out of alignment. */
const IRRATIONALS = [Math.SQRT2, Math.PI / 2, (1 + Math.sqrt(5)) / 2, Math.sqrt(3), Math.sqrt(5), Math.E, Math.PI];

/** Any two loops must take at least this long to line up again. */
export const MIN_COMMON_PERIOD = 30 * 60;
/** Cycle lengths are stored to 1/100 s, so alignment is computed on that grid. */
const TICKS = 100;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Seconds until two cycle lengths (on the 1/100 s grid) next start together. */
export function commonPeriod(a: number, b: number): number {
  const x = Math.round(a * TICKS);
  const y = Math.round(b * TICKS);
  return ((x / gcd(x, y)) * y) / TICKS;
}

/**
 * Cycle lengths from base × an irrational ratio spread. Each length is nudged up by 1/100 s
 * until it shares no common period under 30 minutes with any length already chosen.
 */
export function cycleLengths(rng: Rng, count: number, min = 5, max = 60): number[] {
  const base = between(rng, 6.5, 10.5);
  const ratios = [1, ...shuffle(rng, IRRATIONALS)].slice(0, count);
  const out: number[] = [];
  for (const r of ratios) {
    let len = Math.min(max, Math.max(min, Math.round(base * r * TICKS) / TICKS));
    while (out.some((o) => commonPeriod(o, len) < MIN_COMMON_PERIOD)) len = Math.round(len * TICKS + 1) / TICKS;
    out.push(len);
  }
  return out;
}
