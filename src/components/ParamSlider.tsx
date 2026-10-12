import { Handle, Position } from '@xyflow/react';
import type { ParamSpec } from '@/patch/definitions';

const STEPS = 1000;

function toPosition(spec: ParamSpec, value: number) {
  const t = (value - spec.min) / (spec.max - spec.min);
  return Math.round(Math.pow(Math.min(1, Math.max(0, t)), 1 / (spec.curve ?? 1)) * STEPS);
}

function fromPosition(spec: ParamSpec, pos: number) {
  const v = spec.min + (spec.max - spec.min) * Math.pow(pos / STEPS, spec.curve ?? 1);
  const f = Math.pow(10, spec.decimals ?? 2);
  return Math.round(v * f) / f;
}

function format(spec: ParamSpec, value: number) {
  const d = spec.decimals ?? 2;
  const abs = Math.abs(value);
  const text = abs >= 1000 ? `${(value / 1000).toFixed(abs >= 10000 ? 1 : 2)}k` : value.toFixed(abs >= 100 ? Math.min(d, 1) : d);
  return spec.unit ? `${text}${spec.unit === 'ct' || spec.unit === 'dB' ? ' ' : ''}${spec.unit}` : text;
}

export interface SliderHandle {
  id: string;
  className: string;
  title: string;
  /** Label colour while something is connected. */
  activeText: string;
}

interface Props {
  spec: ParamSpec;
  value: number;
  accent: string;
  handle?: SliderHandle;
  connected?: boolean;
  onChange(value: number): void;
}

export function ParamSlider({ spec, value, accent, handle, connected = false, onChange }: Props) {
  const pos = toPosition(spec, value);
  return (
    <div className="relative grid grid-cols-[44px_1fr_52px] items-center gap-2 h-5">
      {handle && (
        <Handle type="target" position={Position.Left} id={handle.id} className={handle.className} title={handle.title} />
      )}
      <button
        type="button"
        onDoubleClick={() => onChange(spec.default)}
        title="Double-click to reset"
        className={`nodrag text-left text-[10px] uppercase tracking-wider truncate transition-colors ${
          connected && handle ? handle.activeText : 'text-ink-400 hover:text-ink-200'
        }`}
      >
        {spec.label}
      </button>
      <input
        type="range"
        min={0}
        max={STEPS}
        step={1}
        value={pos}
        onChange={(e) => onChange(fromPosition(spec, Number(e.target.value)))}
        className="param-range nodrag nowheel w-full"
        style={{ ['--accent' as string]: accent, ['--fill' as string]: `${(pos / STEPS) * 100}%` }}
        aria-label={spec.label}
      />
      <span className="font-mono text-[10px] text-ink-200 text-right tabular-nums truncate">{format(spec, value)}</span>
    </div>
  );
}
