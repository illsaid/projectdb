import { Handle, Position } from '@xyflow/react';
import { FEATURE_KEYS, type FeatureKey } from '@/audio/features';
import { featureHandleId } from '@/patch/types';

const LABELS: Record<FeatureKey, { short: string; title: string }> = {
  rms: { short: 'RMS', title: 'Loudness' },
  low: { short: 'LOW', title: 'Bass energy (below 250 Hz)' },
  mid: { short: 'MID', title: 'Mid energy (250 Hz – 2 kHz)' },
  high: { short: 'HIGH', title: 'Treble energy (above 2 kHz)' },
  onset: { short: 'ONS', title: 'Onset: jumps when the sound suddenly gets louder' },
  value: { short: 'VAL', title: 'Raw output value (most useful on LFO and Random Walk)' },
};

/** Analysis outputs along the bottom edge; they can only be wired into a Visual module. */
export function FeatureOutputs() {
  return (
    <div className="grid grid-cols-6 border-t border-ink-700 bg-ink-900/60 rounded-b-md">
      {FEATURE_KEYS.map((key) => (
        <div key={key} className="relative h-5 grid place-items-center" title={LABELS[key].title}>
          <span className="font-mono text-[8.5px] tracking-wider text-teal-300/70">{LABELS[key].short}</span>
          <Handle type="source" position={Position.Bottom} id={featureHandleId(key)} className="h-feat" />
        </div>
      ))}
    </div>
  );
}
