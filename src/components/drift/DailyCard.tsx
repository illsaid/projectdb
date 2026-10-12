import { CalendarDays, Play } from 'lucide-react';
import type { DailyDrift } from '@/drift/daily';
import { ARCHETYPE_LABEL, lengthLabel } from '@/drift/traits';

interface Props {
  daily: DailyDrift;
  disabled?: boolean;
  onPlay(): void;
}

const formatDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function DailyCard({ daily, disabled, onPlay }: Props) {
  return (
    <button
      type="button"
      onClick={onPlay}
      disabled={disabled}
      className="group flex w-full max-w-sm items-center gap-4 rounded-2xl border border-white/12 bg-white/[0.04] p-3 pr-4 text-left backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-amber-300/40 hover:bg-white/[0.07] disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-amber-300/25 via-amber-500/10 to-sky-400/20">
        <CalendarDays className="h-5 w-5 text-amber-100 transition-opacity duration-300 group-hover:opacity-0" />
        <Play className="absolute ml-0.5 h-5 w-5 text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-amber-200/75">Drift of the day</span>
        <span className="mt-0.5 block truncate font-display text-xl leading-[1.2] text-white">{daily.name}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-white/50">
          <time dateTime={daily.date}>{formatDate(daily.date)}</time> · {ARCHETYPE_LABEL[daily.traits.archetype]} · {lengthLabel(daily.traits.length)}
        </span>
      </span>
    </button>
  );
}
