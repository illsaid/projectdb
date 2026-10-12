import type { Edge, Node } from '@xyflow/react';
import type { FeatureKey } from '@/audio/features';
import { FEATURE_KEYS } from '@/audio/features';
import { parseForm, type Form } from '@/audio/form';
import { legacySeed, parseSeed } from '@/audio/random';
import { VISUAL_INPUT_KEYS, type VisualInputKey } from '@/visual/inputs';
import { modulationScale, NODE_DEFS, SINGLETON_KINDS } from './definitions';
import {
  handleKey,
  isFeatureHandle,
  isParamHandle,
  isVisualHandle,
  paramKeyFromHandle,
  type AudioGraph,
  type GraphEdge,
  type GraphNode,
  type NodeData,
  type NodeKind,
  type PatchFile,
  type SeedHex,
} from './types';

export type PatchFlowNode = Node<NodeData, NodeKind>;

export function styleEdge<E extends GraphEdge>(e: E): Edge {
  if (isVisualHandle(e.targetHandle)) return { ...e, className: 'edge-vis', animated: true };
  const mod = isParamHandle(e.targetHandle);
  return { ...e, className: mod ? 'edge-mod' : 'edge-audio', animated: mod };
}

/** Edges from analysis outputs into visual inputs belong to the visual graph, never to Web Audio. */
export const isVisualEdge = (e: Pick<GraphEdge, 'sourceHandle' | 'targetHandle'>) =>
  isFeatureHandle(e.sourceHandle) || isVisualHandle(e.targetHandle);

/** Every module and wire in the patch, audio and visual alike. */
export function patchGraph(nodes: PatchFlowNode[], edges: Edge[], seed: SeedHex, form?: Form): AudioGraph {
  return {
    seed,
    form,
    nodes: nodes.map((n) => ({ id: n.id, type: n.type as NodeKind, data: n.data })),
    edges: edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({ id, source, sourceHandle, target, targetHandle })),
  };
}

/** The subset of a patch that becomes Web Audio nodes and connections. */
export function audioOnly(graph: AudioGraph): AudioGraph {
  return {
    seed: graph.seed,
    form: graph.form,
    nodes: graph.nodes.filter((n) => n.type !== 'visual'),
    edges: graph.edges.filter((e) => !isVisualEdge(e)),
  };
}

export interface VisualLink {
  source: string;
  feature: FeatureKey;
  input: VisualInputKey;
}

export interface VisualGraph {
  node: GraphNode | null;
  links: VisualLink[];
}

export function toVisualGraph({ nodes, edges }: Pick<AudioGraph, 'nodes' | 'edges'>): VisualGraph {
  const node = nodes.find((n) => n.type === 'visual');
  if (!node) return { node: null, links: [] };
  const links = edges.flatMap((e): VisualLink[] => {
    if (e.target !== node.id || !isFeatureHandle(e.sourceHandle) || !isVisualHandle(e.targetHandle)) return [];
    const feature = handleKey(e.sourceHandle!) as FeatureKey;
    const input = handleKey(e.targetHandle!) as VisualInputKey;
    if (!FEATURE_KEYS.includes(feature) || !VISUAL_INPUT_KEYS.includes(input)) return [];
    return [{ source: e.source, feature, input }];
  });
  return { node: { id: node.id, type: node.type, data: node.data }, links };
}

export function toPatchFile(name: string, seed: SeedHex, nodes: PatchFlowNode[], edges: Edge[], form?: Form): PatchFile {
  const graph = patchGraph(nodes, edges, seed);
  return {
    ...(form && { form }),
    format: 'patcher',
    version: 2,
    name,
    seed,
    nodes: graph.nodes.map((n, i) => ({
      ...n,
      position: { x: Math.round(nodes[i].position.x), y: Math.round(nodes[i].position.y) },
    })),
    edges: graph.edges,
  };
}

export function fromPatchFile(file: PatchFile): { nodes: PatchFlowNode[]; edges: Edge[] } {
  return {
    nodes: file.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { ...n.data } })),
    edges: file.edges.map(styleEdge),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function parsePatchFile(raw: unknown): PatchFile {
  if (!isObj(raw) || raw.format !== 'patcher' || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error('This file is not a patch saved from this app.');
  }
  const seed =
    (typeof raw.seed === 'string' && parseSeed(raw.seed)) ||
    legacySeed(typeof raw.seed === 'number' ? raw.seed : 1);
  const nodes = raw.nodes.map((n) => {
    if (!isObj(n) || typeof n.id !== 'string' || typeof n.type !== 'string' || !(n.type in NODE_DEFS)) {
      throw new Error('The patch contains an unknown module.');
    }
    const pos = isObj(n.position) ? n.position : {};
    const data: NodeData = {};
    if (isObj(n.data)) {
      for (const [k, v] of Object.entries(n.data)) {
        if (typeof v === 'number' || typeof v === 'string') data[k] = v;
      }
    }
    return {
      id: n.id,
      type: n.type as NodeKind,
      data,
      position: { x: Number(pos.x) || 0, y: Number(pos.y) || 0 },
    };
  });
  for (const kind of SINGLETON_KINDS) {
    if (nodes.filter((n) => n.type === kind).length > 1) {
      throw new Error(`A patch can only have one ${NODE_DEFS[kind].title} module.`);
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = raw.edges.filter(isObj).flatMap((e, i) => {
    if (typeof e.source !== 'string' || typeof e.target !== 'string') return [];
    if (!ids.has(e.source) || !ids.has(e.target)) return [];
    return [
      {
        id: typeof e.id === 'string' ? e.id : `e${i}`,
        source: e.source,
        target: e.target,
        sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : 'out',
        targetHandle: typeof e.targetHandle === 'string' ? e.targetHandle : 'in',
      },
    ];
  });
  if (raw.version !== 2) migrateAbsoluteDepths(nodes, edges);
  const form = parseForm(raw.form, ids);
  return {
    format: 'patcher',
    version: 2,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : 'Untitled',
    seed,
    nodes,
    edges,
    ...(form && { form }),
  };
}

const AMOUNT_KEY: Partial<Record<NodeKind, string>> = { lfo: 'depth', randomWalk: 'range' };

/** v1 stored modulator depth in the target's units; v2 stores a 0–1 amount scaled per connection. */
function migrateAbsoluteDepths(nodes: PatchFile['nodes'], edges: GraphEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const key = AMOUNT_KEY[n.type];
    const value = key ? n.data[key] : undefined;
    if (!key || typeof value !== 'number') continue;
    const firstTarget = edges.find((e) => e.source === n.id && isParamHandle(e.targetHandle));
    const target = firstTarget && byId.get(firstTarget.target);
    const scale = target ? modulationScale(target.type, paramKeyFromHandle(firstTarget.targetHandle!)) : null;
    n.data[key] = Math.min(1, Math.max(0, scale ? value / scale : value));
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'patch';
}
