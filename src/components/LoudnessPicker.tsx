import { LOUDNESS_TARGETS, type LoudnessTarget } from '@/audio/loudness';

interface Props {
  value: LoudnessTarget;
  disabled?: boolean;
  onChange(value: LoudnessTarget): void;
}

export function LoudnessPicker({ value, disabled, onChange }: Props) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-[0.14em] text-ink-400 mb-1.5">Normalize loudness</label>
      <div className="flex rounded border border-ink-700 bg-ink-900 p-0.5">
        {LOUDNESS_TARGETS.map((t) => (
          <button
            key={t.label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(t.value)}
            className={`flex-1 rounded-sm py-1 transition-colors disabled:opacity-50 ${
              value === t.value ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            <span className="block font-mono text-[11px]">{t.label}</span>
            <span className="block text-[9.5px] uppercase tracking-[0.12em] opacity-70">{t.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
