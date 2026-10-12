import { between, rngFor } from '@/audio/random';
import { num } from '@/patch/definitions';
import type { GraphNode, PatchFile, SeedHex } from '@/patch/types';
import { hueToward, mapPalette } from '@/visual/color';

/** Local wall-clock time to the minute, e.g. "2025-03-14T07:42". */
export type HoursClock = string;

export interface HoursSetting {
  clock: HoursClock;
  /** 0..1 blend, so switching Hours on or off ramps in rather than jumps. */
  amount: number;
}

export interface HoursState {
  /** -1 deep night … +1 late morning. */
  daylight: number;
  /** -1 midwinter … +1 midsummer. */
  warmth: number;
}

const DARKEST = 1.5;
const BRIGHTEST = 10.5;
const RISE = BRIGHTEST - DARKEST;
const WARMEST_DAY = 200;
const WARM_HUE = 32;
const COOL_HUE = 205;

const pad = (n: number) => String(n).padStart(2, '0');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clockOf(date: Date): HoursClock {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseClock(clock: HoursClock): { hours: number; day: number } {
  const [date, time] = clock.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const day = (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000;
  return { hours: hh + mm / 60, day };
}

/**
 * Where the clock sits in the day and the year, nudged per seed so drifts don't all move in lockstep.
 * Daylight climbs from its low before dawn to a peak mid-morning, then sinks slowly through evening.
 */
export function hoursState(seed: SeedHex, clock: HoursClock): HoursState {
  const rng = rngFor(seed, 'hours');
  const shift = between(rng, -0.75, 0.75);
  const depth = between(rng, 0.75, 1);
  const { hours, day } = parseClock(clock);
  const p = (((hours - DARKEST - shift) % 24) + 24) % 24;
  const x = p < RISE ? (p / RISE) * 0.5 : 0.5 + ((p - RISE) / (24 - RISE)) * 0.5;
  return {
    daylight: -Math.cos(2 * Math.PI * x) * depth,
    warmth: Math.cos((2 * Math.PI * (day - WARMEST_DAY)) / 365.25),
  };
}

const registerOf = (daylight: number) => 2 ** ((2 * daylight) / 12);

/** Pitch factor Hours applies, for notes that live outside the patch (plantings). */
export function hoursTranspose(seed: SeedHex, setting: HoursSetting): number {
  return registerOf(hoursState(seed, setting.clock).daylight * setting.amount);
}

/** Morning: brighter, higher, sparser. Night: darker, lower, denser. Season warms or cools the palette. */
export function hoursNodes<N extends GraphNode>(nodes: N[], seed: SeedHex, setting: HoursSetting): N[] {
  if (setting.amount <= 0) return nodes;
  const state = hoursState(seed, setting.clock);
  const d = state.daylight * setting.amount;
  const w = state.warmth * setting.amount;
  const reg = registerOf(d);
  const bright = (k: number) => 2 ** (k * d);
  return nodes.map((node) => {
    const { data } = node;
    switch (node.type) {
      case 'oscillator':
        return { ...node, data: { ...data, frequency: clamp(num(data, 'frequency', 110) * reg, 20, 4000) } };
      case 'fm':
        return {
          ...node,
          data: {
            ...data,
            frequency: clamp(num(data, 'frequency', 220) * reg, 20, 4000),
            index: clamp(num(data, 'index', 2) * bright(0.4), 0, 20),
            density: clamp(num(data, 'density', 0.3) * bright(-0.6), 0.02, 4),
          },
        };
      case 'loopVoice':
        return {
          ...node,
          data: { ...data, frequency: clamp(num(data, 'frequency', 523.25) * reg, 60, 2400), thin: Math.max(0, 0.45 * d) },
        };
      case 'filter':
        return { ...node, data: { ...data, frequency: clamp(num(data, 'frequency', 1200) * bright(0.7), 20, 18000) } };
      case 'tapeEcho':
        return { ...node, data: { ...data, tone: clamp(num(data, 'tone', 3200) * bright(0.5), 600, 12000) } };
      case 'visual':
        return {
          ...node,
          data: mapPalette(data, (c) => ({
            h: hueToward(c.h, w >= 0 ? WARM_HUE : COOL_HUE, Math.abs(w) * 0.18),
            s: c.s * (1 + 0.15 * w),
            l: c.l * (1 + 0.1 * d),
          })),
        };
      default:
        return node;
    }
  });
}

/** The patch as heard at this clock time, stamped with the time so the export can be rebuilt. */
export function hoursPatch(patch: PatchFile, setting: HoursSetting): PatchFile {
  return { ...patch, nodes: hoursNodes(patch.nodes, patch.seed, setting), hours: setting };
}
