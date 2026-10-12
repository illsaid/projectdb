import type { Form } from '@/audio/form';
import type { Planting } from '@/audio/plantings';

export type NodeKind =
  | 'oscillator'
  | 'noise'
  | 'fm'
  | 'filter'
  | 'gain'
  | 'delay'
  | 'tapeEcho'
  | 'reverb'
  | 'chorus'
  | 'formant'
  | 'loopVoice'
  | 'lfo'
  | 'randomWalk'
  | 'master'
  | 'visual';

/** Kinds that become Web Audio nodes. */
export type AudioKind = Exclude<NodeKind, 'visual'>;

export type NodeData = Record<string, number | string>;

export interface GraphNode {
  id: string;
  type: NodeKind;
  data: NodeData;
}

export interface GraphEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

/** 128-bit seed as 32 hex characters. */
export type SeedHex = string;

export interface AudioGraph {
  seed: SeedHex;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Optional score the engine plays as automation; playback loops it. */
  form?: Form;
  /** Notes the listener planted during live playback. */
  plantings?: Planting[];
  /** Quieter, sparser playback; node-level effects are carried in node data. */
  room?: boolean;
  /** Pitch factor for planted notes, so they follow the drift when Hours shifts its register. */
  transpose?: number;
}

export interface PatchFile {
  format: 'patcher';
  version: 2;
  name: string;
  seed: SeedHex;
  nodes: (GraphNode & { position: { x: number; y: number } })[];
  edges: GraphEdge[];
  form?: Form;
  /** Local clock time (and blend) Hours mode had already baked into the nodes. */
  hours?: { clock: string; amount: number };
}

export const AUDIO_IN = 'in';
export const AUDIO_OUT = 'out';
export const PARAM_PREFIX = 'param:';

/** Analysis outputs (rms, low, …) on audio modules; they only ever feed the visual graph. */
export const FEATURE_PREFIX = 'feat:';
/** Visual inputs (hue, scale, …) on the Visual module. */
export const VISUAL_PREFIX = 'vis:';

export const paramHandleId = (key: string) => `${PARAM_PREFIX}${key}`;
export const featureHandleId = (key: string) => `${FEATURE_PREFIX}${key}`;
export const visualHandleId = (key: string) => `${VISUAL_PREFIX}${key}`;
export const isFeatureHandle = (h?: string | null) => !!h && h.startsWith(FEATURE_PREFIX);
export const isVisualHandle = (h?: string | null) => !!h && h.startsWith(VISUAL_PREFIX);
export const handleKey = (h: string) => h.slice(h.indexOf(':') + 1);
export const isParamHandle = (h?: string | null) => !!h && h.startsWith(PARAM_PREFIX);
export const paramKeyFromHandle = (h: string) => h.slice(PARAM_PREFIX.length);
