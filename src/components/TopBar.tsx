import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  AudioWaveform,
  ChevronDown,
  Dices,
  Download,
  FilePlus2,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  Power,
  Save,
} from 'lucide-react';
import { parseSeed } from '@/audio/random';
import type { AudioStatus } from '@/hooks/useLiveAudio';
import type { PatchFile, SeedHex } from '@/patch/types';

interface Props {
  onHome(): void;
  name: string;
  onRename(name: string): void;
  seed: SeedHex;
  onSeedChange(seed: SeedHex): void;
  onRandomizeSeed(): void;
  status: AudioStatus;
  onStartAudio(): void;
  onTogglePause(): void;
  starters: PatchFile[];
  onLoadStarter(patch: PatchFile): void;
  onNew(): void;
  onSave(): void;
  onOpen(): void;
  onExport(): void;
}

const btn =
  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded border border-ink-700 bg-ink-850 text-[11.5px] text-ink-200 hover:bg-ink-800 hover:border-ink-600 hover:text-ink-100 transition-colors';

export function TopBar(p: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  return (
    <header className="relative z-20 flex items-center gap-2 h-11 px-3 border-b border-ink-700 bg-ink-900">
      <button
        type="button"
        onClick={p.onHome}
        title="Back to Drift"
        className="group flex items-center gap-2 pr-3 mr-1 border-r border-ink-700 h-full"
      >
        <span className="relative grid place-items-center w-6 h-6 rounded bg-amber-400 text-ink-950">
          <AudioWaveform size={15} strokeWidth={2.25} className="transition-opacity group-hover:opacity-0" />
          <ArrowLeft size={15} strokeWidth={2.5} className="absolute opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="hidden sm:block font-mono text-[12px] font-medium tracking-[0.18em] text-ink-100">DRIFTBOX</span>
        <span className="hidden md:block text-[10px] uppercase tracking-[0.14em] text-ink-400">Patcher</span>
      </button>

      <input
        value={p.name}
        onChange={(e) => p.onRename(e.target.value)}
        maxLength={80}
        className="w-28 sm:w-44 h-7 px-2 rounded bg-transparent border border-transparent text-[13px] font-medium text-ink-100 hover:border-ink-700 focus:border-ink-600 focus:bg-ink-850 outline-none transition-colors"
        aria-label="Patch name"
      />

      <div ref={menuRef} className="relative">
        <button type="button" className={btn} onClick={() => setMenuOpen((o) => !o)}>
          Patches <ChevronDown size={12} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>
        {menuOpen && (
          <div className="animate-fade-up absolute left-0 top-9 w-56 rounded-md border border-ink-700 bg-ink-850 p-1 shadow-2xl">
            <div className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-[0.14em] text-ink-400">Starter patches</div>
            {p.starters.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => {
                  p.onLoadStarter(s);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center justify-between rounded px-2 py-1.5 text-[12px] text-ink-200 hover:bg-ink-700 hover:text-ink-100 transition-colors"
              >
                {s.name}
                <span className="font-mono text-[10px] text-ink-400">{s.nodes.length} mods</span>
              </button>
            ))}
            <div className="my-1 border-t border-ink-700" />
            <button
              type="button"
              onClick={() => {
                p.onNew();
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-[12px] text-ink-200 hover:bg-ink-700 transition-colors"
            >
              <FilePlus2 size={13} /> Empty patch
            </button>
          </div>
        )}
      </div>

      <button type="button" className={btn} onClick={p.onOpen} title="Open a patch file">
        <FolderOpen size={13} />
        <span className="hidden lg:inline">Open</span>
      </button>
      <button type="button" className={btn} onClick={p.onSave} title="Save patch as a file">
        <Save size={13} />
        <span className="hidden lg:inline">Save</span>
      </button>

      <div className="hidden sm:flex items-center h-7 ml-1 rounded border border-ink-700 bg-ink-850 overflow-hidden" title="Seed for noise, reverb and random walks">
        <span className="pl-2 pr-1.5 text-[10px] uppercase tracking-wider text-ink-400">Seed</span>
        <SeedField seed={p.seed} onCommit={p.onSeedChange} />
        <button
          type="button"
          onClick={p.onRandomizeSeed}
          className="grid place-items-center w-7 h-full border-l border-ink-700 text-ink-300 hover:text-amber-300 hover:bg-ink-800 transition-colors"
          title="New random seed"
        >
          <Dices size={13} />
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button type="button" className={btn} onClick={p.onExport}>
          <Download size={13} /> <span className="hidden sm:inline">Export WAV</span>
        </button>
        <AudioButton status={p.status} onStart={p.onStartAudio} onToggle={p.onTogglePause} />
      </div>
    </header>
  );
}

const displaySeed = (seed: SeedHex) => seed.replace(/^0+(?=.)/, '');

function SeedField({ seed, onCommit }: { seed: SeedHex; onCommit(seed: SeedHex): void }) {
  const [draft, setDraft] = useState(displaySeed(seed));

  useEffect(() => setDraft(displaySeed(seed)), [seed]);

  const commit = () => {
    const next = parseSeed(draft);
    if (!next) return setDraft(displaySeed(seed));
    setDraft(displaySeed(next));
    if (next !== seed) onCommit(next);
  };

  return (
    <input
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 32))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(displaySeed(seed));
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      className="w-[96px] focus:w-[236px] h-full bg-transparent font-mono text-[11.5px] text-ink-100 outline-none transition-[width] duration-200"
      aria-label="Seed (hex)"
      title={seed}
    />
  );
}

function AudioButton({ status, onStart, onToggle }: { status: AudioStatus; onStart(): void; onToggle(): void }) {
  if (status === 'off' || status === 'error') {
    return (
      <button
        type="button"
        onClick={onStart}
        className="animate-pulse-ring inline-flex items-center gap-1.5 h-7 px-3 rounded bg-amber-400 text-ink-950 text-[11.5px] font-semibold hover:bg-amber-300 transition-colors"
      >
        <Power size={13} strokeWidth={2.5} /> {status === 'error' ? 'Retry audio' : 'Start audio'}
      </button>
    );
  }
  if (status === 'starting') {
    return (
      <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded border border-ink-700 text-[11.5px] text-ink-300">
        <Loader2 size={13} className="animate-spin" /> Starting
      </span>
    );
  }
  const running = status === 'running';
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-2 h-7 px-3 rounded border text-[11.5px] font-medium transition-colors ${
        running
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
          : 'border-ink-600 bg-ink-850 text-ink-300 hover:text-ink-100'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-emerald-400 animate-pulse' : 'bg-ink-500'}`} />
      {running ? <Pause size={12} /> : <Play size={12} />}
      {running ? 'Live' : 'Paused'}
    </button>
  );
}
