import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clapperboard, Download, FileJson, Loader2, X } from 'lucide-react';
import { loudnessSummary, type LoudnessTarget } from '@/audio/loudness';
import { shortSeed } from '@/audio/random';
import { LoudnessPicker } from './LoudnessPicker';
import type { PatchFile } from '@/patch/types';
import {
  canStreamToDisk,
  estimateVideoBytes,
  ExportCancelled,
  exportVideo,
  MEMORY_WARN_BYTES,
  pickVideoFile,
  VIDEO_SIZES,
  videoExportSupport,
  type VideoProgress,
  type VideoSettings,
} from '@/visual/exportVideo';

const DURATIONS = [10, 30, 60, 180];
const MAX_SECONDS = 300;
const STAGE_LABEL: Record<VideoProgress['stage'], string> = {
  audio: 'Rendering audio',
  frames: 'Drawing frames',
  finishing: 'Finishing file',
};

interface Props {
  getPatch(): PatchFile;
  onClose(): void;
  defaultSeconds?: number;
}

type Outcome = { tone: 'ok' | 'error' | 'info'; text: string } | null;

const formatBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

const discard = async (file: FileSystemFileHandle | null) => {
  const removable = file as (FileSystemFileHandle & { remove?: () => Promise<void> }) | null;
  await removable?.remove?.().catch(() => undefined);
};

export function VideoExportDialog({ getPatch, onClose, defaultSeconds = 30 }: Props) {
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [fps, setFps] = useState<VideoSettings['fps']>(30);
  const [loudness, setLoudness] = useState<LoudnessTarget>(-14);
  const [sizeId, setSizeId] = useState<(typeof VIDEO_SIZES)[number]['id']>('hd');
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const abort = useRef<AbortController | null>(null);
  const [patch] = useState(getPatch);
  const busy = progress !== null;
  const unsupported = videoExportSupport();
  const hasMaster = patch.nodes.some((n) => n.type === 'master');
  const hasVisual = patch.nodes.some((n) => n.type === 'visual');
  const valid = seconds >= 1 && seconds <= MAX_SECONDS;
  const size = VIDEO_SIZES.find((s) => s.id === sizeId) ?? VIDEO_SIZES[0];
  const [streaming] = useState(canStreamToDisk);
  const estimate = estimateVideoBytes({ seconds, fps, width: size.width, height: size.height, loudness });
  const heavy = !streaming && estimate > MEMORY_WARN_BYTES;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    setOutcome(null);
    let file: FileSystemFileHandle | null = null;
    try {
      file = await pickVideoFile(patch);
    } catch {
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ stage: 'audio', fraction: 0, frame: 0, totalFrames: Math.round(seconds * fps) });
    try {
      const { loudness: result, savedTo } = await exportVideo(
        patch,
        { seconds, fps, width: size.width, height: size.height, loudness },
        file,
        setProgress,
        controller.signal,
      );
      setOutcome({ tone: 'ok', text: `${savedTo ? `Saved ${savedTo}` : 'Video downloaded'}. Audio ${loudnessSummary(result)}.` });
    } catch (err) {
      await discard(file);
      if (err instanceof ExportCancelled) setOutcome({ tone: 'info', text: 'Export cancelled.' });
      else setOutcome({ tone: 'error', text: err instanceof Error ? err.message : 'Video export failed.' });
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  const pct = progress ? Math.round(progress.fraction * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-[2px] p-4" onMouseDown={() => !busy && onClose()}>
      <div
        className="animate-fade-up w-full max-w-sm rounded-lg border border-ink-700 bg-ink-850 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Export video"
      >
        <div className="flex items-center justify-between px-4 h-11 border-b border-ink-700">
          <h2 className="text-[13px] font-semibold text-ink-100">Export video</h2>
          <button type="button" onClick={onClose} disabled={busy} className="text-ink-400 hover:text-ink-100 disabled:opacity-40">
            <X size={15} />
          </button>
        </div>

        <fieldset disabled={busy} className="p-4 space-y-4 disabled:opacity-60 transition-opacity">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-1.5">Duration (seconds)</label>
            <div className="flex gap-1.5">
              <input
                type="number"
                min={1}
                max={MAX_SECONDS}
                value={seconds}
                onChange={(e) => setSeconds(Math.round(Number(e.target.value)))}
                className="w-20 h-8 px-2 rounded border border-ink-700 bg-ink-900 font-mono text-[12px] text-ink-100 outline-none focus:border-teal-500 transition-colors"
              />
              {DURATIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeconds(s)}
                  className={`flex-1 h-8 rounded border font-mono text-[11px] transition-colors ${
                    seconds === s ? 'border-teal-500/60 bg-teal-500/10 text-teal-300' : 'border-ink-700 text-ink-300 hover:border-ink-600'
                  }`}
                >
                  {s >= 60 ? `${s / 60}m` : `${s}s`}
                </button>
              ))}
            </div>
            {!valid && <p className="mt-1.5 text-[11px] text-rose-300">Choose between 1 and {MAX_SECONDS} seconds.</p>}
          </div>

          <Segmented<typeof sizeId>
            label="Frame size"
            value={sizeId}
            options={VIDEO_SIZES.map((s) => ({ value: s.id, label: s.label, hint: `${s.width}×${s.height}` }))}
            onChange={setSizeId}
          />
          <Segmented
            label="Frame rate"
            value={String(fps)}
            options={[
              { value: '24', label: '24 fps' },
              { value: '30', label: '30 fps' },
            ]}
            onChange={(v) => setFps(v === '24' ? 24 : 30)}
          />

          <LoudnessPicker value={loudness} disabled={busy} onChange={setLoudness} />

          <div className="rounded border border-ink-700 bg-ink-900 divide-y divide-ink-700 text-[11.5px]">
            <div className="flex items-center gap-2 px-3 py-2 text-ink-200">
              <Clapperboard size={13} className="text-teal-300" /> MP4, H.264 + stereo audio
              <span className="ml-auto font-mono text-ink-400">{Math.round(seconds * fps)} frames</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 text-ink-200">
              <Download size={13} className="text-emerald-300" />
              {streaming ? 'Writes straight to a file you choose' : 'Builds in memory, then downloads'}
              <span className={`ml-auto font-mono ${heavy ? 'text-amber-300' : 'text-ink-400'}`}>~{formatBytes(estimate)}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 text-ink-200">
              <FileJson size={13} className="text-sky-300" /> Patch + seed
              <span className="ml-auto font-mono text-ink-400" title={patch.seed}>#{shortSeed(patch.seed)}</span>
            </div>
          </div>
        </fieldset>

        <div className="px-4 space-y-2">
          {unsupported && <Notice text={unsupported} />}
          {!hasVisual && <Notice text="Add a Visual module to the patch first." />}
          {hasVisual && !hasMaster && <Notice text="This patch has no Master module, so the video will be silent." />}
          {heavy && (
            <Notice
              text={`This video is about ${formatBytes(estimate)} and this browser has to hold it all in memory, which may crash the tab. Try a shorter duration, a smaller size, or Chrome or Edge on desktop to save straight to disk.`}
            />
          )}

          {progress && (
            <div className="animate-fade-up space-y-1.5" aria-live="polite">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-200">{STAGE_LABEL[progress.stage]}</span>
                <span className="font-mono tabular-nums text-ink-400">
                  {progress.stage === 'frames' ? `${progress.frame} / ${progress.totalFrames} · ` : ''}
                  {pct}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-ink-900 overflow-hidden">
                <div className="h-full bg-teal-400 transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {outcome && (
            <p
              className={`animate-fade-up text-[11.5px] leading-relaxed ${
                outcome.tone === 'ok' ? 'text-emerald-300' : outcome.tone === 'error' ? 'text-rose-300' : 'text-ink-300'
              }`}
            >
              {outcome.text}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4">
          {busy ? (
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              className="h-8 px-3.5 rounded border border-rose-500/40 text-[12px] text-rose-300 hover:bg-rose-500/10 transition-colors"
            >
              Cancel export
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 rounded text-[12px] text-ink-300 hover:text-ink-100 transition-colors"
            >
              Close
            </button>
          )}
          <button
            type="button"
            onClick={run}
            disabled={busy || !valid || !hasVisual || unsupported !== null}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded bg-teal-400 text-ink-950 text-[12px] font-semibold hover:bg-teal-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {busy ? 'Exporting' : 'Render video'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p className="flex gap-2 text-[11.5px] text-amber-300 leading-relaxed">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {text}
    </p>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange(v: T): void;
}) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-1.5">{label}</span>
      <div className="flex rounded border border-ink-700 bg-ink-900 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex-1 py-1 rounded-sm transition-colors ${
              value === o.value ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            <span className="block font-mono text-[11px] leading-tight">{o.label}</span>
            {o.hint && <span className="block font-mono text-[9.5px] leading-tight text-ink-400">{o.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
