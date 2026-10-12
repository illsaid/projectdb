import { PRESET_CHOICE, VISUAL_INPUTS, envelopeDefaults } from '@/visual/inputs';
import type { NodeData, NodeKind } from './types';

export type Category = 'source' | 'processor' | 'modulator' | 'output';

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  unit?: string;
  /** Slider curve exponent; >1 gives finer control at the low end. */
  curve?: number;
  decimals?: number;
  modulatable?: boolean;
}

export interface ChoiceSpec {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
}

export interface NodeDef {
  kind: NodeKind;
  title: string;
  short: string;
  category: Category;
  hasInput: boolean;
  hasOutput: boolean;
  choices: ChoiceSpec[];
  params: ParamSpec[];
}

const WAVES = [
  { value: 'sine', label: 'SIN' },
  { value: 'sawtooth', label: 'SAW' },
  { value: 'square', label: 'SQR' },
  { value: 'triangle', label: 'TRI' },
];

export const VOWELS = ['a', 'e', 'i', 'o', 'u'] as const;

/** Loop Voice phrase as "ratio@seconds" pairs: pitch relative to its note, time into the cycle. */
export const DEFAULT_PHRASE = '1@0 1.5@1.1';

export const NODE_DEFS: Record<NodeKind, NodeDef> = {
  oscillator: {
    kind: 'oscillator',
    title: 'Oscillator',
    short: 'OSC',
    category: 'source',
    hasInput: false,
    hasOutput: true,
    choices: [{ key: 'wave', label: 'Wave', options: WAVES, default: 'sawtooth' }],
    params: [
      { key: 'frequency', label: 'Freq', min: 20, max: 4000, default: 110, unit: 'Hz', curve: 3, decimals: 1, modulatable: true },
      { key: 'detune', label: 'Detune', min: -1200, max: 1200, default: 0, unit: 'ct', decimals: 0, modulatable: true },
      { key: 'level', label: 'Level', min: 0, max: 1, default: 0.3, decimals: 2, modulatable: true },
    ],
  },
  noise: {
    kind: 'noise',
    title: 'Noise',
    short: 'NSE',
    category: 'source',
    hasInput: false,
    hasOutput: true,
    choices: [
      {
        key: 'color',
        label: 'Color',
        options: [
          { value: 'white', label: 'WHITE' },
          { value: 'pink', label: 'PINK' },
        ],
        default: 'white',
      },
    ],
    params: [{ key: 'level', label: 'Level', min: 0, max: 1, default: 0.3, decimals: 2, modulatable: true }],
  },
  fm: {
    kind: 'fm',
    title: 'FM Operator',
    short: 'FM',
    category: 'source',
    hasInput: false,
    hasOutput: true,
    choices: [
      {
        key: 'env',
        label: 'Env',
        options: [
          { value: 'hold', label: 'HOLD' },
          { value: 'strike', label: 'STRIKE' },
        ],
        default: 'hold',
      },
    ],
    params: [
      { key: 'frequency', label: 'Freq', min: 20, max: 4000, default: 220, unit: 'Hz', curve: 3, decimals: 1, modulatable: true },
      { key: 'ratio', label: 'Ratio', min: 0.25, max: 12, default: 2, curve: 2, decimals: 3, modulatable: true },
      { key: 'index', label: 'Index', min: 0, max: 20, default: 2, curve: 2, decimals: 2, modulatable: true },
      { key: 'detune', label: 'Detune', min: -1200, max: 1200, default: 0, unit: 'ct', decimals: 0, modulatable: true },
      { key: 'level', label: 'Level', min: 0, max: 1, default: 0.3, decimals: 2, modulatable: true },
      { key: 'density', label: 'Strikes', min: 0.02, max: 4, default: 0.3, unit: '/s', curve: 2, decimals: 2 },
      { key: 'decay', label: 'Decay', min: 0.1, max: 10, default: 3, unit: 's', curve: 1.5, decimals: 1 },
    ],
  },
  loopVoice: {
    kind: 'loopVoice',
    title: 'Loop Voice',
    short: 'LOOP',
    category: 'source',
    hasInput: false,
    hasOutput: true,
    choices: [
      {
        key: 'timbre',
        label: 'Timbre',
        options: [
          { value: 'sine', label: 'SINE' },
          { value: 'bell', label: 'BELL' },
          { value: 'pad', label: 'PAD' },
          { value: 'breath', label: 'AIR' },
        ],
        default: 'sine',
      },
    ],
    params: [
      { key: 'frequency', label: 'Note', min: 60, max: 2400, default: 523.25, unit: 'Hz', curve: 3, decimals: 1 },
      { key: 'cycle', label: 'Cycle', min: 5, max: 60, default: 12, unit: 's', curve: 1.5, decimals: 2 },
      { key: 'phase', label: 'Phase', min: 0, max: 1, default: 0, decimals: 3 },
      { key: 'attack', label: 'Attack', min: 0.05, max: 3, default: 0.4, unit: 's', curve: 2, decimals: 2 },
      { key: 'release', label: 'Release', min: 1, max: 12, default: 5, unit: 's', curve: 1.5, decimals: 1 },
      { key: 'level', label: 'Level', min: 0, max: 1, default: 0.3, decimals: 2, modulatable: true },
      { key: 'pan', label: 'Pan', min: -1, max: 1, default: 0, decimals: 2, modulatable: true },
    ],
  },
  filter: {
    kind: 'filter',
    title: 'Filter',
    short: 'FLT',
    category: 'processor',
    hasInput: true,
    hasOutput: true,
    choices: [
      {
        key: 'mode',
        label: 'Mode',
        options: [
          { value: 'lowpass', label: 'LP' },
          { value: 'highpass', label: 'HP' },
          { value: 'bandpass', label: 'BP' },
        ],
        default: 'lowpass',
      },
    ],
    params: [
      { key: 'frequency', label: 'Cutoff', min: 20, max: 18000, default: 1200, unit: 'Hz', curve: 3, decimals: 0, modulatable: true },
      { key: 'q', label: 'Q', min: 0.1, max: 30, default: 1, curve: 2, decimals: 2, modulatable: true },
    ],
  },
  gain: {
    kind: 'gain',
    title: 'Gain',
    short: 'VCA',
    category: 'processor',
    hasInput: true,
    hasOutput: true,
    choices: [
      {
        key: 'shape',
        label: 'Shape',
        options: [
          { value: 'clean', label: 'CLEAN' },
          { value: 'soft', label: 'SOFT' },
          { value: 'steps', label: 'STEPS' },
        ],
        default: 'clean',
      },
    ],
    params: [
      { key: 'gain', label: 'Gain', min: 0, max: 2, default: 0.8, decimals: 2, modulatable: true },
      { key: 'bits', label: 'Bits', min: 2, max: 8, default: 4, decimals: 0 },
    ],
  },
  delay: {
    kind: 'delay',
    title: 'Delay',
    short: 'DLY',
    category: 'processor',
    hasInput: true,
    hasOutput: true,
    choices: [],
    params: [
      { key: 'time', label: 'Time', min: 0.01, max: 2, default: 0.35, unit: 's', curve: 2, decimals: 3, modulatable: true },
      { key: 'feedback', label: 'Fdbk', min: 0, max: 0.95, default: 0.45, decimals: 2, modulatable: true },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.4, decimals: 2, modulatable: true },
    ],
  },
  tapeEcho: {
    kind: 'tapeEcho',
    title: 'Tape Echo',
    short: 'TAPE',
    category: 'processor',
    hasInput: true,
    hasOutput: true,
    choices: [],
    params: [
      { key: 'time', label: 'Time', min: 1, max: 8, default: 3, unit: 's', curve: 1.5, decimals: 2, modulatable: true },
      { key: 'feedback', label: 'Fdbk', min: 0, max: 0.97, default: 0.6, decimals: 2, modulatable: true },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.3, decimals: 2, modulatable: true },
      { key: 'tone', label: 'Tone', min: 600, max: 12000, default: 3200, unit: 'Hz', curve: 2, decimals: 0 },
      { key: 'wear', label: 'Wear', min: 0, max: 1, default: 0.3, decimals: 2 },
      { key: 'wow', label: 'Wow', min: 0.2, max: 1, default: 0.4, unit: 'Hz', decimals: 2 },
      { key: 'flutter', label: 'Flutter', min: 6, max: 12, default: 8, unit: 'Hz', decimals: 1 },
    ],
  },
  reverb: {
    kind: 'reverb',
    title: 'Reverb',
    short: 'REV',
    category: 'processor',
    hasInput: true,
    hasOutput: true,
    choices: [],
    params: [
      { key: 'decay', label: 'Decay', min: 0.3, max: 10, default: 3, unit: 's', curve: 1.5, decimals: 1 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.35, decimals: 2, modulatable: true },
    ],
  },
  chorus: {
    kind: 'chorus',
    title: 'Chorus',
    short: 'CHO',
    category: 'processor',
    hasInput: true,
    hasOutput: true,
    choices: [
      {
        key: 'voices',
        label: 'Voices',
        options: [
          { value: '2', label: '2' },
          { value: '3', label: '3' },
        ],
        default: '3',
      },
    ],
    params: [
      { key: 'rate', label: 'Rate', min: 0.02, max: 6, default: 0.4, unit: 'Hz', curve: 2.5, decimals: 2, modulatable: true },
      { key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.4, decimals: 2, modulatable: true },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, decimals: 2, modulatable: true },
    ],
  },
  formant: {
    kind: 'formant',
    title: 'Formant',
    short: 'VOX',
    category: 'processor',
    hasInput: true,
    hasOutput: true,
    choices: [{ key: 'vowel', label: 'Vowel', options: VOWELS.map((v) => ({ value: v, label: v.toUpperCase() })), default: 'a' }],
    params: [
      { key: 'morph', label: 'Morph', min: 0, max: 1, default: 0, decimals: 3, modulatable: true },
      { key: 'q', label: 'Q', min: 2, max: 30, default: 10, curve: 1.5, decimals: 1, modulatable: true },
      { key: 'level', label: 'Level', min: 0, max: 4, default: 2, decimals: 2, modulatable: true },
    ],
  },
  lfo: {
    kind: 'lfo',
    title: 'LFO',
    short: 'LFO',
    category: 'modulator',
    hasInput: false,
    hasOutput: true,
    choices: [{ key: 'shape', label: 'Shape', options: WAVES, default: 'sine' }],
    params: [
      { key: 'rate', label: 'Rate', min: 0.01, max: 40, default: 0.5, unit: 'Hz', curve: 3, decimals: 2, modulatable: true },
      { key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.25, curve: 3, decimals: 4, modulatable: true },
    ],
  },
  randomWalk: {
    kind: 'randomWalk',
    title: 'Random Walk',
    short: 'RND',
    category: 'modulator',
    hasInput: false,
    hasOutput: true,
    choices: [],
    params: [
      { key: 'rate', label: 'Rate', min: 0.05, max: 30, default: 2, unit: 'Hz', curve: 2.5, decimals: 2 },
      { key: 'step', label: 'Step', min: 0.01, max: 1, default: 0.25, decimals: 2 },
      { key: 'range', label: 'Range', min: 0, max: 1, default: 0.25, curve: 3, decimals: 4, modulatable: true },
    ],
  },
  master: {
    kind: 'master',
    title: 'Master',
    short: 'OUT',
    category: 'output',
    hasInput: true,
    hasOutput: false,
    choices: [],
    params: [
      { key: 'volume', label: 'Volume', min: 0, max: 1.5, default: 0.8, decimals: 2 },
      { key: 'ceiling', label: 'Ceiling', min: -24, max: 0, default: -3, unit: 'dB', decimals: 1 },
    ],
  },
  visual: {
    kind: 'visual',
    title: 'Visual',
    short: 'VIS',
    category: 'output',
    hasInput: false,
    hasOutput: false,
    choices: [PRESET_CHOICE],
    params: VISUAL_INPUTS,
  },
};

/** Kinds that may appear at most once per patch. */
export const SINGLETON_KINDS: NodeKind[] = ['master', 'visual'];

/** Kinds that expose analysis outputs for the visual graph. */
export const hasFeatureOutputs = (kind: NodeKind) => kind !== 'visual';

export const PALETTE_ORDER: NodeKind[] = [
  'oscillator',
  'fm',
  'loopVoice',
  'noise',
  'filter',
  'formant',
  'gain',
  'delay',
  'tapeEcho',
  'chorus',
  'reverb',
  'lfo',
  'randomWalk',
  'master',
  'visual',
];

export function defaultData(kind: NodeKind): NodeData {
  const def = NODE_DEFS[kind];
  const data: NodeData = {};
  for (const c of def.choices) data[c.key] = c.default;
  for (const p of def.params) data[p.key] = p.default;
  if (kind === 'loopVoice') data.phrase = DEFAULT_PHRASE;
  return kind === 'visual' ? { ...data, ...envelopeDefaults() } : data;
}

/** Half the target's span: a full-depth (1.0) modulator sweeps the whole parameter range. */
export function modulationScale(kind: NodeKind, paramKey: string): number | null {
  const spec = NODE_DEFS[kind].params.find((p) => p.key === paramKey && p.modulatable);
  return spec ? (spec.max - spec.min) / 2 : null;
}

export function num(data: NodeData, key: string, fallback = 0): number {
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(data: NodeData, key: string, fallback: string): string {
  const v = data[key];
  return typeof v === 'string' ? v : fallback;
}
