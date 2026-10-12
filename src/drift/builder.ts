import { defaultData } from '@/patch/definitions';
import type { GraphEdge, NodeData, NodeKind, PatchFile } from '@/patch/types';

export const COLUMN_WIDTH = 300;
const ROW_HEIGHT = 250;

export type PatchNodeSpec = PatchFile['nodes'][number];

/** Collects generated modules and wires with a readable left-to-right layout for the patcher. */
export class PatchBuilder {
  readonly nodes: PatchNodeSpec[] = [];
  readonly edges: GraphEdge[] = [];
  private rows = new Map<number, number>();
  private counts = new Map<NodeKind, number>();

  add(kind: NodeKind, column: number, data: NodeData): string {
    const n = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, n);
    const row = this.rows.get(column) ?? 0;
    this.rows.set(column, row + 1);
    const id = `${kind}-${n}`;
    this.nodes.push({
      id,
      type: kind,
      position: { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT },
      data: { ...defaultData(kind), ...data },
    });
    return id;
  }

  wire(source: string, target: string, targetHandle = 'in', sourceHandle = 'out') {
    this.edges.push({ id: `e${this.edges.length + 1}`, source, sourceHandle, target, targetHandle });
  }

  data(id: string): NodeData {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) throw new Error(`Unknown generated module ${id}`);
    return node.data;
  }
}
