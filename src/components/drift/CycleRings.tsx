import { useMemo, useRef } from 'react';
import type { FormPosition } from '@/audio/form';
import { cycleProgress, gateOpen, loopSpec, sinceLastNote, type GateSpans, type LoopSpec } from '@/audio/loops';
import { plantLevel, plantRepeats, plantSkips, type Planting } from '@/audio/plantings';
import { useAnimationFrame } from '@/hooks/meterContext';
import { num } from '@/patch/definitions';
import type { AudioGraph, NodeData } from '@/patch/types';

interface Props {
  /** The graph as played, so room mode, Hours and cards are reflected. */
  graph: AudioGraph;
  plantings: Planting[];
  position(): FormPosition | null;
  elapsed(): number | null;
  active: boolean;
  room: boolean;
}

interface Ring {
  id: string;
  spec: LoopSpec;
  data: NodeData;
  spans: GateSpans | null;
  rx: number;
  ry: number;
}

interface Mark {
  dot: SVGCircleElement | null;
  halo: SVGCircleElement | null;
}

const W = 680;
const H = 300;
const FLASH_SECONDS = 1.4;

const flashOf = (since: number | null) => (since === null ? 0 : Math.max(0, 1 - since / FLASH_SECONDS) ** 2);
const pointOn = (rx: number, ry: number, progress: number) => {
  const a = progress * Math.PI * 2 - Math.PI / 2;
  return [(W / 2 + rx * Math.cos(a)).toFixed(1), (H / 2 + ry * Math.sin(a)).toFixed(1)];
};

/** Seconds since a planting last sounded at elapsed time t, or null if it has not yet. */
function sinceLastPlant(p: Planting, t: number, room: boolean): number | null {
  const e = t - p.at;
  if (e < 0) return null;
  let k = Math.min(Math.floor(e / p.cycle), plantRepeats(p) - 1);
  if (plantSkips(k, room)) k -= 1;
  return k < 0 ? null : e - k * p.cycle;
}

/**
 * One ring per Loop Voice around the drift's name, each with a playhead that glows on every note.
 * Planted notes travel an outer orbit as small marks that dim as they fade away.
 */
export function CycleRings({ graph, plantings, position, elapsed, active, room }: Props) {
  const rings = useMemo<Ring[]>(
    () =>
      graph.nodes
        .filter((n) => n.type === 'loopVoice' && num(n.data, 'level', 0.3) > 0)
        .map((n, i) => ({
          id: n.id,
          spec: loopSpec(n.data),
          data: n.data,
          spans: graph.form?.gates?.find((g) => g.node === n.id)?.spans ?? null,
          rx: 232 + i * 15,
          ry: 70 + i * 11,
        })),
    [graph],
  );
  const orbit = { rx: 232 + rings.length * 15 + 14, ry: 70 + rings.length * 11 + 12 };
  const els = useRef<(Mark & { ring: SVGEllipseElement | null })[]>([]);
  const marks = useRef<Mark[]>([]);

  useAnimationFrame(() => {
    const pos = position();
    rings.forEach((r, i) => {
      const el = els.current[i];
      if (!el?.ring || !el.dot || !el.halo) return;
      const t = pos?.time ?? 0;
      const progress = pos ? cycleProgress(r.spec, t) : null;
      const open = gateOpen(r.spans, t);
      const flash = flashOf(pos ? sinceLastNote(r.spec, r.data, r.spans, t) : null);
      el.ring.style.strokeOpacity = String((open ? 0.16 : 0.06) + flash * 0.4);
      if (progress === null) {
        el.dot.style.opacity = '0';
        el.halo.style.opacity = '0';
        return;
      }
      const [x, y] = pointOn(r.rx, r.ry, progress);
      el.dot.setAttribute('cx', x);
      el.dot.setAttribute('cy', y);
      el.dot.style.opacity = String(open ? 0.55 + flash * 0.45 : 0.25);
      el.halo.setAttribute('cx', x);
      el.halo.setAttribute('cy', y);
      el.halo.setAttribute('r', (4 + flash * 14).toFixed(1));
      el.halo.style.opacity = String(flash * 0.5);
    });

    const t = elapsed();
    plantings.forEach((p, i) => {
      const el = marks.current[i];
      if (!el?.dot || !el.halo) return;
      const level = t === null ? 0 : plantLevel(p, t);
      if (t === null || level <= 0) {
        el.dot.style.opacity = '0';
        el.halo.style.opacity = '0';
        return;
      }
      const e = (t - p.at) / p.cycle;
      const [x, y] = pointOn(orbit.rx, orbit.ry, e - Math.floor(e));
      const flash = flashOf(sinceLastPlant(p, t, room));
      const presence = 0.3 + 0.7 * Math.sqrt(level);
      el.dot.setAttribute('cx', x);
      el.dot.setAttribute('cy', y);
      el.dot.style.opacity = String(presence * (0.6 + flash * 0.4));
      el.halo.setAttribute('cx', x);
      el.halo.setAttribute('cy', y);
      el.halo.setAttribute('r', (3 + flash * 11).toFixed(1));
      el.halo.style.opacity = String(flash * 0.55 * presence);
    });
  }, active && (rings.length > 0 || plantings.length > 0));

  if (!rings.length && !plantings.length) return null;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      className="pointer-events-none absolute left-1/2 top-1/2 -z-10 w-[min(98vw,720px)] -translate-x-1/2 -translate-y-1/2 animate-fade-in overflow-visible"
    >
      <defs>
        <radialGradient id="cycle-halo">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="plant-halo">
          <stop offset="0%" stopColor="#a7f3d0" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#a7f3d0" stopOpacity="0" />
        </radialGradient>
      </defs>
      {rings.map((r, i) => (
        <g key={r.id}>
          <ellipse
            ref={(el) => {
              els.current[i] = { ...els.current[i], ring: el };
            }}
            cx={W / 2}
            cy={H / 2}
            rx={r.rx}
            ry={r.ry}
            fill="none"
            stroke="#fef3c7"
            strokeWidth={1}
            style={{ strokeOpacity: 0.12, transition: 'stroke-opacity 120ms linear' }}
          />
          <circle
            ref={(el) => {
              els.current[i] = { ...els.current[i], halo: el };
            }}
            r={4}
            fill="url(#cycle-halo)"
            style={{ opacity: 0 }}
          />
          <circle
            ref={(el) => {
              els.current[i] = { ...els.current[i], dot: el };
            }}
            r={2.6}
            fill="#fffbeb"
            style={{ opacity: 0 }}
          />
        </g>
      ))}
      {plantings.length > 0 && (
        <g>
          <ellipse
            cx={W / 2}
            cy={H / 2}
            rx={orbit.rx}
            ry={orbit.ry}
            fill="none"
            stroke="#d1fae5"
            strokeWidth={1}
            strokeDasharray="1 7"
            strokeLinecap="round"
            style={{ strokeOpacity: 0.22 }}
          />
          {plantings.map((p, i) => (
            <g key={`${p.at}:${p.frequency}:${p.cycle}`}>
              <circle
                ref={(el) => {
                  marks.current[i] = { ...marks.current[i], halo: el };
                }}
                r={3}
                fill="url(#plant-halo)"
                style={{ opacity: 0 }}
              />
              <circle
                ref={(el) => {
                  marks.current[i] = { ...marks.current[i], dot: el };
                }}
                r={2}
                fill="#ecfdf5"
                style={{ opacity: 0 }}
              />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
