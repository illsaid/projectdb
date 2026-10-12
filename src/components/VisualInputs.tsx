import { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ChevronDown } from 'lucide-react';
import { num } from '@/patch/definitions';
import { visualHandleId, type NodeData } from '@/patch/types';
import { ENVELOPE_SPECS, envKey, VISUAL_INPUTS } from '@/visual/inputs';
import { ParamSlider } from './ParamSlider';

const ACCENT = '#2dd4bf';

interface Props {
  id: string;
  data: NodeData;
  accent: string;
  connected: Set<string>;
}

/** Base value per visual input, plus attack/release/gain/invert shaping revealed on demand. */
export function VisualInputs({ id, data, accent, connected }: Props) {
  const { updateNodeData } = useReactFlow();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      {VISUAL_INPUTS.map((spec) => {
        const isOpen = open === spec.key;
        const inverted = num(data, envKey(spec.key, 'invert')) === 1;
        return (
          <div key={spec.key} className={`rounded transition-colors ${isOpen ? 'bg-ink-900/80 -mx-1.5 px-1.5 pb-1.5' : ''}`}>
            <div className="flex items-center gap-1">
              <div className="flex-1 min-w-0">
                <ParamSlider
                  spec={spec}
                  value={num(data, spec.key, spec.default)}
                  accent={accent}
                  connected={connected.has(spec.key)}
                  handle={{
                    id: visualHandleId(spec.key),
                    className: 'h-vis',
                    title: `Drive ${spec.label} from an analysis output`,
                    activeText: 'text-teal-300',
                  }}
                  onChange={(v) => updateNodeData(id, { [spec.key]: v })}
                />
              </div>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : spec.key)}
                title={`${isOpen ? 'Hide' : 'Show'} response shaping for ${spec.label}`}
                className={`nodrag grid place-items-center w-4 h-5 rounded-sm transition-colors ${
                  isOpen ? 'text-teal-300' : 'text-ink-500 hover:text-ink-200'
                }`}
              >
                <ChevronDown size={11} className={`transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {isOpen && (
              <div className="animate-fade-up mt-1 pl-2 border-l border-teal-400/30 space-y-1">
                {ENVELOPE_SPECS.map((env) => (
                  <ParamSlider
                    key={env.key}
                    spec={env}
                    value={num(data, envKey(spec.key, env.key), env.default)}
                    accent={ACCENT}
                    onChange={(v) => updateNodeData(id, { [envKey(spec.key, env.key)]: v })}
                  />
                ))}
                <div className="grid grid-cols-[44px_1fr] items-center gap-2 h-5">
                  <span className="text-[10px] uppercase tracking-wider text-ink-400">Invert</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={inverted}
                    onClick={() => updateNodeData(id, { [envKey(spec.key, 'invert')]: inverted ? 0 : 1 })}
                    className={`nodrag justify-self-start h-4 px-2 rounded-sm font-mono text-[9.5px] tracking-wider border transition-colors ${
                      inverted
                        ? 'border-teal-400/50 bg-teal-400/15 text-teal-200'
                        : 'border-ink-700 bg-ink-900 text-ink-400 hover:text-ink-200'
                    }`}
                  >
                    {inverted ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
