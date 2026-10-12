import { Waves } from 'lucide-react';
import type { DriftProgress } from '@/hooks/useDrift';

interface Props {
  size: 'hero' | 'dock';
  label: string;
  progress: DriftProgress | null;
  onClick(): void;
}

export function DriftButton({ size, label, progress, onClick }: Props) {
  const busy = progress !== null;
  const hero = size === 'hero';
  const dim = hero ? 'h-40 w-40 sm:h-48 sm:w-48' : 'h-20 w-20';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={busy}
      title={busy ? 'Cancel' : `${label} (Space)`}
      className={`group relative grid shrink-0 place-items-center rounded-full ${dim} transition-transform duration-300 ease-out hover:scale-[1.04] active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/70 focus-visible:ring-offset-4 focus-visible:ring-offset-black`}
    >
      <span
        className={`absolute inset-0 rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-orange-500 ${
          busy ? 'opacity-70' : 'animate-drift-breathe'
        }`}
      />
      {busy && (
        <span
          className="absolute -inset-2 animate-spin rounded-full [animation-duration:1.4s]"
          style={{ background: 'conic-gradient(from 0deg, transparent 0 70%, rgba(253, 230, 138, 0.9) 100%)', mask: 'radial-gradient(circle, transparent 64%, black 65%)', WebkitMask: 'radial-gradient(circle, transparent 64%, black 65%)' }}
        />
      )}
      <span className="absolute inset-[3px] rounded-full bg-gradient-to-b from-white/25 to-transparent opacity-60" />
      <span className="relative flex flex-col items-center gap-1 text-amber-950">
        <Waves
          className={`${hero ? 'h-8 w-8' : 'h-5 w-5'} transition-transform duration-500 group-hover:translate-x-0.5 ${busy ? 'animate-pulse' : ''}`}
          strokeWidth={1.75}
        />
        <span className={`font-medium tracking-wide ${hero ? 'text-lg' : 'text-[12px]'}`}>{busy ? 'Cancel' : label}</span>
      </span>
    </button>
  );
}
