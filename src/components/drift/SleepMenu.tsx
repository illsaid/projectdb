import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Moon } from 'lucide-react';
import { SLEEP_MINUTES, type SleepMinutes } from '@/hooks/useSleepTimer';

interface Props {
  minutes: SleepMinutes | null;
  remaining(): number | null;
  fading(): boolean;
  onChange(m: SleepMinutes | null): void;
}

const clock = (s: number) => {
  const total = Math.ceil(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Sleep timer control: a pill showing the time left, opening a short list of durations. */
export function SleepMenu({ minutes, remaining, fading, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const active = minutes !== null;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [open]);

  const left = remaining();
  const choose = (m: SleepMinutes | null) => {
    onChange(m);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={active && left !== null ? `Sleep timer, ${clock(left)} left` : 'Sleep timer'}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] backdrop-blur-xl transition-colors ${
          active
            ? 'border-amber-300/40 bg-amber-300/10 text-amber-100 hover:border-amber-300/70'
            : 'border-white/15 bg-black/40 text-white/80 hover:border-white/35 hover:text-white'
        }`}
      >
        <Moon className={`h-3.5 w-3.5 ${active && fading() ? 'animate-pulse' : ''}`} />
        {active && left !== null ? (
          <span className="font-mono tabular-nums">{clock(left)}</span>
        ) : (
          <span className="hidden sm:inline">Sleep</span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Stop playing after"
          className="animate-fade-up absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-white/10 bg-ink-900/95 p-1 shadow-2xl backdrop-blur-xl"
        >
          <p className="px-3 pb-1.5 pt-2 text-[11px] leading-snug text-white/55">Fade out and pause after</p>
          {SLEEP_MINUTES.map((m) => (
            <MenuItem key={m} checked={minutes === m} onClick={() => choose(m)}>
              {m} minutes
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-white/10" />
          <MenuItem checked={minutes === null} onClick={() => choose(null)}>
            Off
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ checked, onClick, children }: { checked: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/10 ${
        checked ? 'text-amber-100' : 'text-white/80'
      }`}
    >
      {children}
      {checked && <Check className="h-3.5 w-3.5" />}
    </button>
  );
}
