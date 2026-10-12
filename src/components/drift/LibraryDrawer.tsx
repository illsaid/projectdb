import { useEffect, useState, type ReactNode } from 'react';
import { Film, Library, Play, Trash2, Waves, X } from 'lucide-react';
import { shortSeed } from '@/audio/random';
import type { KeptDrift } from '@/drift/store';
import { ARCHETYPE_LABEL, BRIGHTNESS_LABEL, lengthLabel } from '@/drift/traits';

interface Props {
  entries: KeptDrift[] | null;
  error: string | null;
  currentKey: string | null;
  onClose(): void;
  onPlay(entry: KeptDrift): void;
  onExportWav(entry: KeptDrift): void;
  onExportVideo(entry: KeptDrift): void;
  onDelete(entry: KeptDrift): void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function LibraryDrawer({ entries, error, currentKey, onClose, onPlay, onExportWav, onExportVideo, onDelete }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close library" onClick={onClose} className="animate-fade-in absolute inset-0 bg-black/50 [animation-duration:200ms]" />
      <aside className="animate-fade-up relative flex h-full w-full max-w-md flex-col border-l border-white/10 bg-ink-950/95 shadow-2xl backdrop-blur-xl">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Library className="h-4 w-4 text-amber-300" />
            <h2 className="text-[14px] font-medium text-ink-100">Library</h2>
            {entries && entries.length > 0 && <span className="text-[12px] text-ink-400">{entries.length}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close library"
            className="rounded-md p-1.5 text-ink-300 transition-colors hover:bg-white/10 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {error ? (
            <Empty title="Library unavailable" body={error} />
          ) : entries === null ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[76px] animate-pulse rounded-xl bg-white/[0.04]" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <Empty title="Nothing kept yet" body="Press Keep on a drift you like and it will wait for you here, in this browser." />
          ) : (
            <ul className="space-y-1.5 p-3">
              {entries.map((entry) => (
                <Row
                  key={entry.key}
                  entry={entry}
                  current={entry.key === currentKey}
                  onPlay={() => onPlay(entry)}
                  onExportWav={() => onExportWav(entry)}
                  onExportVideo={() => onExportVideo(entry)}
                  onDelete={() => onDelete(entry)}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

interface RowProps {
  entry: KeptDrift;
  current: boolean;
  onPlay(): void;
  onExportWav(): void;
  onExportVideo(): void;
  onDelete(): void;
}

function Row({ entry, current, onPlay, onExportWav, onExportVideo, onDelete }: RowProps) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <li
      className={`group flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors ${
        current ? 'border-amber-300/30 bg-amber-300/[0.06]' : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'
      }`}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${entry.name}`}
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all duration-200 hover:scale-105 ${
          current ? 'bg-amber-300 text-amber-950' : 'bg-white/10 text-white/85 hover:bg-amber-300 hover:text-amber-950'
        }`}
      >
        <Play className="ml-0.5 h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[22px] leading-[1.2] text-ink-100">{entry.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
          <span className="font-mono text-ink-300" title={entry.seed}>
            #{shortSeed(entry.seed)}
          </span>
          <span>{ARCHETYPE_LABEL[entry.archetype]}</span>
          <span>{lengthLabel(entry.length)}</span>
          <span>{BRIGHTNESS_LABEL[entry.brightness]}</span>
          <span>{dateFormat.format(entry.keptAt)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        <IconButton label="Export WAV" onClick={onExportWav}>
          <Waves className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="Export MP4" onClick={onExportVideo}>
          <Film className="h-3.5 w-3.5" />
        </IconButton>
        {confirming ? (
          <button
            type="button"
            onClick={onDelete}
            className="animate-fade-up rounded-md bg-rose-500/15 px-2 py-1 text-[11px] font-medium text-rose-300 transition-colors hover:bg-rose-500/25"
          >
            Delete?
          </button>
        ) : (
          <IconButton label="Delete" onClick={() => setConfirming(true)} danger>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
    </li>
  );
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick(): void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-md p-2 text-ink-300 transition-colors hover:bg-white/10 ${danger ? 'hover:text-rose-300' : 'hover:text-ink-100'}`}
    >
      {children}
    </button>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-10 text-center">
      <Library className="mb-2 h-8 w-8 text-ink-600" strokeWidth={1.5} />
      <div className="text-[14px] font-medium text-ink-200">{title}</div>
      <p className="text-[12px] leading-relaxed text-ink-400">{body}</p>
    </div>
  );
}
