import type { ReactNode } from 'react';
import { Lock, X } from 'lucide-react';
import {
  activeLockCount,
  ARCHETYPE_LABEL,
  ARCHETYPES,
  BRIGHTNESS,
  BRIGHTNESS_LABEL,
  LENGTHS,
  lengthLabel,
  NO_LOCKS,
  type Hold,
  type Locks,
} from '@/drift/traits';

interface Props {
  locks: Locks;
  canHold: boolean;
  onChange(locks: Locks): void;
  onClose(): void;
}

const HOLD_OPTIONS: { value: Hold; label: string; hint: string }[] = [
  { value: 'none', label: 'Neither', hint: 'Reroll both' },
  { value: 'visual', label: 'Visual', hint: 'New sound, same visual' },
  { value: 'sound', label: 'Sound', hint: 'New visual, same sound' },
];

export function LocksPanel({ locks, canHold, onChange, onClose }: Props) {
  const set = (patch: Partial<Locks>) => onChange({ ...locks, ...patch });

  return (
    <div className="animate-fade-up w-[min(92vw,420px)] rounded-2xl border border-white/10 bg-black/70 p-4 shadow-2xl backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink-100">
          <Lock className="h-3.5 w-3.5 text-amber-300" />
          Locks
        </div>
        <div className="flex items-center gap-1">
          {activeLockCount(locks) > 0 && (
            <button
              type="button"
              onClick={() => onChange(NO_LOCKS)}
              className="rounded-md px-2 py-1 text-[11px] text-ink-300 transition-colors hover:bg-white/10 hover:text-ink-100"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close locks"
            className="rounded-md p-1 text-ink-300 transition-colors hover:bg-white/10 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <Row label="Character">
          <Chip active={locks.archetype === null} onClick={() => set({ archetype: null })}>
            Any
          </Chip>
          {ARCHETYPES.map((a) => (
            <Chip key={a} active={locks.archetype === a} onClick={() => set({ archetype: a })}>
              {ARCHETYPE_LABEL[a]}
            </Chip>
          ))}
        </Row>
        <Row label="Length">
          <Chip active={locks.length === null} onClick={() => set({ length: null })}>
            Any
          </Chip>
          {LENGTHS.map((l) => (
            <Chip key={l} active={locks.length === l} onClick={() => set({ length: l })}>
              {lengthLabel(l)}
            </Chip>
          ))}
        </Row>
        <Row label="Brightness">
          <Chip active={locks.brightness === null} onClick={() => set({ brightness: null })}>
            Any
          </Chip>
          {BRIGHTNESS.map((b) => (
            <Chip key={b} active={locks.brightness === b} onClick={() => set({ brightness: b })}>
              {BRIGHTNESS_LABEL[b]}
            </Chip>
          ))}
        </Row>
        <Row label="Hold on reroll">
          {HOLD_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              active={locks.hold === o.value}
              disabled={!canHold && o.value !== 'none'}
              title={canHold || o.value === 'none' ? o.hint : 'Drift once first'}
              onClick={() => set({ hold: o.value })}
            >
              {o.label}
            </Chip>
          ))}
        </Row>
        {locks.hold === 'sound' && (
          <p className="text-[11px] leading-relaxed text-ink-400">
            Holding the sound: only the visual changes. Character and length stay with the held sound; brightness still shapes the new colors.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

interface ChipProps {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick(): void;
  children: ReactNode;
}

function Chip({ active, disabled, title, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-[12px] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? 'border-amber-300/60 bg-amber-300/15 text-amber-100'
          : 'border-white/10 text-ink-300 hover:border-white/25 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  );
}
