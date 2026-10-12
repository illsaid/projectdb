/** Automation targets the engine knows how to drive from a score. */
export const LANE_KEYS = ['fade', 'level', 'cutoff', 'reverbMix', 'delayFeedback', 'lfoRate'] as const;
export type LaneKey = (typeof LANE_KEYS)[number];

/** Every lane value is a positive multiplier on the module's own setting. */
export const LANE_FLOOR = 0.001;

export interface FormLane {
  node: string;
  key: LaneKey;
  /** [seconds into the form, multiplier], sorted by time; values are reached by exponential ramps. */
  points: [number, number][];
}

/** When an event-driven module (Loop Voice) may start notes: form-local [start, end) spans. */
export interface FormGate {
  node: string;
  spans: [number, number][];
}

export interface SectionLook {
  /** 0..1 mix toward the visual's secondary preset. */
  blend: number;
  hue: number;
  scale: number;
}

export interface FormSection {
  start: number;
  duration: number;
  look: SectionLook;
}

export interface Form {
  length: number;
  fadeIn: number;
  fadeOut: number;
  sections: FormSection[];
  /** Index of the section expected to be loudest. */
  peak: number;
  lanes: FormLane[];
  gates?: FormGate[];
}

export const NEUTRAL_LOOK: SectionLook = { blend: 0, hue: 0, scale: 0 };

/** The loop crossfade is as long as the shorter of the two fades. */
export const loopOverlap = (f: Form) => Math.min(f.fadeIn, f.fadeOut);
export const loopPeriod = (f: Form) => Math.max(1, f.length - loopOverlap(f));

export interface FormPosition {
  /** Seconds into the newest pass of the form. */
  time: number;
  pass: number;
}

export function formPosition(form: Form, elapsed: number): FormPosition {
  if (elapsed <= 0) return { time: 0, pass: 0 };
  const period = loopPeriod(form);
  const pass = Math.floor(elapsed / period);
  return { time: elapsed - pass * period, pass };
}

/** Multiplier of a lane at time t, following the same exponential curve the engine schedules. */
export function laneValueAt(points: [number, number][], t: number): number {
  if (!points.length) return 1;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (t <= t1) {
      const [t0, v0] = points[i - 1];
      const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return v0 * Math.pow(v1 / v0, k);
    }
  }
  return points[points.length - 1][1];
}

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

const mixLook = (a: SectionLook, b: SectionLook, k: number): SectionLook => ({
  blend: a.blend + (b.blend - a.blend) * k,
  hue: a.hue + (b.hue - a.hue) * k,
  scale: a.scale + (b.scale - a.scale) * k,
});

function lookIn(form: Form, t: number): SectionLook {
  const { sections } = form;
  if (!sections.length) return NEUTRAL_LOOK;
  let i = sections.length - 1;
  while (i > 0 && t < sections[i].start) i--;
  const cur = sections[i];
  if (i === 0) return cur.look;
  const prev = sections[i - 1];
  const span = Math.min(8, cur.duration * 0.6, prev.duration * 0.6);
  return mixLook(prev.look, cur.look, smooth((t - cur.start) / Math.max(0.01, span)));
}

/** Section-driven visual offsets at a form position; eases from the outgoing pass during a loop crossfade. */
export function formLook(form: Form, pos: FormPosition): SectionLook {
  const overlap = loopOverlap(form);
  const now = lookIn(form, pos.time);
  if (pos.pass === 0 || pos.time >= overlap) return now;
  const tail = lookIn(form, pos.time + loopPeriod(form));
  return mixLook(tail, now, smooth(pos.time / Math.max(0.01, overlap)));
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Accepts a score from a saved patch, dropping anything malformed. */
export function parseForm(raw: unknown, nodeIds: ReadonlySet<string>): Form | undefined {
  if (!isObj(raw) || !isNum(raw.length) || raw.length <= 0 || !isNum(raw.fadeIn) || !isNum(raw.fadeOut)) return undefined;
  if (!Array.isArray(raw.sections) || !Array.isArray(raw.lanes)) return undefined;
  const sections = raw.sections.filter(isObj).flatMap((s): FormSection[] => {
    const look = isObj(s.look) ? s.look : {};
    if (!isNum(s.start) || !isNum(s.duration)) return [];
    return [
      {
        start: s.start,
        duration: s.duration,
        look: {
          blend: isNum(look.blend) ? look.blend : 0,
          hue: isNum(look.hue) ? look.hue : 0,
          scale: isNum(look.scale) ? look.scale : 0,
        },
      },
    ];
  });
  if (!sections.length) return undefined;
  const lanes = raw.lanes.filter(isObj).flatMap((l): FormLane[] => {
    if (typeof l.node !== 'string' || !nodeIds.has(l.node)) return [];
    if (!LANE_KEYS.includes(l.key as LaneKey) || !Array.isArray(l.points)) return [];
    const points = l.points
      .filter((p): p is [number, number] => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))
      .map(([t, v]): [number, number] => [t, Math.max(LANE_FLOOR, v)])
      .sort((a, b) => a[0] - b[0]);
    return points.length ? [{ node: l.node, key: l.key as LaneKey, points }] : [];
  });
  const gates = (Array.isArray(raw.gates) ? raw.gates : []).filter(isObj).flatMap((g): FormGate[] => {
    if (typeof g.node !== 'string' || !nodeIds.has(g.node) || !Array.isArray(g.spans)) return [];
    const spans = g.spans
      .filter((s): s is [number, number] => Array.isArray(s) && isNum(s[0]) && isNum(s[1]) && s[1] > s[0])
      .sort((a, b) => a[0] - b[0]);
    return [{ node: g.node, spans }];
  });
  const peak = isNum(raw.peak) ? Math.min(sections.length - 1, Math.max(0, Math.round(raw.peak))) : 0;
  return {
    length: raw.length,
    fadeIn: Math.max(0, raw.fadeIn),
    fadeOut: Math.max(0, raw.fadeOut),
    sections,
    peak,
    lanes,
    ...(gates.length ? { gates } : {}),
  };
}
