export type Rng = () => number;

/** A seed is 128 bits written as 32 lowercase hex characters. */
export type Seed = string;

const SEED_HEX_LENGTH = 32;

/** cyrb128: fast, well-mixed 128-bit string hash (not cryptographic). */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function sfc32(a: number, b: number, c: number, d: number): Rng {
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

const keyOf = (seed: Seed, labels: (string | number)[]) => [seed, ...labels].join('\u241f');
const toHex = (words: number[]) => words.map((w) => w.toString(16).padStart(8, '0')).join('');

/** An independent, reproducible stream for any (seed, labels…) combination. */
export function rngFor(seed: Seed, ...labels: (string | number)[]): Rng {
  return sfc32(...cyrb128(keyOf(seed, labels)));
}

/** A new 128-bit seed derived from a seed and labels, e.g. hashSeed(seed, 'attempt', 2). */
export function hashSeed(seed: Seed, ...labels: (string | number)[]): Seed {
  return toHex(cyrb128(keyOf(seed, labels)));
}

export function randomSeed(): Seed {
  return toHex([...crypto.getRandomValues(new Uint32Array(4))]);
}

/** Accepts 1–32 hex characters (optionally 0x-prefixed) and pads to a full seed. */
export function parseSeed(input: string): Seed | null {
  const hex = input.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{1,32}$/.test(hex) ? hex.padStart(SEED_HEX_LENGTH, '0') : null;
}

/** Older patches stored a 32-bit number. */
export function legacySeed(n: number): Seed {
  return (n >>> 0).toString(16).padStart(SEED_HEX_LENGTH, '0');
}

export const shortSeed = (seed: Seed) => seed.slice(0, 8);

export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length) % items.length];
export const between = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
export const intBetween = (rng: Rng, lo: number, hi: number) => Math.floor(between(rng, lo, hi + 1));

export function weighted<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
