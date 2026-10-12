import type { ReactNode } from 'react';
import { Bookmark, BookmarkCheck, Film, Infinity as InfinityIcon, Link2, Lock, Moon, Network, Pause, Play, Spade, Sprout, SunMoon, Waves } from 'lucide-react';
import type { FormPosition } from '@/audio/form';
import type { Planting } from '@/audio/plantings';
import { shortSeed } from '@/audio/random';
import type { Drift } from '@/drift/resolve';
import type { AudioGraph } from '@/patch/types';
import { ARCHETYPE_LABEL, BRIGHTNESS_LABEL, lengthLabel, type Hold } from '@/drift/traits';
import { progressText, type DriftProgress } from '@/hooks/useDrift';
import type { AudioStatus } from '@/hooks/useLiveAudio';
import { Scope } from '@/components/Scope';
import { DriftButton } from './DriftButton';
import { CycleRings } from './CycleRings';
import { SectionTimeline } from './SectionTimeline';

interface Props {
  drift: Drift;
  masterId: string | null;
  progress: DriftProgress | null;
  hold: Hold;
  lockCount: number;
  kept: boolean;
  canKeep: boolean;
  audioStatus: AudioStatus;
  formPosition(): FormPosition | null;
  elapsed(): number | null;
  plantings: Planting[];
  room: boolean;
  onToggleRoom(): void;
  /** The drift as it is playing (room mode, Hours and cards applied). */
  graph: AudioGraph;
  hoursOn: boolean;
  /** Clock Hours is following, once it has begun to blend in. */
  hoursClock: string | null;
  onToggleHours(): void;
  cardTexts: string[];
  onDrawCard(): void;
  onClearPlantings(): void;
  onAgain(): void;
  onToggleAudio(): void;
  onToggleLocks(): void;
  onKeep(): void;
  onExportWav(): void;
  onExportVideo(): void;
  onOpenPatcher(): void;
  onEndless(): void;
  onCopyLink(): void;
  onCopySeed(): void;
}

function attemptNote(drift: Drift): { text: string; warn: boolean } | null {
  const { attempt, visualAttempt } = drift.id;
  if (drift.audio && drift.audio.verdict !== 'ok') return { text: `closest sound after ${attempt + 1} tries`, warn: true };
  if (drift.visual && drift.visual.verdict !== 'ok') return { text: `closest visual after ${visualAttempt + 1} tries`, warn: true };
  const tries = Math.max(attempt, visualAttempt);
  return tries > 0 ? { text: `passed on try ${tries + 1}`, warn: false } : null;
}

export function DriftDock(p: Props) {
  const { drift } = p;
  const { traits } = drift;
  const note = attemptNote(drift);
  const playing = p.audioStatus === 'running';
  const needsGesture = p.audioStatus === 'off' || p.audioStatus === 'error';

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-5 px-4 text-center">
      <div key={`${drift.id.seed}.${drift.id.visualSeed}`} className="animate-drift-in flex flex-col items-center gap-2">
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-white/70">
          <span>{ARCHETYPE_LABEL[traits.archetype]}</span>
          <Dot />
          <span>{lengthLabel(traits.length)}</span>
          <Dot />
          <span>{BRIGHTNESS_LABEL[traits.brightness]}</span>
          {p.hold !== 'none' && (
            <span className="ml-1 rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-[10px] tracking-[0.12em] text-amber-200">
              {p.hold === 'visual' ? 'Visual held' : 'Sound held'}
            </span>
          )}
        </div>
        <div className="relative isolate">
          <CycleRings
            graph={p.graph}
            plantings={p.plantings}
            position={p.formPosition}
            elapsed={p.elapsed}
            active={p.audioStatus === 'running'}
            room={p.room}
          />
          <h1 className="font-display text-5xl leading-[1.1] text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.6)] sm:text-7xl">
            {drift.patch.name}
          </h1>
        </div>
        {drift.patch.form && (
          <SectionTimeline form={drift.patch.form} position={p.formPosition} active={p.audioStatus === 'running' || p.audioStatus === 'paused'} />
        )}
        <div className="flex flex-wrap items-center justify-center gap-2 font-mono text-[12px] text-white/60">
          <button
            type="button"
            onClick={p.onCopySeed}
            title={`Copy full seed ${drift.id.seed}`}
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-white/10 hover:text-white"
          >
            #{shortSeed(drift.id.seed)}
            {drift.id.visualSeed !== drift.id.seed && <span className="text-white/40"> / {shortSeed(drift.id.visualSeed)}</span>}
          </button>
          {note && <span className={note.warn ? 'text-amber-300/90' : 'text-white/45'}>{note.text}</span>}
          {p.cardTexts.length > 0 && (
            <span title={p.cardTexts.join('\n')} className="flex cursor-help items-center gap-1 px-1.5 py-0.5 text-white/50">
              <Spade className="h-3 w-3" />
              {p.cardTexts.length} {p.cardTexts.length === 1 ? 'card' : 'cards'}
            </span>
          )}
          {p.hoursClock && (
            <span title="Hours is following this local time" className="flex items-center gap-1 px-1.5 py-0.5 text-sky-200/70">
              <SunMoon className="h-3 w-3" />
              {p.hoursClock.slice(11)}
            </span>
          )}
          {p.plantings.length > 0 && (
            <button
              type="button"
              onClick={p.onClearPlantings}
              title="Remove every planted note from this drift"
              className="group flex items-center gap-1 rounded px-1.5 py-0.5 text-emerald-200/80 transition-colors hover:bg-white/10 hover:text-emerald-100"
            >
              <Sprout className="h-3 w-3" />
              {p.plantings.length} planted
              <span className="text-white/40 group-hover:text-white/70">· clear</span>
            </button>
          )}
        </div>
      </div>

      <div className="pointer-events-none h-14 opacity-90">{p.masterId && playing && <Scope nodeId={p.masterId} width={320} height={56} bare />}</div>

      <div className="flex items-center gap-5">
        <RoundAction
          label={p.lockCount > 0 ? `Locks (${p.lockCount})` : 'Locks'}
          onClick={p.onToggleLocks}
          active={p.lockCount > 0}
          badge={p.lockCount || undefined}
        >
          <Lock className="h-4 w-4" />
        </RoundAction>
        <DriftButton size="dock" label="Again" progress={p.progress} onClick={p.onAgain} />
        <RoundAction label={needsGesture ? 'Listen' : playing ? 'Pause' : 'Play'} onClick={p.onToggleAudio} pulse={needsGesture}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </RoundAction>
      </div>
      <div className="h-4 text-[12px] text-amber-100/80">
        {p.progress ? progressText(p.progress) : playing && <span className="text-white/45">Tap the picture to plant a note</span>}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-full border border-white/10 bg-black/45 p-1.5 backdrop-blur-xl">
        <PillAction onClick={p.onKeep} disabled={!p.canKeep} active={p.kept} title={p.kept ? 'Remove from library' : 'Keep in library'}>
          {p.kept ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
          {p.kept ? 'Kept' : 'Keep'}
        </PillAction>
        <PillAction onClick={p.onExportWav} title="Export audio as WAV">
          <Waves className="h-3.5 w-3.5" />
          WAV
        </PillAction>
        <PillAction onClick={p.onExportVideo} title="Export video as MP4">
          <Film className="h-3.5 w-3.5" />
          MP4
        </PillAction>
        <PillAction onClick={p.onDrawCard} disabled={!!p.progress} title="Draw a card: one small instruction, applied to this drift">
          <Spade className="h-3.5 w-3.5" />
          Card
        </PillAction>
        <PillAction
          onClick={p.onToggleHours}
          active={p.hoursOn}
          title={p.hoursOn ? 'Stop following the time of day' : 'Hours: brighter and sparser in the morning, darker and denser at night; the season warms the colours'}
        >
          <SunMoon className="h-3.5 w-3.5" />
          Hours
        </PillAction>
        <PillAction onClick={p.onToggleRoom} active={p.room} title={p.room ? 'Leave room mode' : 'Room mode: sparser, softer, calmer and 6 dB quieter'}>
          <Moon className="h-3.5 w-3.5" />
          Room
        </PillAction>
        <PillAction onClick={p.onEndless} title="Play endlessly, full screen">
          <InfinityIcon className="h-3.5 w-3.5" />
          Endless
        </PillAction>
        <PillAction onClick={p.onOpenPatcher} title="Open this drift in the patcher">
          <Network className="h-3.5 w-3.5" />
          Patcher
        </PillAction>
        <PillAction onClick={p.onCopyLink} title="Copy a link to this exact drift">
          <Link2 className="h-3.5 w-3.5" />
          Link
        </PillAction>
      </div>
    </div>
  );
}

const Dot = () => <span className="h-1 w-1 rounded-full bg-white/35" />;

interface RoundProps {
  label: string;
  onClick(): void;
  active?: boolean;
  pulse?: boolean;
  badge?: number;
  children: ReactNode;
}

function RoundAction({ label, onClick, active, pulse, badge, children }: RoundProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative grid h-12 w-12 place-items-center rounded-full border backdrop-blur-xl transition-all duration-200 hover:scale-105 active:scale-95 ${
        active ? 'border-amber-300/50 bg-amber-300/15 text-amber-100' : 'border-white/15 bg-black/40 text-white/85 hover:border-white/35 hover:text-white'
      } ${pulse ? 'animate-pulse-ring' : ''}`}
    >
      {children}
      {badge !== undefined && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-300 px-1 text-[10px] font-medium text-amber-950">
          {badge}
        </span>
      )}
    </button>
  );
}

interface PillProps {
  onClick(): void;
  title: string;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}

function PillAction({ onClick, title, disabled, active, children }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-amber-300/20 text-amber-100' : 'text-white/80 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
