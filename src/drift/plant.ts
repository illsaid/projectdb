import { loopSpec } from '@/audio/loops';
import { PLANT_TIMBRES, type Planting } from '@/audio/plantings';
import { between, pick, rngFor } from '@/audio/random';
import { num } from '@/patch/definitions';
import type { GraphNode, SeedHex } from '@/patch/types';

export const MAX_PLANTINGS = 16;
const CYCLE_RANGE: [number, number] = [10, 45];
const FADE_RANGE: [number, number] = [180, 480];
const FALLBACK_STEPS = [0, 2, 4, 7, 9];
const FALLBACK_ROOT = 57;
/** Planted notes span two octaves from the scale root placed just above middle C. */
const REGISTER_FLOOR = 60;
const OCTAVES = 2;

export interface DriftScale {
  root: number;
  steps: number[];
}

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function pitchesOf(node: GraphNode): number[] {
  switch (node.type) {
    case 'oscillator':
    case 'fm':
      return [num(node.data, 'frequency', 220)];
    case 'loopVoice': {
      const base = num(node.data, 'frequency', 523.25);
      return loopSpec(node.data).notes.map((n) => base * n.ratio);
    }
    default:
      return [];
  }
}

/** The pitch classes the drift's own voices use, relative to its lowest voice. */
export function driftScale(nodes: GraphNode[]): DriftScale {
  const midis = nodes.flatMap(pitchesOf).filter((hz) => hz >= 20 && hz <= 8000).map((hz) => Math.round(hzToMidi(hz)));
  if (!midis.length) return { root: FALLBACK_ROOT, steps: FALLBACK_STEPS };
  const root = Math.min(...midis);
  const steps = [...new Set(midis.map((m) => (((m - root) % 12) + 12) % 12))].sort((a, b) => a - b);
  return { root, steps: steps.length >= 3 ? steps : [...new Set([...steps, ...FALLBACK_STEPS])].sort((a, b) => a - b) };
}

/** Every plantable pitch from low to high. */
function ladder({ root, steps }: DriftScale): number[] {
  const base = REGISTER_FLOOR + ((((root - REGISTER_FLOOR) % 12) + 12) % 12);
  const notes: number[] = [];
  for (let o = 0; o < OCTAVES; o++) for (const s of steps) notes.push(base + o * 12 + s);
  notes.push(base + OCTAVES * 12);
  return notes;
}

/**
 * A note planted at (x, y) on the screen, both 0..1 from the top left: higher on screen is a
 * higher pitch, further right is a longer cycle. Fade and timbre come from the drift's seed.
 */
export function plantAt(x: number, y: number, at: number, scale: DriftScale, seed: SeedHex, index: number): Planting {
  const notes = ladder(scale);
  const cx = Math.min(1, Math.max(0, x));
  const cy = Math.min(1, Math.max(0, y));
  const step = Math.round((1 - cy) * (notes.length - 1));
  const rng = rngFor(seed, 'plant', index);
  return {
    at: Math.round(at * 1000) / 1000,
    frequency: Math.round(midiToHz(notes[step]) * 100) / 100,
    cycle: Math.round((CYCLE_RANGE[0] + cx * (CYCLE_RANGE[1] - CYCLE_RANGE[0])) * 100) / 100,
    fade: Math.round(between(rng, ...FADE_RANGE)),
    pan: Math.round((cx - 0.5) * 120) / 100,
    timbre: pick(rng, PLANT_TIMBRES),
  };
}
