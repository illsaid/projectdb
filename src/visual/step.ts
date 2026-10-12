import type { FeatureMap } from '@/audio/features';
import { NEUTRAL_LOOK, type SectionLook } from '@/audio/form';
import { rngFor } from '@/audio/random';
import { num, str } from '@/patch/definitions';
import type { VisualLink } from '@/patch/io';
import type { NodeData, SeedHex } from '@/patch/types';
import {
  envKey,
  hexToRgb,
  MAX_PALETTE,
  PALETTE_KEY,
  parsePalette,
  PRESET_NAMES,
  VISUAL_INPUT_KEYS,
  VISUAL_INPUTS,
  VISUAL_SEED_KEY,
  type VisualInputKey,
  type VisualPreset,
} from './inputs';

export const BURST_SLOTS = 8;
const ONSET_FIRE = 0.5;
const ONSET_REARM = 0.2;

export interface VisualState {
  env: Record<VisualInputKey, number>;
  time: number;
  frame: number;
  bursts: Float32Array;
  burstCursor: number;
  armed: boolean;
  seed: Float32Array;
  paletteSource: string | null;
  palette: Float32Array;
  paletteSize: number;
  /** Picks which other preset the form blends toward. */
  alt: number;
}

export interface VisualFrame {
  preset: VisualPreset;
  /** Second preset drawn over the first at `amount`, driven by the form's sections. */
  blend: { preset: VisualPreset; amount: number };
  values: Record<VisualInputKey, number>;
  time: number;
  frame: number;
  bursts: Float32Array;
  seed: Float32Array;
  palette: Float32Array;
  paletteSize: number;
}

const zeroInputs = () => Object.fromEntries(VISUAL_INPUT_KEYS.map((k) => [k, 0])) as Record<VisualInputKey, number>;

/** A generated visual can carry its own seed so it can be held while the sound changes. */
export const visualSeedOf = (data: NodeData, patchSeed: SeedHex): SeedHex => str(data, VISUAL_SEED_KEY, patchSeed) || patchSeed;

/** Everything random about the picture is derived here, from the seed. */
export function createVisualState(seed: SeedHex): VisualState {
  const rng = rngFor(seed, 'visual');
  return {
    env: zeroInputs(),
    time: rng() * 100,
    frame: 0,
    bursts: new Float32Array(BURST_SLOTS).fill(99),
    burstCursor: 0,
    armed: true,
    seed: Float32Array.from({ length: 4 }, () => rng() * 100),
    paletteSource: null,
    palette: new Float32Array(MAX_PALETTE * 3),
    paletteSize: 0,
    alt: rng(),
  };
}

function syncPalette(state: VisualState, source: string) {
  if (state.paletteSource === source) return;
  const colors = parsePalette(source);
  state.palette.fill(0);
  colors.forEach((c, i) => state.palette.set(hexToRgb(c), i * 3));
  state.paletteSize = colors.length;
  state.paletteSource = source;
}

const PRESETS = Object.keys(PRESET_NAMES) as VisualPreset[];

/**
 * Advances the visual by `dt` seconds. Pure apart from mutating `state`, and identical for live
 * playback and export so a rendered video matches what was seen while patching.
 */
export function stepVisual(
  state: VisualState,
  data: NodeData,
  links: VisualLink[],
  features: FeatureMap,
  dt: number,
  look: SectionLook = NEUTRAL_LOOK,
): VisualFrame {
  // Room mode: no onset-driven bursts or blooms, and half the motion speed.
  const room = num(data, 'room') > 0;
  const drive = zeroInputs();
  let onset = 0;
  for (const link of links) {
    const f = features.get(link.source);
    if (!f || (room && link.feature === 'onset')) continue;
    drive[link.input] += f[link.feature];
    if (!room) onset = Math.max(onset, f.onset);
  }

  const values = zeroInputs();
  for (const spec of VISUAL_INPUTS) {
    const key = spec.key as VisualInputKey;
    const attack = num(data, envKey(key, 'attack'), 0.02);
    const release = num(data, envKey(key, 'release'), 0.35);
    const target = drive[key];
    const tau = Math.max(1e-3, target > state.env[key] ? attack : release);
    state.env[key] += (target - state.env[key]) * (1 - Math.exp(-dt / tau));
    const mod = state.env[key] * num(data, envKey(key, 'gain'), 1) * (num(data, envKey(key, 'invert')) ? -1 : 1);
    const offset = key === 'hue' ? look.hue : key === 'scale' ? look.scale : 0;
    const v = num(data, key, spec.default) + mod + offset;
    values[key] = key === 'hue' ? v - Math.floor(v) : Math.min(1, Math.max(0, v));
  }

  for (let i = 0; i < BURST_SLOTS; i++) state.bursts[i] += dt;
  if (state.armed && onset >= ONSET_FIRE) {
    state.bursts[state.burstCursor] = 0;
    state.burstCursor = (state.burstCursor + 1) % BURST_SLOTS;
    state.armed = false;
  } else if (!state.armed && onset < ONSET_REARM) {
    state.armed = true;
  }

  state.time += dt * (0.04 + values.speed * values.speed * 1.6) * (room ? 0.5 : 1);
  state.frame += 1;
  syncPalette(state, str(data, PALETTE_KEY, ''));

  const raw = str(data, 'preset', 'drift') as VisualPreset;
  const preset = PRESETS.includes(raw) ? raw : 'drift';
  const others = PRESETS.filter((p) => p !== preset);
  return {
    preset,
    blend: { preset: others[Math.floor(state.alt * others.length) % others.length], amount: Math.min(1, Math.max(0, look.blend)) },
    values,
    time: state.time,
    frame: state.frame,
    bursts: state.bursts,
    seed: state.seed,
    palette: state.palette,
    paletteSize: state.paletteSize,
  };
}
