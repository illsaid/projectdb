import { num } from '@/patch/definitions';
import type { AudioGraph, GraphNode } from '@/patch/types';

/** Lower output by 6 dB and pull the ceiling down as far again, which flattens any transient left. */
const ROOM_VOLUME = 0.5;
const ROOM_CEILING_DROP = 6;
const ROOM_DENSITY = 0.5;

function roomNode(node: GraphNode): GraphNode {
  const { data } = node;
  switch (node.type) {
    case 'fm':
      return { ...node, data: { ...data, room: 1, density: num(data, 'density', 0.3) * ROOM_DENSITY } };
    case 'master':
      return {
        ...node,
        data: { ...data, volume: num(data, 'volume', 0.8) * ROOM_VOLUME, ceiling: Math.max(-24, num(data, 'ceiling', -3) - ROOM_CEILING_DROP) },
      };
    case 'loopVoice':
    case 'visual':
      return { ...node, data: { ...data, room: 1 } };
    default:
      return node;
  }
}

/** Room mode for background listening: half the events, softer onsets, calmer visuals, 6 dB down. */
export function roomGraph(graph: AudioGraph): AudioGraph {
  return { ...graph, room: true, nodes: graph.nodes.map(roomNode) };
}
