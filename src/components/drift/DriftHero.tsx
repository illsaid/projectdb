import { Infinity as InfinityIcon, Lock } from 'lucide-react';
import type { DailyDrift } from '@/drift/daily';
import { progressText, type DriftProgress } from '@/hooks/useDrift';
import { DailyCard } from './DailyCard';
import { DriftButton } from './DriftButton';

interface Props {
  progress: DriftProgress | null;
  lockCount: number;
  daily: DailyDrift;
  onDrift(): void;
  onDaily(): void;
  onEndless(): void;
  onToggleLocks(): void;
}

const chip = 'flex items-center gap-2 rounded-full border px-4 py-1.5 text-[12px] transition-colors';

export function DriftHero({ progress, lockCount, daily, onDrift, onDaily, onEndless, onToggleLocks }: Props) {
  return (
    <div className="flex flex-col items-center gap-10 px-6 text-center">
      <div className="animate-drift-in">
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-amber-200/70">Generative sound and light</p>
        <h1 className="mt-4 font-display text-5xl leading-[1.1] text-white sm:text-7xl">
          Press once.
          <br />
          <em className="text-white/55">Arrive somewhere new.</em>
        </h1>
      </div>

      <DriftButton size="hero" label="Drift" progress={progress} onClick={onDrift} />

      <div className="flex flex-col items-center gap-4">
        <p className="h-5 max-w-sm text-[13px] leading-relaxed text-white/55">
          {progress ? <span className="text-amber-100/85">{progressText(progress)}</span> : 'Each drift is checked for sound and sight before you hear it.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onToggleLocks}
            className={`${chip} ${
              lockCount > 0 ? 'border-amber-300/50 bg-amber-300/10 text-amber-100' : 'border-white/15 text-white/70 hover:border-white/30 hover:text-white'
            }`}
          >
            <Lock className="h-3.5 w-3.5" />
            {lockCount > 0 ? `${lockCount} lock${lockCount > 1 ? 's' : ''} set` : 'Locks'}
          </button>
          <button type="button" onClick={onEndless} className={`${chip} border-white/15 text-white/70 hover:border-white/30 hover:text-white`}>
            <InfinityIcon className="h-3.5 w-3.5" />
            Endless
          </button>
        </div>
      </div>

      <div className="animate-fade-in w-full flex justify-center">
        <DailyCard daily={daily} disabled={!!progress} onPlay={onDaily} />
      </div>
    </div>
  );
}
