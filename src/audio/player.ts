import type { AudioGraph } from '@/patch/types';
import { AudioEngine } from './engine';
import { featuresFromWindow, SPAN, type FeatureMap, type Features } from './features';
import { formPosition, loopPeriod, type Form, type FormPosition } from './form';
import { PlantLayer } from './plantings';

/** A pass is built this long before it starts, so its automation is in place in time. */
const LEAD = 0.5;
/** Extra life after a pass's form ends, covering the final silence ramp. */
const TAIL = 0.25;
const LIVE_START_DELAY = 0.05;

interface Pass {
  index: number;
  origin: number;
  engine: AudioEngine;
  /** Which tap node of this pass is wired into each shared tap bus. */
  wired: Map<string, AudioNode>;
  /** Where planted notes enter this pass. */
  plantInput: AudioNode | null;
}

interface Bus {
  sum: GainNode;
  analyser: AnalyserNode | null;
}

export interface PlayerOptions {
  /** Where every pass's Master sends audio; defaults to the speakers. */
  destination?: AudioNode;
  /** Live meters and features need analysers; offline renders only need the summed taps. */
  analyse: boolean;
  /** Node ids to keep a summed tap for; 'all' follows the graph. */
  taps: 'all' | string[];
  /** Context time at which the form starts; live playback uses "now" on every restart. */
  start?: number;
}

/**
 * Plays a graph through one engine per pass of its form. A new pass starts as the previous one
 * fades out, giving a crossfade at the loop point. Live playback and offline rendering share this
 * class, so the score is scheduled identically in both.
 */
export class Player {
  private passes: Pass[] = [];
  private graph: AudioGraph | null = null;
  private start = 0;
  private buses = new Map<string, Bus>();
  private scratch = new Float32Array(SPAN);
  private plants: PlantLayer;

  constructor(
    readonly ctx: BaseAudioContext,
    private options: PlayerOptions,
  ) {
    if (options.taps !== 'all') for (const id of options.taps) this.bus(id);
    this.plants = new PlantLayer(ctx);
  }

  get form(): Form | null {
    return this.graph?.form ?? null;
  }

  reconcile(graph: AudioGraph) {
    const prev = this.graph;
    this.graph = graph;
    if (!prev || prev.seed !== graph.seed || prev.form !== graph.form) {
      this.restart();
    } else {
      for (const pass of this.passes) this.sync(pass);
    }
    if (this.options.taps === 'all') this.pruneBuses();
    this.plants.set(graph.plantings ?? [], this.start, !!graph.room, graph.transpose);
  }

  /** Queues time-driven automation and builds the passes needed up to `until`. */
  schedule(until: number) {
    const form = this.form;
    if (form) {
      const now = this.ctx.currentTime;
      let last = this.passes[this.passes.length - 1];
      while (last && this.originOf(last.index + 1) - LEAD <= until) {
        last = this.addPass(last.index + 1);
      }
      for (const pass of [...this.passes]) {
        if (pass !== last && now > pass.origin + form.length + TAIL) this.dropPass(pass);
      }
    }
    for (const pass of this.passes) pass.engine.schedule(until);
    this.plants.schedule(until);
  }

  /** Seconds since playback (re)started; plantings are timed against this. */
  elapsed(): number {
    return this.ctx.currentTime - this.start;
  }

  /** Where the newest audible pass is in the form, or null when the graph has no form. */
  position(): FormPosition | null {
    const form = this.form;
    return form ? formPosition(form, this.ctx.currentTime - this.start) : null;
  }

  /** Sum of a node's tap across every live pass. */
  tap(id: string): AudioNode | null {
    return this.buses.get(id)?.sum ?? null;
  }

  getLevel(id: string): number {
    const analyser = this.buses.get(id)?.analyser;
    if (!analyser) return 0;
    const buf = this.scratch.subarray(0, analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i]);
      if (v > peak) peak = v;
    }
    return peak;
  }

  getWaveform(id: string, out: Float32Array): boolean {
    const analyser = this.buses.get(id)?.analyser;
    if (!analyser) return false;
    analyser.getFloatTimeDomainData(out.subarray(0, analyser.fftSize));
    return true;
  }

  /** Per-node analysis features for this instant, using the same math as offline export. */
  computeFeatures(): FeatureMap {
    const out = new Map<string, Features>();
    for (const [id, bus] of this.buses) {
      if (!bus.analyser) continue;
      bus.analyser.getFloatTimeDomainData(this.scratch);
      out.set(id, featuresFromWindow(this.scratch, this.ctx.sampleRate));
    }
    return out;
  }

  dispose() {
    for (const pass of [...this.passes]) this.dropPass(pass);
    this.plants.dispose();
    for (const bus of this.buses.values()) {
      bus.sum.disconnect();
      bus.analyser?.disconnect();
    }
    this.buses.clear();
  }

  private restart() {
    for (const pass of [...this.passes]) this.dropPass(pass);
    this.start = this.options.start ?? this.ctx.currentTime + LIVE_START_DELAY;
    this.addPass(0);
  }

  private originOf(index: number): number {
    const form = this.form;
    return form ? this.start + index * loopPeriod(form) : this.start;
  }

  private addPass(index: number): Pass {
    const origin = this.originOf(index);
    const engine = new AudioEngine(this.ctx, { destination: this.options.destination, origin });
    const pass: Pass = { index, origin, engine, wired: new Map(), plantInput: null };
    this.passes.push(pass);
    this.sync(pass);
    return pass;
  }

  private sync(pass: Pass) {
    if (!this.graph) return;
    pass.engine.reconcile(this.graph);
    this.wirePlants(pass, this.graph);
    const ids = this.options.taps === 'all' ? [...pass.engine.nodeIds()] : this.options.taps;
    for (const [id, tap] of pass.wired) {
      if (ids.includes(id)) continue;
      const bus = this.buses.get(id);
      if (bus) safeDisconnect(tap, bus.sum);
      pass.wired.delete(id);
    }
    for (const id of ids) {
      const tap = pass.engine.getTap(id);
      const wired = pass.wired.get(id);
      if (tap === wired) continue;
      if (wired) safeDisconnect(wired, this.bus(id).sum);
      if (tap) {
        tap.connect(this.bus(id).sum);
        pass.wired.set(id, tap);
      } else {
        pass.wired.delete(id);
      }
    }
  }

  /** Planted notes share the drift's reverb when it has one, so they sit in the same space. */
  private wirePlants(pass: Pass, graph: AudioGraph) {
    const target = graph.nodes.find((n) => n.type === 'reverb') ?? graph.nodes.find((n) => n.type === 'master');
    const input = target ? pass.engine.getInput(target.id) : null;
    if (input === pass.plantInput) return;
    if (pass.plantInput) safeDisconnect(this.plants.output, pass.plantInput);
    if (input) this.plants.output.connect(input);
    pass.plantInput = input;
  }

  private dropPass(pass: Pass) {
    if (pass.plantInput) safeDisconnect(this.plants.output, pass.plantInput);
    for (const [id, tap] of pass.wired) {
      const bus = this.buses.get(id);
      if (bus) safeDisconnect(tap, bus.sum);
    }
    pass.engine.dispose();
    this.passes = this.passes.filter((p) => p !== pass);
  }

  private bus(id: string): Bus {
    let bus = this.buses.get(id);
    if (!bus) {
      const sum = new GainNode(this.ctx);
      const analyser = this.options.analyse ? new AnalyserNode(this.ctx, { fftSize: SPAN }) : null;
      if (analyser) sum.connect(analyser);
      bus = { sum, analyser };
      this.buses.set(id, bus);
    }
    return bus;
  }

  private pruneBuses() {
    const keep = new Set(this.graph?.nodes.map((n) => n.id));
    for (const [id, bus] of this.buses) {
      if (keep.has(id)) continue;
      bus.sum.disconnect();
      bus.analyser?.disconnect();
      this.buses.delete(id);
    }
  }
}

function safeDisconnect(from: AudioNode, to: AudioNode) {
  try {
    from.disconnect(to);
  } catch {
    // already torn down along with its node
  }
}
