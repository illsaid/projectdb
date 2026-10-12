import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bookmark, BookmarkCheck, Infinity as InfinityIcon, Loader2, Pause, Play, SkipForward, X } from 'lucide-react';
import { CROSSFADE_SECONDS, type EndlessAudio } from '@/audio/endless';
import type { Drift } from '@/drift/resolve';
import type { DriftStore } from '@/drift/store';
import { ARCHETYPE_LABEL, type Locks } from '@/drift/traits';
import { ENDLESS_MINUTES, useEndless, type EndlessMinutes } from '@/hooks/useEndless';
import { useIdle } from '@/hooks/useIdle';
import { useMediaSession } from '@/hooks/useMediaSession';
import { useSleepTimer } from '@/hooks/useSleepTimer';
import { useWakeLock } from '@/hooks/useWakeLock';
import { EndlessDeck } from './EndlessDeck';
import { SleepMenu } from './SleepMenu';

interface Props {
  session: EndlessAudio;
  first: Drift | null;
  store: DriftStore | null;
  locks: Locks;
  minutes: EndlessMinutes;
  onMinutes(m: EndlessMinutes): void;
  isKept(drift: Drift): boolean;
  onKeep(drift: Drift): void;
  onExit(last: Drift | null): void;
}

const FIRST_FADE = 1.5;
const IDLE_MS = 3000;

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]');

export function EndlessView({ session, first, store, locks, minutes, onMinutes, isKept, onKeep, onExit }: Props) {
  const endless = useEndless(session, first, store, locks, minutes);
  const { current, playing, paused } = endless;
  const idle = useIdle(IDLE_MS, !!current && !paused);
  const kept = !!current && isKept(current);
  useWakeLock(true);
  const sleep = useSleepTimer(session.output, async () => {
    if (!session.paused) await actions.current.endless.togglePause();
  });
  useMediaSession(current, !paused, {
    play: () => {
      if (session.paused) void actions.current.endless.togglePause();
    },
    pause: () => {
      if (!session.paused) void actions.current.endless.togglePause();
    },
    next: () => actions.current.endless.skip(),
  });

  const actions = useRef({ endless, current, onKeep, onExit });
  actions.current = { endless, current, onKeep, onExit };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const a = actions.current;
      if (e.code === 'Space') {
        e.preventDefault();
        void a.endless.togglePause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        a.endless.skip();
      } else if (e.code === 'KeyK' && a.current) {
        a.onKeep(a.current);
      } else if (e.code === 'Escape') {
        a.onExit(a.current);
      }
    };
    let wasFullscreen = !!document.fullscreenElement;
    const onFullscreen = () => {
      if (document.fullscreenElement) wasFullscreen = true;
      else if (wasFullscreen) actions.current.onExit(actions.current.current);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  const chrome = `transition-opacity duration-700 ${idle ? 'opacity-0' : 'opacity-100'}`;

  return (
    <div className={`fixed inset-0 z-40 overflow-hidden bg-black text-white ${idle ? 'cursor-none' : ''}`}>
      {playing.map(({ deck, drift }) => (
        <EndlessDeck key={deck.id} deck={deck} drift={drift} paused={paused} fade={playing.length > 1 ? CROSSFADE_SECONDS : FIRST_FADE} />
      ))}

      <div className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent ${chrome}`} />
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 via-black/30 to-transparent ${chrome}`} />

      <div className={`relative z-10 flex h-full flex-col ${chrome}`}>
        <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-6">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.22em] text-amber-200/90">
              <InfinityIcon className="h-4 w-4" />
              <span className="hidden sm:inline">ENDLESS</span>
            </span>
            <div className="flex rounded-full border border-white/15 bg-black/40 p-0.5 backdrop-blur-xl" role="radiogroup" aria-label="Change drift every">
              {ENDLESS_MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={minutes === m}
                  onClick={() => onMinutes(m)}
                  className={`rounded-full px-3 py-1 font-mono text-[11px] transition-colors ${
                    minutes === m ? 'bg-white/90 text-black' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SleepMenu minutes={sleep.minutes} remaining={sleep.remaining} fading={sleep.fading} onChange={sleep.set} />
            <button
              type="button"
              onClick={() => onExit(current)}
              className="flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3.5 py-1.5 text-[12px] text-white/80 backdrop-blur-xl transition-colors hover:border-white/35 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              Exit
            </button>
          </div>
        </header>

        <main className="flex flex-1 flex-col items-center justify-end gap-5 px-4 pb-10 text-center sm:pb-14">
          {current ? (
            <div key={current.patch.seed} className="animate-drift-in flex flex-col items-center gap-2">
              <span className="text-[11px] uppercase tracking-[0.16em] text-white/65">{ARCHETYPE_LABEL[current.traits.archetype]}</span>
              <h1 className="font-display text-4xl leading-[1.1] text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)] sm:text-6xl">
                {current.patch.name}
              </h1>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-amber-100/85">
              <Loader2 className="h-4 w-4 animate-spin" /> Finding the first drift
            </p>
          )}

          <NextStatus endless={endless} />

          <div className="flex items-center gap-4">
            <Round label={paused ? 'Play (Space)' : 'Pause (Space)'} onClick={() => void endless.togglePause()} large>
              {paused ? <Play className="ml-0.5 h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </Round>
            <Round label="Skip (→)" onClick={endless.skip} disabled={!current}>
              <SkipForward className="h-4 w-4" />
            </Round>
            <Round label={kept ? 'Kept (K)' : 'Keep (K)'} onClick={() => current && onKeep(current)} disabled={!current || !store} active={kept}>
              {kept ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            </Round>
          </div>

          <p className="hidden font-mono text-[10.5px] tracking-[0.08em] text-white/40 sm:block">
            <Key>Space</Key> pause <Key>→</Key> skip <Key>K</Key> keep <Key>Esc</Key> exit
          </p>
        </main>
      </div>
    </div>
  );
}

function NextStatus({ endless }: { endless: ReturnType<typeof useEndless> }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  let text: string;
  if (endless.error) text = endless.error;
  else if (endless.skipQueued && endless.current) text = 'Skipping as soon as the next drift is ready';
  else if (endless.paused) text = 'Paused';
  else {
    const s = Math.ceil(endless.remaining());
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    text = endless.nextReady ? `Next drift in ${clock}` : `Preparing the next drift · ${clock}`;
  }
  return (
    <p className={`flex h-5 items-center gap-2 font-mono text-[12px] tabular-nums ${endless.error ? 'text-amber-300' : 'text-white/60'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${endless.nextReady ? 'bg-emerald-400' : 'animate-pulse bg-amber-300'}`} />
      {text}
    </p>
  );
}

const Key = ({ children }: { children: ReactNode }) => (
  <kbd className="mx-1 rounded border border-white/20 px-1.5 py-0.5 text-white/60 first:ml-0">{children}</kbd>
);

interface RoundProps {
  label: string;
  onClick(): void;
  disabled?: boolean;
  active?: boolean;
  large?: boolean;
  children: ReactNode;
}

function Round({ label, onClick, disabled, active, large, children }: RoundProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`grid place-items-center rounded-full border backdrop-blur-xl transition-all duration-200 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${
        large ? 'h-14 w-14' : 'h-11 w-11'
      } ${active ? 'border-amber-300/50 bg-amber-300/15 text-amber-100' : 'border-white/15 bg-black/40 text-white/85 hover:border-white/35 hover:text-white'}`}
    >
      {children}
    </button>
  );
}
