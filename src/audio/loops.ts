import { DEFAULT_PHRASE, num, str } from '@/patch/definitions';
import type { NodeData } from '@/patch/types';

export const PHRASE_KEY = 'phrase';

export interface PhraseNote {
  ratio: number;
  at: number;
}

export interface LoopSpec {
  cycle: number;
  /** Fraction of a cycle before the first one begins. */
  phase: number;
  notes: PhraseNote[];
}

/** Form-local [start, end) spans in which a loop may start notes; null means always. */
export type GateSpans = [number, number][];

const MAX_NOTES = 4;

export function parsePhrase(raw: string): PhraseNote[] {
  const notes = raw
    .trim()
    .split(/\s+/)
    .map((part) => part.split('@').map(Number))
    .filter(([r, t]) => Number.isFinite(r) && r > 0 && Number.isFinite(t) && t >= 0)
    .map(([ratio, at]) => ({ ratio, at }))
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_NOTES);
  return notes.length ? notes : parsePhrase(DEFAULT_PHRASE);
}

export const formatPhrase = (notes: PhraseNote[]) => notes.map((n) => `${n.ratio}@${n.at}`).join(' ');

export function loopSpec(data: NodeData): LoopSpec {
  const cycle = Math.min(60, Math.max(5, num(data, 'cycle', 12)));
  const notes = parsePhrase(str(data, PHRASE_KEY, DEFAULT_PHRASE)).map((n) => ({ ...n, at: Math.min(n.at, cycle * 0.95) }));
  return { cycle, phase: Math.min(0.999, Math.max(0, num(data, 'phase', 0))), notes };
}

/** Form-local start time of the i-th note of an endless loop; strictly increasing in i. */
export function noteTime(spec: LoopSpec, index: number): number {
  const n = spec.notes.length;
  const k = Math.floor(index / n);
  return (spec.phase + k) * spec.cycle + spec.notes[index % n].at;
}

/** Deterministic 0..1 value for cycle k of a loop with this cycle length. */
function cycleHash(k: number, cycle: number): number {
  let h = Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(Math.round(cycle * 1000), 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Whether the index-th note stays silent: room mode drops every other cycle, and Hours' `thin`
 * drops that share of whole cycles (never the first, so a loop is always heard once).
 */
export function loopSkips(spec: LoopSpec, data: NodeData, index: number): boolean {
  const k = Math.floor(index / spec.notes.length);
  if (num(data, 'room') > 0 && k % 2 === 1) return true;
  const thin = num(data, 'thin');
  return thin > 0 && k > 0 && cycleHash(k, spec.cycle) < thin;
}

export function gateOpen(spans: GateSpans | null | undefined, t: number): boolean {
  if (!spans) return true;
  return spans.some(([a, b]) => t >= a && t < b);
}

/** First note a loop actually sounds (respecting its gate) before `limit`, or null. */
export function firstNote(spec: LoopSpec, spans: GateSpans | null | undefined, limit: number): number | null {
  for (let i = 0; ; i++) {
    const t = noteTime(spec, i);
    if (t >= limit) return null;
    if (gateOpen(spans, t)) return t;
  }
}

/** Where in its current cycle a loop is at form time t (0..1), or null before its first cycle starts. */
export function cycleProgress(spec: LoopSpec, t: number): number | null {
  const local = t / spec.cycle - spec.phase;
  return local < 0 ? null : local - Math.floor(local);
}

/** Seconds since the most recent sounded note at or before t, or null if none. */
export function sinceLastNote(spec: LoopSpec, data: NodeData, spans: GateSpans | null | undefined, t: number): number | null {
  const local = t / spec.cycle - spec.phase;
  if (local < 0) return null;
  const k = Math.floor(local);
  const n = spec.notes.length;
  for (let i = (k + 1) * n - 1; i >= Math.max(0, (k - 1) * n); i--) {
    const at = noteTime(spec, i);
    if (at <= t && gateOpen(spans, at) && !loopSkips(spec, data, i)) return t - at;
  }
  return null;
}
