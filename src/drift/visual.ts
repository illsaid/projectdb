import { between, intBetween, rngFor, weighted, type Rng } from '@/audio/random';
import { defaultData, num } from '@/patch/definitions';
import { featureHandleId, visualHandleId, type GraphEdge, type NodeData, type SeedHex } from '@/patch/types';
import type { FeatureKey } from '@/audio/features';
import {
  envKey,
  PALETTE_KEY,
  relativeLuminance,
  VISUAL_INPUT_KEYS,
  VISUAL_SEED_KEY,
  type VisualInputKey,
  type VisualPreset,
} from '@/visual/inputs';
import { COLUMN_WIDTH, type PatchNodeSpec } from './builder';
import type { Sound } from './sound';
import type { Archetype, Brightness, Traits } from './traits';

export const VISUAL_NODE_ID = 'visual-1';

const PRESET_ODDS: Record<Archetype, Record<VisualPreset, number>> = {
  drone: { drift: 0.7, fog: 0.12, horizon: 0.08, ink: 0.05, rings: 0.03, interference: 0.02 },
  texture: { fog: 0.7, drift: 0.1, ink: 0.1, horizon: 0.05, rings: 0.03, interference: 0.02 },
  pulse: { rings: 0.7, interference: 0.15, drift: 0.05, fog: 0.05, ink: 0.025, horizon: 0.025 },
  swell: { drift: 0.3, fog: 0.3, horizon: 0.2, rings: 0.08, ink: 0.08, interference: 0.04 },
  field: { fog: 0.35, drift: 0.25, horizon: 0.15, ink: 0.1, rings: 0.1, interference: 0.05 },
  bells: { interference: 0.5, rings: 0.2, horizon: 0.1, drift: 0.1, fog: 0.05, ink: 0.05 },
  choir: { ink: 0.7, drift: 0.12, fog: 0.08, horizon: 0.06, rings: 0.02, interference: 0.02 },
  tides: { horizon: 0.7, fog: 0.15, drift: 0.08, ink: 0.05, rings: 0.01, interference: 0.01 },
  machine: { interference: 0.7, rings: 0.15, drift: 0.05, fog: 0.05, ink: 0.03, horizon: 0.02 },
  airports: { drift: 0.4, horizon: 0.3, fog: 0.12, ink: 0.1, rings: 0.06, interference: 0.02 },
};

interface PaletteRule {
  hueStep: (rng: Rng, i: number) => number;
  saturation: [number, number];
  value: [number, number];
}

const PALETTE_RULES: Record<Archetype, PaletteRule> = {
  drone: { hueStep: (rng) => between(rng, -0.03, 0.03), saturation: [0.1, 0.3], value: [0.05, 0.86] },
  texture: { hueStep: (rng) => between(rng, -0.08, 0.08), saturation: [0.03, 0.16], value: [0.05, 0.82] },
  pulse: { hueStep: (rng, i) => (i % 2 ? 0.5 : 0) + between(rng, -0.04, 0.04), saturation: [0.6, 0.9], value: [0.02, 1] },
  swell: { hueStep: (rng, i) => i * between(rng, 0.04, 0.1), saturation: [0.35, 0.6], value: [0.06, 0.95] },
  field: { hueStep: (rng, i) => i * between(rng, 0.12, 0.2), saturation: [0.3, 0.55], value: [0.07, 0.9] },
  bells: { hueStep: (rng, i) => (i % 2 ? 0.08 : 0) + between(rng, -0.03, 0.03), saturation: [0.25, 0.5], value: [0.03, 0.95] },
  choir: { hueStep: (rng) => between(rng, -0.05, 0.05), saturation: [0.08, 0.25], value: [0.04, 0.92] },
  tides: { hueStep: (rng, i) => i * between(rng, 0.02, 0.06), saturation: [0.3, 0.55], value: [0.05, 0.9] },
  machine: { hueStep: (rng, i) => (i % 3 === 2 ? 0.5 : 0) + between(rng, -0.02, 0.02), saturation: [0.5, 0.8], value: [0.02, 0.95] },
  airports: { hueStep: (rng, i) => i * between(rng, 0.03, 0.08), saturation: [0.12, 0.32], value: [0.06, 0.95] },
};

const VALUE_SHIFT: Record<Brightness, [number, number]> = { dark: [0, -0.12], balanced: [0, 0], bright: [0.03, 0.06] };

/** Envelope attack/release in seconds, by how the sound moves. */
const SMOOTHING: Record<Archetype, [number, number]> = {
  drone: [1.2, 3],
  texture: [0.25, 1.2],
  pulse: [0.02, 0.25],
  swell: [0.8, 2.5],
  field: [0.4, 1.8],
  bells: [0.15, 1.5],
  choir: [1, 2.8],
  tides: [1.5, 3.5],
  machine: [0.02, 0.2],
  airports: [0.6, 2.5],
};

/** Archetypes whose pulse role drives bloom; a dense grid gets a softer, slower flash. */
const ONSET_BLOOM: Partial<Record<Archetype, { gain: [number, number]; attack: number }>> = {
  pulse: { gain: [0.6, 0.9], attack: 0.005 },
  bells: { gain: [0.5, 0.8], attack: 0.005 },
  machine: { gain: [0.3, 0.45], attack: 0.04 },
  airports: { gain: [0.25, 0.4], attack: 0.15 },
};

const SPEED: Record<Archetype, [number, number]> = {
  drone: [0.15, 0.28],
  texture: [0.3, 0.48],
  pulse: [0.35, 0.55],
  swell: [0.2, 0.35],
  field: [0.25, 0.4],
  bells: [0.2, 0.35],
  choir: [0.18, 0.3],
  tides: [0.15, 0.28],
  machine: [0.35, 0.5],
  airports: [0.12, 0.24],
};

function hsvHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)].map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function palette(rng: Rng, archetype: Archetype, brightness: Brightness): string[] {
  const rule = PALETTE_RULES[archetype];
  const count = intBetween(rng, 3, 4);
  const base = rng();
  const [loShift, hiShift] = VALUE_SHIFT[brightness];
  const vLo = rule.value[0] + loShift;
  const vHi = Math.min(1, rule.value[1] + hiShift);
  const colors = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const h = (((base + rule.hueStep(rng, i)) % 1) + 1) % 1;
    const v = vLo + (vHi - vLo) * t ** 1.2 * between(rng, 0.92, 1);
    return hsvHex(h, between(rng, ...rule.saturation), v);
  });
  return colors.sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
}

/** Analysis output of a sound module routed into a visual input. */
interface Route {
  source: string;
  feature: FeatureKey;
  input: VisualInputKey;
  gain: number;
}

const amountOf = (sound: Sound, id: string) => {
  const node = sound.nodes.find((n) => n.id === id);
  if (!node) return 0;
  return num(node.data, node.type === 'lfo' ? 'depth' : 'range');
};

/** A modulator's raw value swings by its amount, so the gain maps that swing to `target`. */
const swingGain = (amount: number, target: number) => Math.min(16, target / Math.max(amount, 1e-4));

function routes(rng: Rng, sound: Sound, soundArchetype: Archetype): Route[] {
  const { roles } = sound;
  const out: Route[] = [];
  const loudest = [...roles.voices].sort((a, b) => b.level - a.level)[0];
  if (loudest) out.push({ source: loudest.id, feature: 'rms', input: 'scale', gain: between(rng, 0.3, 0.5) });

  const slowest = [...roles.modulators].sort((a, b) => a.rate - b.rate)[0];
  if (slowest) {
    const swing = soundArchetype === 'drone' ? 0.03 : between(rng, 0.07, 0.14);
    out.push({ source: slowest.id, feature: 'value', input: 'hue', gain: swingGain(amountOf(sound, slowest.id), swing) });
  }

  const bloom = ONSET_BLOOM[soundArchetype];
  if (bloom && roles.pulse) {
    out.push({ source: roles.pulse, feature: 'onset', input: 'bloom', gain: between(rng, ...bloom.gain) });
  }

  if (roles.noises[0]) out.push({ source: roles.noises[0], feature: 'rms', input: 'grain', gain: between(rng, 0.3, 0.5) });

  const walk = roles.modulators.find((m) => m.kind === 'randomWalk' && m.id !== slowest?.id);
  if (walk) out.push({ source: walk.id, feature: 'value', input: 'warp', gain: swingGain(amountOf(sound, walk.id), 0.25) });
  return out;
}

function baseValues(rng: Rng, look: Traits, routed: Set<VisualInputKey>): Record<VisualInputKey, number> {
  const a = look.archetype;
  return {
    hue: 0,
    scale: routed.has('scale') ? between(rng, 0.08, 0.3) : between(rng, 0.3, 0.6),
    warp: a === 'field' || a === 'choir' ? between(rng, 0.6, 0.85) : between(rng, 0.25, 0.5),
    bloom: routed.has('bloom') ? between(rng, 0.08, 0.18) : between(rng, 0.15, 0.4),
    speed: between(rng, ...SPEED[a]),
    grain: routed.has('grain') ? between(rng, 0.04, 0.12) : a === 'texture' ? between(rng, 0.35, 0.6) : between(rng, 0.1, 0.3),
  };
}

const round = (v: number, d = 3) => Number(v.toFixed(d));

/**
 * Builds the Visual module and its analysis wiring. The look (preset, palette, base values) comes
 * from the visual seed and its archetype; routing and smoothing follow the sound it reacts to.
 */
export function generateVisual(
  visualSeed: SeedHex,
  look: Traits,
  sound: Sound,
  soundArchetype: Archetype,
): { node: PatchNodeSpec; edges: GraphEdge[] } {
  const lookRng = rngFor(visualSeed, 'look');
  const preset = weighted(lookRng, PRESET_ODDS[look.archetype]);
  const colors = palette(lookRng, look.archetype, look.brightness);

  const routeRng = rngFor(visualSeed, 'routing');
  const routed = routes(routeRng, sound, soundArchetype);
  const routedInputs = new Set(routed.map((r) => r.input));
  const base = baseValues(lookRng, look, routedInputs);

  const [attack, release] = SMOOTHING[soundArchetype];
  const data: NodeData = { ...defaultData('visual'), preset, [PALETTE_KEY]: colors.join(','), [VISUAL_SEED_KEY]: visualSeed };
  for (const key of VISUAL_INPUT_KEYS) {
    data[key] = round(base[key]);
    data[envKey(key, 'attack')] = round(attack * between(routeRng, 0.8, 1.2));
    data[envKey(key, 'release')] = round(release * between(routeRng, 0.8, 1.2));
  }
  for (const r of routed) {
    data[envKey(r.input, 'gain')] = round(r.gain);
    if (r.input === 'bloom') {
      data[envKey('bloom', 'attack')] = ONSET_BLOOM[soundArchetype]?.attack ?? 0.005;
      data[envKey('bloom', 'release')] = round(soundArchetype === 'airports' ? between(routeRng, 1.2, 2) : between(routeRng, 0.25, 0.4));
    }
  }

  const maxX = Math.max(0, ...sound.nodes.map((n) => n.position.x));
  const node: PatchNodeSpec = {
    id: VISUAL_NODE_ID,
    type: 'visual',
    position: { x: maxX + COLUMN_WIDTH, y: 0 },
    data,
  };
  const edges: GraphEdge[] = routed.map((r, i) => ({
    id: `v${i + 1}`,
    source: r.source,
    sourceHandle: featureHandleId(r.feature),
    target: VISUAL_NODE_ID,
    targetHandle: visualHandleId(r.input),
  }));
  return { node, edges };
}
