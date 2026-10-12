import { legacySeed } from '@/audio/random';
import { defaultData } from './definitions';
import type { GraphEdge, NodeData, NodeKind, PatchFile } from './types';

type Spec = [id: string, kind: NodeKind, x: number, y: number, data?: NodeData];
type Link = [source: string, target: string, targetHandle?: string];

function build(name: string, seed: number, specs: Spec[], links: Link[]): PatchFile {
  return {
    format: 'patcher',
    version: 2,
    name,
    seed: legacySeed(seed),
    nodes: specs.map(([id, type, x, y, data]) => ({
      id,
      type,
      position: { x, y },
      data: { ...defaultData(type), ...data },
    })),
    edges: links.map(([source, target, targetHandle = 'in'], i): GraphEdge => ({
      id: `e${i}-${source}-${target}`,
      source,
      sourceHandle: 'out',
      target,
      targetHandle,
    })),
  };
}

const drone = build(
  'Drone',
  20481,
  [
    ['rw', 'randomWalk', 0, 0, { rate: 0.3, step: 0.3, range: 0.0075 }],
    ['o1', 'oscillator', 280, -140, { wave: 'sawtooth', frequency: 55, detune: -6, level: 0.28 }],
    ['o2', 'oscillator', 280, 90, { wave: 'sawtooth', frequency: 82.5, detune: 5, level: 0.2 }],
    ['o3', 'oscillator', 280, 320, { wave: 'triangle', frequency: 110, detune: 0, level: 0.22 }],
    ['lfo', 'lfo', 280, 550, { shape: 'sine', rate: 0.06, depth: 0.0467 }],
    ['f', 'filter', 580, 120, { mode: 'lowpass', frequency: 620, q: 4.5 }],
    ['rv', 'reverb', 860, 120, { decay: 7.5, mix: 0.55 }],
    ['m', 'master', 1140, 120, { volume: 0.8, ceiling: -3 }],
  ],
  [
    ['rw', 'o1', 'param:detune'],
    ['rw', 'o2', 'param:detune'],
    ['o1', 'f'],
    ['o2', 'f'],
    ['o3', 'f'],
    ['lfo', 'f', 'param:frequency'],
    ['f', 'rv'],
    ['rv', 'm'],
  ],
);

const wind = build(
  'Wind',
  7741,
  [
    ['n', 'noise', 0, 40, { color: 'pink', level: 0.7 }],
    ['rw1', 'randomWalk', 0, 240, { rate: 0.7, step: 0.35, range: 0.0578 }],
    ['rw2', 'randomWalk', 0, 470, { rate: 0.25, step: 0.4, range: 0.35 }],
    ['f', 'filter', 300, 40, { mode: 'bandpass', frequency: 760, q: 2.8 }],
    ['g', 'gain', 580, 40, { gain: 0.55 }],
    ['lfo', 'lfo', 300, 330, { shape: 'sine', rate: 0.11, depth: 0.0803 }],
    ['rv', 'reverb', 840, 40, { decay: 4.5, mix: 0.4 }],
    ['m', 'master', 1120, 40, { volume: 0.9, ceiling: -3 }],
  ],
  [
    ['n', 'f'],
    ['rw1', 'f', 'param:frequency'],
    ['lfo', 'f', 'param:q'],
    ['f', 'g'],
    ['rw2', 'g', 'param:gain'],
    ['g', 'rv'],
    ['rv', 'm'],
  ],
);

const tension = build(
  'Tension Pulse',
  31337,
  [
    ['slow', 'lfo', 0, 360, { shape: 'triangle', rate: 0.04, depth: 0.07 }],
    ['o1', 'oscillator', 0, -120, { wave: 'square', frequency: 55, detune: 0, level: 0.35 }],
    ['o2', 'oscillator', 0, 110, { wave: 'sawtooth', frequency: 58.27, detune: 0, level: 0.18 }],
    ['rw', 'randomWalk', 300, 300, { rate: 4, step: 0.5, range: 0.0289 }],
    ['f', 'filter', 300, 0, { mode: 'lowpass', frequency: 420, q: 9 }],
    ['pulse', 'lfo', 300, 560, { shape: 'square', rate: 2, depth: 0.5 }],
    ['vca', 'gain', 580, 0, { gain: 0.5 }],
    ['d', 'delay', 840, 0, { time: 0.375, feedback: 0.5, mix: 0.35 }],
    ['rv', 'reverb', 1100, 0, { decay: 3, mix: 0.3 }],
    ['m', 'master', 1360, 0, { volume: 0.85, ceiling: -3 }],
  ],
  [
    ['o1', 'f'],
    ['o2', 'f'],
    ['rw', 'f', 'param:frequency'],
    ['f', 'vca'],
    ['slow', 'pulse', 'param:rate'],
    ['pulse', 'vca', 'param:gain'],
    ['vca', 'd'],
    ['d', 'rv'],
    ['rv', 'm'],
  ],
);

export const STARTER_PATCHES: PatchFile[] = [drone, wind, tension];
