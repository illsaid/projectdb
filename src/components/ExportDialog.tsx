import { useEffect, useState } from 'react';
import { AlertTriangle, Download, FileAudio, FileJson, Loader2, X } from 'lucide-react';
import { exportPatch } from '@/audio/exportPatch';
import type { LoudnessResult, LoudnessTarget } from '@/audio/loudness';
import { LoudnessPicker } from './LoudnessPicker';
import { shortSeed } from '@/audio/random';
import type { PatchFile } from '@/patch/types';

const PRESETS = [10, 30, 60, 180];
const MAX_SECONDS = 600;

interface Props {
  getPatch(): PatchFile;
  onClose(): void;
  defaultSeconds?: number;
}

export function ExportDialog({ getPatch, onClose, defaultSeconds = 30 }: Props) {
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [sampleRate, setSampleRate] = useState(48000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loudness, setLoudness] = useState<LoudnessTarget>(-14);
  const [result, setResult] = useState<LoudnessResult | null>(null);
  const patch = getPatch();
  const hasMaster = patch.nodes.some((n) => n.type === 'master');
  const valid = seconds >= 1 && seconds <= MAX_SECONDS;
  const sizeMb = ((seconds * sampleRate * 4) / 1024 / 1024).toFixed(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await exportPatch(patch, { seconds, sampleRate, loudness }));
    } catch {
      setError('Rendering failed. Try a shorter duration or a lower sample rate.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-[2px] p-4" onMouseDown={() => !busy && onClose()}>
      <div
        className="animate-fade-up w-full max-w-sm rounded-lg border border-ink-700 bg-ink-850 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Export audio"
      >
        <div className="flex items-center justify-between px-4 h-11 border-b border-ink-700">
          <h2 className="text-[13px] font-semibold text-ink-100">Export render</h2>
          <button type="button" onClick={onClose} disabled={busy} className="text-ink-400 hover:text-ink-100 disabled:opacity-40">
            <X size={15} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-1.5">Duration (seconds)</label>
            <div className="flex gap-1.5">
              <input
                type="number"
                min={1}
                max={MAX_SECONDS}
                value={seconds}
                onChange={(e) => setSeconds(Math.round(Number(e.target.value)))}
                className="w-20 h-8 px-2 rounded border border-ink-700 bg-ink-900 font-mono text-[12px] text-ink-100 outline-none focus:border-sky-500 transition-colors"
              />
              {PRESETS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeconds(s)}
                  className={`flex-1 h-8 rounded border font-mono text-[11px] transition-colors ${
                    seconds === s ? 'border-sky-500/60 bg-sky-500/10 text-sky-300' : 'border-ink-700 text-ink-300 hover:border-ink-600'
                  }`}
                >
                  {s >= 60 ? `${s / 60}m` : `${s}s`}
                </button>
              ))}
            </div>
            {!valid && <p className="mt-1.5 text-[11px] text-rose-300">Choose between 1 and {MAX_SECONDS} seconds.</p>}
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-1.5">Sample rate</label>
            <div className="flex rounded border border-ink-700 bg-ink-900 p-0.5">
              {[44100, 48000].map((sr) => (
                <button
                  key={sr}
                  type="button"
                  onClick={() => setSampleRate(sr)}
                  className={`flex-1 h-7 rounded-sm font-mono text-[11px] transition-colors ${
                    sampleRate === sr ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
                  }`}
                >
                  {sr / 1000} kHz
                </button>
              ))}
            </div>
          </div>

          <LoudnessPicker value={loudness} disabled={busy} onChange={setLoudness} />

          <div className="rounded border border-ink-700 bg-ink-900 divide-y divide-ink-700 text-[11.5px]">
            <div className="flex items-center gap-2 px-3 py-2 text-ink-200">
              <FileAudio size={13} className="text-amber-300" /> Stereo WAV, 16-bit
              <span className="ml-auto font-mono text-ink-400">~{sizeMb} MB</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 text-ink-200">
              <FileJson size={13} className="text-sky-300" /> Patch + seed
              <span className="ml-auto font-mono text-ink-400" title={patch.seed}>#{shortSeed(patch.seed)}</span>
            </div>
          </div>

          {!hasMaster && (
            <p className="flex gap-2 text-[11.5px] text-amber-300 leading-relaxed">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> This patch has no Master module, so the render will be silent.
            </p>
          )}
          {error && <p className="text-[11.5px] text-rose-300">{error}</p>}
          {result && !error && (
            <div className="animate-fade-up space-y-2">
              <div className="rounded border border-ink-700 bg-ink-900 divide-y divide-ink-700 font-mono text-[12px] tabular-nums">
                <ResultRow label="Loudness" value={Number.isFinite(result.final) ? `${result.final.toFixed(1)} LUFS` : 'silent'} />
                {loudness !== null && Number.isFinite(result.measured) && (
                  <ResultRow label="As rendered" value={`${result.measured.toFixed(1)} LUFS`} muted />
                )}
                <ResultRow
                  label="Peak"
                  value={Number.isFinite(result.peakDb) ? `${result.peakDb.toFixed(1)} dBFS` : '−∞ dBFS'}
                  tone={result.peakDb > -0.1 ? 'text-rose-300' : 'text-emerald-300'}
                />
              </div>
              {result.limited && (
                <p className="text-[11.5px] text-amber-300 leading-relaxed">
                  The Master ceiling kept this render below the target so its peaks stay clean.
                </p>
              )}
              <p className="text-[11.5px] text-emerald-300 leading-relaxed">
                Render complete. If only one file downloaded, allow multiple downloads for this site.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 pb-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-8 px-3 rounded text-[12px] text-ink-300 hover:text-ink-100 disabled:opacity-40 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={run}
            disabled={busy || !valid}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded bg-amber-400 text-ink-950 text-[12px] font-semibold hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {busy ? 'Rendering' : 'Render & download'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultRow({ label, value, tone = 'text-ink-100', muted }: { label: string; value: string; tone?: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-ink-400">{label}</span>
      <span className={muted ? 'text-ink-400' : tone}>{value}</span>
    </div>
  );
}
