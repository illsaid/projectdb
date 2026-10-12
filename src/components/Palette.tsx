import { NODE_DEFS, PALETTE_ORDER, type Category } from '@/patch/definitions';
import type { NodeKind } from '@/patch/types';
import { CATEGORY_STYLE } from './categoryStyle';

export const DRAG_MIME = 'application/x-patch-module';

const BLURBS: Record<NodeKind, string> = {
  oscillator: 'Tone source, four waveforms',
  fm: 'Carrier + modulator, bell strikes',
  loopVoice: 'Phrase repeating on its own cycle',
  noise: 'White or pink, seeded',
  filter: 'Low, high or band pass',
  formant: 'Vowel filter bank with morph',
  gain: 'Level control, soft or stepped',
  chorus: 'Swept short delays, stereo',
  delay: 'Echo with damped feedback',
  tapeEcho: 'Long, warbling, wearing repeats',
  reverb: 'Generated impulse space',
  lfo: 'Cyclic parameter motion',
  randomWalk: 'Seeded drifting motion',
  master: 'Limiter and speakers',
  visual: 'Audio-reactive shader',
};

interface PaletteProps {
  onAdd(kind: NodeKind): void;
  /** One-per-patch kinds that are already placed. */
  locked: NodeKind[];
}

export function MobilePalette({ onAdd, locked }: PaletteProps) {
  return (
    <div className="md:hidden flex gap-1 overflow-x-auto border-t border-ink-700 bg-ink-900 px-2 py-2">
      {PALETTE_ORDER.map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={locked.includes(kind)}
          onClick={() => onAdd(kind)}
          className={`shrink-0 h-8 px-2.5 rounded border border-ink-700 bg-ink-850 font-mono text-[10px] tracking-wider disabled:opacity-35 ${
            CATEGORY_STYLE[NODE_DEFS[kind].category].text
          }`}
        >
          + {NODE_DEFS[kind].short}
        </button>
      ))}
    </div>
  );
}

const GROUPS: Category[] = ['source', 'processor', 'modulator', 'output'];

export function Palette({ onAdd, locked }: PaletteProps) {
  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {GROUPS.map((cat) => {
          const style = CATEGORY_STYLE[cat];
          return (
            <section key={cat}>
              <h3 className="px-2 mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">{style.label}</h3>
              <div className="space-y-0.5">
                {PALETTE_ORDER.filter((k) => NODE_DEFS[k].category === cat).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={locked.includes(kind)}
                    title={locked.includes(kind) ? `This patch already has a ${NODE_DEFS[kind].title}` : undefined}
                    draggable={!locked.includes(kind)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, kind);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onAdd(kind)}
                    className="group w-full flex items-center gap-2.5 rounded px-2 py-1.5 text-left hover:bg-ink-800 active:bg-ink-700 transition-colors cursor-grab active:cursor-grabbing disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <span
                      className={`grid place-items-center w-9 h-6 rounded-sm border border-ink-700 bg-ink-850 font-mono text-[9.5px] tracking-wider ${style.text} group-hover:border-ink-600 transition-colors`}
                    >
                      {NODE_DEFS[kind].short}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] text-ink-100 leading-tight">{NODE_DEFS[kind].title}</span>
                      <span className="block text-[10.5px] text-ink-400 leading-tight truncate">
                        {locked.includes(kind) ? 'Already in patch' : BLURBS[kind]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="border-t border-ink-700 px-4 py-3 space-y-2 text-[10.5px] text-ink-400 leading-relaxed">
        <div className="flex items-center gap-2">
          <span className="w-6 h-[2px] bg-[#5b6b7d]" /> Audio signal
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6 border-t-[1.5px] border-dashed border-lime-400" /> Modulation
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6 border-t-[1.5px] border-dotted border-teal-400" /> Visual drive
        </div>
        <p className="pt-1">
          Drag or click to add. Wire any output into a green dot to modulate that setting. Wire the teal analysis dots
          under a module into a Visual input to make the picture react. Double-click a label to reset.
        </p>
      </div>
    </aside>
  );
}
