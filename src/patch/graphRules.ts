import { isFeatureHandle, isVisualHandle, type GraphEdge, type GraphNode, type NodeKind } from './types';

interface Link {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Analysis outputs may only feed visual inputs, and visual inputs accept nothing else. */
export function isAllowedLink(link: Link, kindOf: (id: string) => NodeKind | undefined): boolean {
  if (link.source === link.target) return false;
  const fromFeature = isFeatureHandle(link.sourceHandle);
  const toVisual = isVisualHandle(link.targetHandle);
  if (fromFeature || toVisual) return fromFeature && toVisual && kindOf(link.target) === 'visual';
  return kindOf(link.target) !== 'visual';
}

const DELAY_KINDS: NodeKind[] = ['delay', 'tapeEcho'];

/**
 * Web Audio silences any feedback loop that has no DelayNode in it. Adding source→target
 * closes a loop iff target already reaches source; reject when some such path avoids every Delay module.
 */
export function createsDelayFreeCycle(
  nodes: Pick<GraphNode, 'id' | 'type'>[],
  edges: Pick<GraphEdge, 'source' | 'target'>[],
  source: string,
  target: string,
): boolean {
  const kind = new Map(nodes.map((n) => [n.id, n.type]));
  const isDelay = (id: string) => DELAY_KINDS.includes(kind.get(id) as NodeKind);
  if (isDelay(source) || isDelay(target)) return false;
  if (source === target) return true;

  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);

  const seen = new Set<string>([target]);
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    for (const to of next.get(id) ?? []) {
      if (to === source) return true;
      if (seen.has(to) || isDelay(to)) continue;
      seen.add(to);
      stack.push(to);
    }
  }
  return false;
}
