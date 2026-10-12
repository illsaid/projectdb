import type { NodeData } from '@/patch/types';
import { hexToRgb, PALETTE_KEY, parsePalette } from './inputs';

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function toHsl(hex: string): Hsl {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function fromHsl({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * clamp01(l) - 1)) * clamp01(s);
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = clamp01(l) - c / 2;
  return `#${[r, g, b].map((v) => Math.round(clamp01(v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Moves hue h a fraction t of the shortest way towards target. */
export function hueToward(h: number, target: number, t: number): number {
  const diff = ((((target - h) % 360) + 540) % 360) - 180;
  return h + diff * t;
}

/** Visual node data with every palette colour passed through fn. */
export function mapPalette(data: NodeData, fn: (c: Hsl, index: number) => Hsl): NodeData {
  const colors = parsePalette(typeof data[PALETTE_KEY] === 'string' ? data[PALETTE_KEY] : undefined);
  return { ...data, [PALETTE_KEY]: colors.map((c, i) => fromHsl(fn(toHsl(c), i))).join(',') };
}
