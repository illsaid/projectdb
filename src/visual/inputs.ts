import type { ChoiceSpec, ParamSpec } from '@/patch/definitions';
import type { NodeData } from '@/patch/types';

export const VISUAL_INPUT_KEYS = ['hue', 'scale', 'warp', 'bloom', 'speed', 'grain'] as const;
export type VisualInputKey = (typeof VISUAL_INPUT_KEYS)[number];

const base = (key: VisualInputKey, label: string, def: number): ParamSpec => ({
  key,
  label,
  min: 0,
  max: 1,
  default: def,
  decimals: 2,
});

export const VISUAL_INPUTS: ParamSpec[] = [
  base('hue', 'Hue', 0),
  base('scale', 'Scale', 0.45),
  base('warp', 'Warp', 0.4),
  base('bloom', 'Bloom', 0.3),
  base('speed', 'Speed', 0.3),
  base('grain', 'Grain', 0.2),
];

export type EnvelopePart = 'attack' | 'release' | 'gain' | 'invert';
export const envKey = (input: string, part: EnvelopePart) => `${input}.${part}`;

export const ENVELOPE_SPECS: (ParamSpec & { key: Exclude<EnvelopePart, 'invert'> })[] = [
  { key: 'attack', label: 'Atk', min: 0.001, max: 2, default: 0.02, unit: 's', curve: 3, decimals: 3 },
  { key: 'release', label: 'Rel', min: 0.01, max: 4, default: 0.35, unit: 's', curve: 3, decimals: 2 },
  { key: 'gain', label: 'Gain', min: 0, max: 16, default: 1, curve: 3, decimals: 2 },
];

export type VisualPreset = 'drift' | 'rings' | 'fog' | 'ink' | 'interference' | 'horizon';

export const PRESET_CHOICE: ChoiceSpec = {
  key: 'preset',
  label: 'Preset',
  options: [
    { value: 'drift', label: 'DRIFT' },
    { value: 'rings', label: 'RINGS' },
    { value: 'fog', label: 'FOG' },
    { value: 'ink', label: 'INK' },
    { value: 'interference', label: 'MOIRE' },
    { value: 'horizon', label: 'HORIZON' },
  ],
  default: 'drift',
};

export const PRESET_NAMES: Record<VisualPreset, string> = {
  drift: 'Drift Field',
  rings: 'Pulse Rings',
  fog: 'Grain Fog',
  ink: 'Ink Wash',
  interference: 'Interference',
  horizon: 'Horizon',
};

/** Visual node data keys that are not sliders. */
export const PALETTE_KEY = 'palette';
export const VISUAL_SEED_KEY = 'seed';

export const MAX_PALETTE = 4;
export const DEFAULT_PALETTE = ['#0a1820', '#1d5c66', '#d79a4a', '#f3ead8'];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Palette is stored as comma-separated #rrggbb, ordered dark to light. */
export function parsePalette(value: string | undefined): string[] {
  const colors = (value ?? '').split(',').map((c) => c.trim()).filter((c) => HEX_COLOR.test(c));
  return colors.length >= 2 ? colors.slice(0, MAX_PALETTE) : DEFAULT_PALETTE;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function paletteLuminanceRange(colors: string[]): number {
  const l = colors.map(relativeLuminance);
  return Math.max(...l) - Math.min(...l);
}

export function envelopeDefaults(): NodeData {
  const data: NodeData = {};
  for (const input of VISUAL_INPUT_KEYS) {
    for (const spec of ENVELOPE_SPECS) data[envKey(input, spec.key)] = spec.default;
    data[envKey(input, 'invert')] = 0;
  }
  data[PALETTE_KEY] = DEFAULT_PALETTE.join(',');
  return data;
}
