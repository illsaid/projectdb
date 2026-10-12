import { modulationScale } from '@/patch/definitions';
import {
  AUDIO_IN,
  type AudioKind,
  isFeatureHandle,
  isParamHandle,
  isVisualHandle,
  paramKeyFromHandle,
  type AudioGraph,
  type GraphEdge,
  type NodeData,
  type NodeKind,
} from '@/patch/types';
import { LANE_FLOOR, laneValueAt, type Form } from './form';
import type { EngineNode, FormTarget } from './factoryKit';
import { createEngineNode } from './nodeFactories';

interface LiveNode {
  kind: NodeKind;
  data: NodeData;
  node: EngineNode;
}

interface Connection {
  source: string;
  target: string;
  from: AudioNode;
  to: AudioNode | AudioParam;
  /** Param edges only: gain of the per-connection scaler that maps -1..1 onto the target's range. */
  scale: number | null;
  scaler?: GainNode;
}

export interface EngineOptions {
  /** Where Master sends its output; defaults to the context's speakers. */
  destination?: AudioNode;
  /** Context time at which this engine's timeline (and its score) starts. */
  origin: number;
}

/** After the form's last point the fade goes fully silent so a finished pass can be torn down without a click. */
const SILENCE_RAMP = 0.05;

const toParamValue = (target: FormTarget, v: number) =>
  target.mode === 'cents' ? 1200 * Math.log2(Math.max(LANE_FLOOR, v)) : Math.max(LANE_FLOOR, v);

const edgeKey = (e: GraphEdge) =>
  `${e.source}|${e.sourceHandle ?? ''}|${e.target}|${e.targetHandle ?? AUDIO_IN}`;

/**
 * Owns every AudioNode. The only way to change the sound is `reconcile(graph)`,
 * which diffs the desired graph against what is currently alive.
 */
export class AudioEngine {
  private nodes = new Map<string, LiveNode>();
  private connections = new Map<string, Connection>();
  private seed: string | null = null;
  private form: Form | null = null;

  constructor(
    readonly ctx: BaseAudioContext,
    private options: EngineOptions,
  ) {}

  reconcile(graph: AudioGraph) {
    if (graph.seed !== this.seed) {
      for (const id of [...this.nodes.keys()]) this.destroyNode(id);
      this.seed = graph.seed;
    }
    const formChanged = (graph.form ?? null) !== this.form;
    this.form = graph.form ?? null;

    const wanted = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const [id, live] of this.nodes) {
      const next = wanted.get(id);
      if (!next || next.type !== live.kind) this.destroyNode(id);
    }

    for (const gn of graph.nodes) {
      if (gn.type === 'visual') continue;
      const live = this.nodes.get(gn.id);
      if (!live) {
        this.createNode(gn.id, gn.type, gn.data);
        this.applyForm(gn.id);
      } else if (formChanged) {
        this.applyForm(gn.id);
      }
      if (live && live.data !== gn.data) {
        live.node.update(gn.data);
        live.data = gn.data;
      }
    }

    const desired = new Map<string, Connection>();
    for (const e of graph.edges) {
      const conn = this.resolve(e);
      if (conn) desired.set(edgeKey(e), conn);
    }

    for (const [key, conn] of this.connections) {
      const want = desired.get(key);
      if (!want || want.from !== conn.from || want.to !== conn.to || want.scale !== conn.scale) {
        this.disconnect(conn);
        this.connections.delete(key);
      }
    }
    for (const [key, conn] of desired) {
      if (this.connections.has(key)) continue;
      this.connect(conn);
      this.connections.set(key, conn);
    }
  }

  /** Lets time-driven nodes (Random Walk) queue automation up to `until`. */
  schedule(until: number) {
    for (const { node } of this.nodes.values()) node.schedule?.(until);
  }

  /** The signal a node's meter and analysis read from. */
  getTap(id: string): AudioNode | null {
    return this.nodes.get(id)?.node.meterTap ?? null;
  }

  getInput(id: string): AudioNode | null {
    return this.nodes.get(id)?.node.input ?? null;
  }

  nodeIds(): IterableIterator<string> {
    return this.nodes.keys();
  }

  dispose() {
    for (const id of [...this.nodes.keys()]) this.destroyNode(id);
  }

  private createNode(id: string, kind: AudioKind, data: NodeData) {
    const realtime = typeof AudioContext !== 'undefined' && this.ctx instanceof AudioContext;
    const destination = this.options.destination ?? this.ctx.destination;
    const node = createEngineNode(
      kind,
      { ctx: this.ctx, id, seed: this.seed ?? '', realtime, destination, origin: this.options.origin },
      data,
    );
    this.nodes.set(id, { kind, data, node });
  }

  /** Writes the score's lanes for one module as AudioParam automation, from now until the end of the form. */
  private applyForm(id: string) {
    const node = this.nodes.get(id)?.node;
    node?.setGate?.(this.form?.gates?.find((g) => g.node === id)?.spans ?? null);
    const targets = node?.form;
    if (!targets) return;
    const now = this.ctx.currentTime;
    const { origin } = this.options;
    for (const [key, target] of Object.entries(targets)) {
      const { param } = target;
      param.cancelScheduledValues(now);
      const lane = this.form?.lanes.find((l) => l.node === id && l.key === key);
      if (!lane) {
        param.setValueAtTime(toParamValue(target, 1), now);
        continue;
      }
      const local = Math.max(0, now - origin);
      param.setValueAtTime(toParamValue(target, laneValueAt(lane.points, local)), now);
      for (const [t, v] of lane.points) {
        const at = origin + t;
        if (at <= now) continue;
        if (target.mode === 'cents') param.linearRampToValueAtTime(toParamValue(target, v), at);
        else param.exponentialRampToValueAtTime(toParamValue(target, v), at);
      }
      if (key === 'fade' && this.form) param.linearRampToValueAtTime(0, Math.max(now, origin + this.form.length) + SILENCE_RAMP);
    }
  }

  private destroyNode(id: string) {
    const live = this.nodes.get(id);
    if (!live) return;
    for (const [key, conn] of this.connections) {
      if (conn.source === id || conn.target === id) {
        this.disconnect(conn);
        this.connections.delete(key);
      }
    }
    live.node.dispose();
    this.nodes.delete(id);
  }

  private resolve(e: GraphEdge): Connection | null {
    const src = this.nodes.get(e.source)?.node;
    const dstLive = this.nodes.get(e.target);
    if (!src?.output || !dstLive || e.source === e.target) return null;
    if (isFeatureHandle(e.sourceHandle) || isVisualHandle(e.targetHandle)) return null;
    const base = { source: e.source, target: e.target, from: src.output };
    if (isParamHandle(e.targetHandle)) {
      const key = paramKeyFromHandle(e.targetHandle!);
      const to = dstLive.node.params[key];
      const scale = modulationScale(dstLive.kind, key);
      return to && scale !== null ? { ...base, to, scale } : null;
    }
    return dstLive.node.input ? { ...base, to: dstLive.node.input, scale: null } : null;
  }

  private connect(conn: Connection) {
    if (conn.scale === null) {
      conn.from.connect(conn.to as AudioNode);
      return;
    }
    conn.scaler = new GainNode(this.ctx, { gain: conn.scale });
    conn.from.connect(conn.scaler);
    conn.scaler.connect(conn.to as AudioParam);
  }

  private disconnect(conn: Connection) {
    try {
      conn.from.disconnect(conn.scaler ?? (conn.to as AudioNode));
    } catch {
      // the pair was already torn down when one side was disposed
    }
    conn.scaler?.disconnect();
    conn.scaler = undefined;
  }
}
