import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { AudioWaveform, CalendarDays, Library, Network } from 'lucide-react';
import { EndlessAudio } from '@/audio/endless';
import type { Planting } from '@/audio/plantings';
import { roomGraph } from '@/audio/room';
import { ExportDialog } from '@/components/ExportDialog';
import { VideoExportDialog } from '@/components/VideoExportDialog';
import { cardText, drawCard } from '@/drift/cards';
import { generatePatch, type DriftId } from '@/drift/generate';
import { hoursNodes, hoursPatch, hoursTranspose } from '@/drift/hours';
import { dailyRequest } from '@/drift/daily';
import { driftScale, MAX_PLANTINGS, plantAt } from '@/drift/plant';
import { driftHash, driftUrl, parseDriftHash } from '@/drift/link';
import type { Drift } from '@/drift/resolve';
import { driftKey, DriftStore, type KeptDrift } from '@/drift/store';
import { activeLockCount, NO_LOCKS, type Locks } from '@/drift/traits';
import { useDailyDrift } from '@/hooks/useDailyDrift';
import { useDrift } from '@/hooks/useDrift';
import type { EndlessMinutes } from '@/hooks/useEndless';
import { useFormLook } from '@/hooks/useFormLook';
import { useHours } from '@/hooks/useHours';
import { useIdle } from '@/hooks/useIdle';
import { useLiveAudio } from '@/hooks/useLiveAudio';
import { useLowBattery } from '@/hooks/useLowBattery';
import { useMediaSession } from '@/hooks/useMediaSession';
import { MeterContext } from '@/hooks/meterContext';
import { useVisualCanvas } from '@/hooks/useVisualCanvas';
import { audioOnly, toVisualGraph } from '@/patch/io';
import type { AudioGraph, PatchFile } from '@/patch/types';
import { DriftDock } from './DriftDock';
import { DriftHero } from './DriftHero';
import { EndlessView } from './EndlessView';
import { LocksPanel } from './LocksPanel';
import { LibraryDrawer } from './LibraryDrawer';

interface Props {
  onOpenPatcher(patch: PatchFile | null): void;
  /** Start sound on mount, as after recovering from a crash (the Recover click counts as the gesture). */
  resumeAudio?: boolean;
}

type Exporting = { kind: 'wav' | 'mp4'; patch: PatchFile; seconds: number } | null;
type Toast = { text: string; tone: 'ok' | 'error' } | null;
type Endless = { session: EndlessAudio; first: Drift | null; resumeMain: boolean } | null;
type Sprout = { id: number; x: number; y: number };
type ShownCard = { id: number; text: string };

const EMPTY_GRAPH: AudioGraph = { seed: '', nodes: [], edges: [] };
const IDLE_MS = 3500;
const ROOM_KEY = 'driftbox.room';
const PLANT_LEAD = 0.05;
const NO_PLANTINGS: Planting[] = [];
const NOT_PLANTABLE = 'button, a, input, select, textarea, header, [data-noplant]';
const CARD_SHOW_MS = 6000;

const graphOf = (patch: PatchFile): AudioGraph => ({
  seed: patch.seed,
  nodes: patch.nodes.map(({ id, type, data }) => ({ id, type, data })),
  edges: patch.edges,
  form: patch.form,
});

const idOf = ({ seed, attempt, visualSeed, visualAttempt, cards }: DriftId): DriftId => ({
  seed,
  attempt,
  visualSeed,
  visualAttempt,
  ...(cards?.length ? { cards } : {}),
});

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, button, [contenteditable]');

export function DriftScreen({ onOpenPatcher, resumeAudio = false }: Props) {
  const [store, setStore] = useState<DriftStore | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [entries, setEntries] = useState<KeptDrift[] | null>(null);
  const { drift, progress, error, next, load, cancel, play } = useDrift(store);
  const [locks, setLocks] = useState<Locks>(NO_LOCKS);
  const [panel, setPanel] = useState<'locks' | 'library' | null>(null);
  const [exporting, setExporting] = useState<Exporting>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [endless, setEndless] = useState<Endless>(null);
  const [endlessMinutes, setEndlessMinutes] = useState<EndlessMinutes>(5);
  const daily = useDailyDrift();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [room, setRoom] = useState(() => localStorage.getItem(ROOM_KEY) === '1');
  const [planted, setPlanted] = useState<{ key: string; list: Planting[] } | null>(null);
  const [sprouts, setSprouts] = useState<Sprout[]>([]);
  const [shownCard, setShownCard] = useState<ShownCard | null>(null);
  const hours = useHours();
  const currentKey = drift ? driftKey(drift.id) : null;
  const entry = entries?.find((e) => e.key === currentKey) ?? null;
  const plantings = planted && planted.key === currentKey ? planted.list : entry?.plantings ?? NO_PLANTINGS;

  const full = useMemo(() => {
    const base = drift ? graphOf(drift.patch) : EMPTY_GRAPH;
    const graph = hours.setting ? { ...base, nodes: hoursNodes(base.nodes, base.seed, hours.setting) } : base;
    return room ? roomGraph(graph) : graph;
  }, [drift, room, hours.setting]);
  const transpose = hours.setting && full.seed ? hoursTranspose(full.seed, hours.setting) : 1;
  const audioGraph = useMemo(() => ({ ...audioOnly(full), plantings, room, transpose }), [full, plantings, room, transpose]);
  const visualGraph = useMemo(() => toVisualGraph(full), [full]);
  const scale = useMemo(() => driftScale(drift?.patch.nodes ?? []), [drift]);
  const audio = useLiveAudio(audioGraph);
  const startAudio = audio.start;
  const pendingResume = useRef(resumeAudio);
  useEffect(() => {
    if (!pendingResume.current) return;
    pendingResume.current = false;
    void startAudio();
  }, [startAudio]);
  const look = useFormLook(full.form, audio.formPosition);
  const visualError = useVisualCanvas(canvas, visualGraph, full.seed, audio.features, !endless, 1.5, look);
  const masterId = drift?.patch.nodes.find((n) => n.type === 'master')?.id ?? null;
  const isKept = useCallback((d: Drift) => !!entries?.some((e) => e.key === driftKey(d.id)), [entries]);
  const kept = !!drift && isKept(drift);
  const lockCount = activeLockCount(locks);

  useEffect(() => {
    let alive = true;
    DriftStore.open()
      .then(async (s) => {
        if (!alive) return;
        setStore(s);
        setEntries(await s.list());
      })
      .catch((err: unknown) => {
        if (alive) setStoreError(err instanceof Error ? err.message : 'Local storage is unavailable.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const driftRef = useRef(drift);
  driftRef.current = drift;
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const fromHash = () => {
      const req = parseDriftHash(location.hash);
      if (!req) return;
      const current = driftRef.current;
      if (current && driftHash(current.id) === location.hash) return;
      void loadRef.current(req);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  useEffect(() => {
    if (error) setToast({ text: error, tone: 'error' });
  }, [error]);

  useEffect(() => {
    if (audio.error) setToast({ text: audio.error, tone: 'error' });
  }, [audio.error]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const ensureAudio = useCallback(() => {
    if (audio.status === 'off' || audio.status === 'error') void audio.start();
  }, [audio]);

  const handleDrift = useCallback(() => {
    if (progress) {
      cancel();
      return;
    }
    ensureAudio();
    setPanel((p) => (p === 'locks' ? null : p));
    void next(locks);
  }, [progress, cancel, ensureAudio, next, locks]);

  const driftKeyHandler = useRef(handleDrift);
  driftKeyHandler.current = handleDrift;
  const blockSpace = !!exporting || panel === 'library' || !!endless;

  useEffect(() => {
    if (blockSpace) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      driftKeyHandler.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blockSpace]);

  const refreshLibrary = useCallback(async () => {
    if (!store) return;
    setEntries(await store.list());
  }, [store]);

  const copy = useCallback(async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ text: done, tone: 'ok' });
    } catch {
      setToast({ text: 'Your browser blocked copying to the clipboard.', tone: 'error' });
    }
  }, []);

  const toggleKeep = useCallback(
    async (target: Drift) => {
      if (!store) return;
      const key = driftKey(target.id);
      try {
        if (isKept(target)) {
          await store.remove(key);
          if (target === drift) setPlanted({ key, list: plantings });
          setToast({ text: 'Removed from library', tone: 'ok' });
        } else {
          await store.keep({
            ...idOf(target.id),
            key,
            name: target.patch.name,
            archetype: target.traits.archetype,
            brightness: target.traits.brightness,
            length: target.traits.length,
            keptAt: Date.now(),
            ...(target === drift && plantings.length ? { plantings } : {}),
          });
          setToast({ text: `Kept “${target.patch.name}”`, tone: 'ok' });
        }
        await refreshLibrary();
      } catch {
        setToast({ text: 'The library could not be updated.', tone: 'error' });
      }
    },
    [store, isKept, refreshLibrary, drift, plantings],
  );

  useEffect(() => {
    localStorage.setItem(ROOM_KEY, room ? '1' : '0');
  }, [room]);

  useLowBattery(() => {
    if (room) return;
    setRoom(true);
    setToast({ text: 'Battery is low, so Room mode is on to save power', tone: 'ok' });
  });

  const savePlantings = useCallback(
    async (list: Planting[]) => {
      if (!currentKey) return;
      setPlanted({ key: currentKey, list });
      if (!store || !entry) return;
      try {
        await store.keep({ ...entry, plantings: list });
        await refreshLibrary();
      } catch {
        setToast({ text: 'Your planted notes could not be saved.', tone: 'error' });
      }
    },
    [currentKey, store, entry, refreshLibrary],
  );

  const plant = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!drift || audio.status !== 'running' || progress || panel || exporting) return;
      if (e.target instanceof Element && e.target.closest(NOT_PLANTABLE)) return;
      const at = audio.elapsed();
      if (at === null) return;
      const box = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      const time = at + PLANT_LEAD;
      const note = plantAt(x / box.width, y / box.height, time, scale, drift.id.seed, Math.round(time * 1000));
      void savePlantings([...plantings, note].slice(-MAX_PLANTINGS));
      const id = performance.now();
      setSprouts((s) => [...s, { id, x, y }]);
      setTimeout(() => setSprouts((s) => s.filter((r) => r.id !== id)), 1600);
    },
    [drift, audio, progress, panel, exporting, scale, plantings, savePlantings],
  );

  const drawOne = useCallback(() => {
    if (!drift || progress) return;
    const card = drawCard(drift.id, drift.patch);
    if (!card) {
      setToast({ text: 'Every card that fits this drift has been drawn.', tone: 'ok' });
      return;
    }
    ensureAudio();
    setPlanted({ key: driftKey({ ...drift.id, cards: [...(drift.id.cards ?? []), card.id] }), list: plantings });
    play(card);
    setShownCard({ id: performance.now(), text: card.text });
  }, [drift, progress, ensureAudio, plantings, play]);

  useEffect(() => {
    if (!shownCard) return;
    const t = setTimeout(() => setShownCard(null), CARD_SHOW_MS);
    return () => clearTimeout(t);
  }, [shownCard]);

  const asHeard = useCallback((patch: PatchFile) => (hours.setting ? hoursPatch(patch, hours.setting) : patch), [hours.setting]);

  const playDaily = useCallback(() => {
    ensureAudio();
    setPanel(null);
    void load(dailyRequest(daily));
  }, [ensureAudio, load, daily]);

  const startEndless = useCallback(() => {
    if (endless) return;
    let session: EndlessAudio;
    try {
      session = new EndlessAudio();
    } catch (err) {
      setToast({ text: err instanceof Error ? err.message : 'Endless mode could not start audio.', tone: 'error' });
      return;
    }
    if (progress) cancel();
    const resumeMain = audio.status === 'running';
    if (resumeMain) void audio.togglePause();
    setPanel(null);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    setEndless({ session, first: drift, resumeMain });
  }, [endless, progress, cancel, audio, drift]);

  const exitEndless = useCallback(
    (last: Drift | null) => {
      if (!endless) return;
      endless.session.close();
      setEndless(null);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      if (last && last !== drift) void load(idOf(last.id));
      if (endless.resumeMain || (last && audio.status === 'off')) {
        if (audio.status === 'paused') void audio.togglePause();
        else if (audio.status === 'off' || audio.status === 'error') void audio.start();
      }
    },
    [endless, drift, load, audio],
  );

  const removeEntry = useCallback(
    async (entry: KeptDrift) => {
      if (!store) return;
      try {
        await store.remove(entry.key);
        await refreshLibrary();
        setToast({ text: `Deleted “${entry.name}”`, tone: 'ok' });
      } catch {
        setToast({ text: 'The drift could not be deleted.', tone: 'error' });
      }
    },
    [store, refreshLibrary],
  );

  const playEntry = useCallback(
    (entry: KeptDrift) => {
      ensureAudio();
      setPanel(null);
      void load(idOf(entry));
    },
    [ensureAudio, load],
  );

  const exportEntry = (entry: KeptDrift, kind: 'wav' | 'mp4') =>
    setExporting({ kind, patch: asHeard(generatePatch(idOf(entry))), seconds: entry.length });

  const toggleAudio = () => {
    if (audio.status === 'off' || audio.status === 'error') void audio.start();
    else void audio.togglePause();
  };

  useMediaSession(endless ? null : drift, audio.status === 'running', {
    play: () => {
      if (audio.status !== 'running') toggleAudio();
    },
    pause: () => {
      if (audio.status === 'running') void audio.togglePause();
    },
    next: () => {
      if (!progress) handleDrift();
    },
  });

  const idle = useIdle(IDLE_MS, !!drift && audio.status === 'running' && panel === null && !progress && !exporting);
  const chrome = `transition-opacity duration-700 ${idle ? 'opacity-0' : 'opacity-100'}`;

  return (
    <MeterContext.Provider value={audio.meters}>
      <div
        onClick={plant}
        className={`relative h-full w-full overflow-hidden bg-black text-white ${idle ? 'cursor-none' : drift && audio.status === 'running' ? 'cursor-crosshair' : ''}`}
      >
        <canvas
          ref={canvas}
          aria-hidden
          className={`absolute inset-0 h-full w-full transition-opacity duration-1000 ${drift ? 'opacity-100' : 'opacity-0'}`}
        />
        {drift && <div key={currentKey} className="animate-veil pointer-events-none absolute inset-0 bg-black" />}
        {!drift && (
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_55%,rgba(251,191,36,0.12),transparent_55%)]" />
        )}
        {sprouts.map((r) => (
          <span key={r.id} className="pointer-events-none absolute z-10" style={{ left: r.x, top: r.y }}>
            <span className="animate-sprout absolute -left-6 -top-6 h-12 w-12 rounded-full border border-emerald-200/70" />
            <span className="animate-sprout-core absolute -left-1 -top-1 h-2 w-2 rounded-full bg-emerald-50" />
          </span>
        ))}
        {shownCard && (
          <div className="pointer-events-none absolute inset-x-0 top-[22%] z-20 flex justify-center px-6">
            <p key={shownCard.id} role="status" className="animate-card-note max-w-md text-center font-display text-lg italic leading-snug text-white/75 sm:text-xl">
              {shownCard.text}
            </p>
          </div>
        )}
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent ${chrome}`} />
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black/80 via-black/35 to-transparent ${chrome}`} />

        <div className={`relative z-10 flex h-full flex-col ${chrome}`}>
          <header className="flex items-center justify-between px-5 py-4 sm:px-8 sm:py-6">
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-amber-400 text-ink-950">
                <AudioWaveform size={16} strokeWidth={2.25} />
              </span>
              <span className="font-mono text-[12px] font-medium tracking-[0.2em] text-white/90">DRIFTBOX</span>
            </div>
            <nav className="flex items-center gap-1">
              {drift && (
                <HeaderButton onClick={playDaily} label="Today">
                  <CalendarDays className="h-4 w-4" />
                </HeaderButton>
              )}
              <HeaderButton onClick={() => setPanel('library')} label="Library" count={entries?.length}>
                <Library className="h-4 w-4" />
              </HeaderButton>
              <HeaderButton onClick={() => onOpenPatcher(null)} label="Patcher">
                <Network className="h-4 w-4" />
              </HeaderButton>
            </nav>
          </header>

          <main className={`flex flex-1 flex-col items-center pb-8 sm:pb-12 ${drift ? 'justify-end' : 'justify-center'}`}>
            {drift ? (
              <DriftDock
                drift={drift}
                masterId={masterId}
                progress={progress}
                hold={locks.hold}
                lockCount={lockCount}
                kept={kept}
                canKeep={!!store}
                audioStatus={audio.status}
                formPosition={audio.formPosition}
                elapsed={audio.elapsed}
                plantings={plantings}
                room={room}
                onToggleRoom={() => setRoom((r) => !r)}
                graph={full}
                hoursClock={hours.on ? hours.setting?.clock ?? null : null}
                hoursOn={hours.on}
                onToggleHours={hours.toggle}
                cardTexts={(drift.id.cards ?? []).map(cardText)}
                onDrawCard={drawOne}
                onClearPlantings={() => void savePlantings([])}
                onAgain={handleDrift}
                onToggleAudio={toggleAudio}
                onToggleLocks={() => setPanel((p) => (p === 'locks' ? null : 'locks'))}
                onKeep={() => void toggleKeep(drift)}
                onEndless={startEndless}
                onExportWav={() => setExporting({ kind: 'wav', patch: asHeard(drift.patch), seconds: drift.traits.length })}
                onExportVideo={() => setExporting({ kind: 'mp4', patch: asHeard(drift.patch), seconds: drift.traits.length })}
                onOpenPatcher={() => onOpenPatcher(drift.patch)}
                onCopyLink={() => void copy(driftUrl(drift.id), 'Link copied')}
                onCopySeed={() => void copy(drift.id.seed, 'Seed copied')}
              />
            ) : (
              <DriftHero
                progress={progress}
                lockCount={lockCount}
                daily={daily}
                onDrift={handleDrift}
                onDaily={playDaily}
                onEndless={startEndless}
                onToggleLocks={() => setPanel((p) => (p === 'locks' ? null : 'locks'))}
              />
            )}
          </main>
        </div>

        {visualError && drift && (
          <div className="absolute bottom-3 left-3 z-20 max-w-xs rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-[11px] leading-relaxed text-white/70 backdrop-blur">
            Visuals are unavailable in this browser. The sound still plays.
          </div>
        )}

        {panel === 'locks' && (
          <div className="fixed inset-0 z-30 flex items-end justify-center pb-24 sm:pb-32">
            <button type="button" aria-label="Close locks" className="absolute inset-0 cursor-default" onClick={() => setPanel(null)} />
            <div className="relative">
              <LocksPanel locks={locks} canHold={!!drift} onChange={setLocks} onClose={() => setPanel(null)} />
            </div>
          </div>
        )}

        {panel === 'library' && (
          <LibraryDrawer
            entries={entries}
            error={storeError}
            currentKey={currentKey}
            onClose={() => setPanel(null)}
            onPlay={playEntry}
            onExportWav={(e) => exportEntry(e, 'wav')}
            onExportVideo={(e) => exportEntry(e, 'mp4')}
            onDelete={(e) => void removeEntry(e)}
          />
        )}

        {endless && (
          <EndlessView
            session={endless.session}
            first={endless.first}
            store={store}
            locks={locks}
            minutes={endlessMinutes}
            onMinutes={setEndlessMinutes}
            isKept={isKept}
            onKeep={(d) => void toggleKeep(d)}
            onExit={exitEndless}
          />
        )}

        {toast && (
          <div className="pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-4">
            <div
              role="status"
              className={`animate-fade-up rounded-full border px-4 py-1.5 text-[12px] shadow-xl backdrop-blur-xl ${
                toast.tone === 'ok' ? 'border-white/15 bg-black/70 text-white/90' : 'border-rose-500/40 bg-black/80 text-rose-300'
              }`}
            >
              {toast.text}
            </div>
          </div>
        )}

        {exporting?.kind === 'wav' && (
          <ExportDialog getPatch={() => exporting.patch} defaultSeconds={exporting.seconds} onClose={() => setExporting(null)} />
        )}
        {exporting?.kind === 'mp4' && (
          <VideoExportDialog getPatch={() => exporting.patch} defaultSeconds={exporting.seconds} onClose={() => setExporting(null)} />
        )}
      </div>
    </MeterContext.Provider>
  );
}

interface HeaderButtonProps {
  label: string;
  count?: number;
  onClick(): void;
  children: ReactNode;
}

function HeaderButton({ label, count, onClick, children }: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-white/10 px-1.5 text-[10px] tabular-nums text-white/80">{count}</span>
      )}
    </button>
  );
}
