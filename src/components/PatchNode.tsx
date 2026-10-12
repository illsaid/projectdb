import { memo, useMemo } from 'react';
import { Handle, Position, useNodeConnections, useReactFlow, type NodeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { hasFeatureOutputs, NODE_DEFS, num, str } from '@/patch/definitions';
import type { PatchFlowNode } from '@/patch/io';
import { AUDIO_IN, AUDIO_OUT, handleKey, isParamHandle, isVisualHandle, paramHandleId } from '@/patch/types';
import { CATEGORY_STYLE } from './categoryStyle';
import { FeatureOutputs } from './FeatureOutputs';
import { LevelMeter } from './LevelMeter';
import { ParamSlider } from './ParamSlider';
import { Scope } from './Scope';
import { VisualInputs } from './VisualInputs';

function PatchNodeView({ id, type, data, selected }: NodeProps<PatchFlowNode>) {
  const def = NODE_DEFS[type];
  const style = CATEGORY_STYLE[def.category];
  const { updateNodeData, deleteElements } = useReactFlow();
  const incoming = useNodeConnections({ handleType: 'target' });

  const modulated = useMemo(() => {
    const set = new Set<string>();
    for (const c of incoming) {
      if (isParamHandle(c.targetHandle) || isVisualHandle(c.targetHandle)) set.add(handleKey(c.targetHandle!));
    }
    return set;
  }, [incoming]);

  return (
    <div
      className={`w-[256px] rounded-md border bg-ink-850/95 backdrop-blur-sm shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)] transition-[border-color,box-shadow] duration-150 ${
        selected ? 'border-ink-300 shadow-[0_0_0_1px_rgba(241,245,249,0.15)]' : 'border-ink-700 hover:border-ink-600'
      }`}
    >
      <div className="relative flex items-center gap-2 h-8 pl-3 pr-1.5 border-b border-ink-700">
        <span className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-tl-md ${style.bar}`} />
        {def.hasInput && (
          <Handle type="target" position={Position.Left} id={AUDIO_IN} className="h-audio" title="Audio in" />
        )}
        <span className={`font-mono text-[10px] font-medium tracking-wider ${style.text}`}>{def.short}</span>
        <span className="text-[12px] font-medium text-ink-100 truncate">{def.title}</span>
        <span className="ml-auto">{type !== 'visual' && <LevelMeter nodeId={id} />}</span>
        <button
          type="button"
          onClick={() => deleteElements({ nodes: [{ id }] })}
          className="nodrag grid place-items-center w-5 h-5 rounded text-ink-500 hover:text-rose-300 hover:bg-ink-700 transition-colors"
          title="Remove module"
        >
          <X size={12} />
        </button>
        {def.hasOutput && (
          <Handle type="source" position={Position.Right} id={AUDIO_OUT} className="h-audio" title="Output" />
        )}
      </div>

      <div className="px-3 py-2 space-y-1.5">
        {def.choices.map((choice) => {
          const current = str(data, choice.key, choice.default);
          return (
            <div key={choice.key} className="grid grid-cols-[44px_1fr] items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-ink-400">{choice.label}</span>
              <div className="nodrag flex rounded border border-ink-700 bg-ink-900 p-0.5">
                {choice.options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateNodeData(id, { [choice.key]: opt.value })}
                    className={`flex-1 h-5 rounded-sm font-mono text-[9.5px] tracking-wider transition-colors ${
                      current === opt.value ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {type === 'visual' ? (
          <VisualInputs id={id} data={data} accent={style.accent} connected={modulated} />
        ) : (
          def.params.map((spec) => (
            <ParamSlider
              key={spec.key}
              spec={spec}
              value={num(data, spec.key, spec.default)}
              accent={style.accent}
              connected={modulated.has(spec.key)}
              handle={
                spec.modulatable
                  ? { id: paramHandleId(spec.key), className: 'h-param', title: `Modulate ${spec.label}`, activeText: 'text-lime-300' }
                  : undefined
              }
              onChange={(v) => updateNodeData(id, { [spec.key]: v })}
            />
          ))
        )}
        {type === 'master' && (
          <div className="pt-1">
            <Scope nodeId={id} />
          </div>
        )}
      </div>
      {hasFeatureOutputs(type) && <FeatureOutputs />}
    </div>
  );
}

export const PatchNode = memo(PatchNodeView);
