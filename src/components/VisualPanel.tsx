import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronDown, Clapperboard, Maximize2, Minimize2 } from 'lucide-react';
import type { FeatureBus } from '@/audio/featureBus';
import type { SectionLook } from '@/audio/form';
import { useVisualCanvas } from '@/hooks/useVisualCanvas';
import { str } from '@/patch/definitions';
import type { VisualGraph } from '@/patch/io';
import type { SeedHex } from '@/patch/types';
import { PRESET_NAMES, type VisualPreset } from '@/visual/inputs';

const MIN_W = 240;
const MIN_H = 135;

interface Props {
  graph: VisualGraph;
  seed: SeedHex;
  features: FeatureBus | null;
  look: () => SectionLook;
  onExport(): void;
}

/** Live preview of the Visual module, floating over the canvas. Rendering never touches audio. */
export function VisualPanel({ graph, seed, features, look, onExport }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 400, h: 225 });
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);
  const renderError = useVisualCanvas(canvasRef, graph, seed, features, !collapsed, undefined, look);
  const error = renderError ?? fsError;

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void panelRef.current?.requestFullscreen().catch(() => setFsError('Your browser refused fullscreen.'));
  };

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ...size };
    const parent = panelRef.current?.parentElement?.getBoundingClientRect();
    const maxW = (parent?.width ?? window.innerWidth) - 24;
    const maxH = (parent?.height ?? window.innerHeight) - 72;
    const move = (ev: PointerEvent) => {
      setSize({
        w: Math.round(Math.min(maxW, Math.max(MIN_W, start.w + (start.x - ev.clientX)))),
        h: Math.round(Math.min(maxH, Math.max(MIN_H, start.h + (ev.clientY - start.y)))),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const preset = (graph.node ? str(graph.node.data, 'preset', 'drift') : 'drift') as VisualPreset;
  const live = features !== null;

  return (
    <div
      ref={panelRef}
      className={`group/panel animate-fade-up flex flex-col overflow-hidden bg-ink-950 ${
        fullscreen
          ? 'w-full h-full'
          : 'absolute top-3 right-3 z-10 rounded-md border border-ink-700 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.9)]'
      }`}
      style={fullscreen ? undefined : { width: size.w }}
    >
      <div
        className={`flex items-center gap-2 h-8 pl-3 pr-1 bg-ink-850 border-b border-ink-700 ${
          fullscreen ? 'absolute inset-x-0 top-0 z-10 opacity-0 group-hover/panel:opacity-100 transition-opacity duration-200 bg-ink-850/80 backdrop-blur' : ''
        }`}
      >
        <span className="font-mono text-[10px] font-medium tracking-wider text-rose-300">VIS</span>
        <span className="text-[12px] text-ink-100 truncate">{PRESET_NAMES[preset] ?? 'Visual'}</span>
        <span
          className={`inline-flex items-center gap-1.5 text-[10.5px] ${live ? 'text-teal-300' : 'text-ink-400'}`}
          title={live ? 'Reacting to the live sound' : 'Start audio to make the picture react'}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-teal-400 animate-pulse' : 'bg-ink-500'}`} />
          {live ? 'Live' : 'Idle'}
        </span>
        <div className="ml-auto flex items-center">
          <IconButton title="Export video" onClick={onExport}>
            <Clapperboard size={13} />
          </IconButton>
          <IconButton title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen} disabled={collapsed}>
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </IconButton>
          {!fullscreen && (
            <IconButton title={collapsed ? 'Show preview' : 'Hide preview'} onClick={() => setCollapsed((c) => !c)}>
              <ChevronDown size={14} className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
            </IconButton>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="relative flex-1 min-h-0" style={fullscreen ? undefined : { height: size.h }}>
          <canvas ref={canvasRef} className="block w-full h-full" />
          {error && (
            <div className="absolute inset-0 grid place-items-center p-4 text-center text-[12px] text-rose-300 bg-ink-950/90">
              {error}
            </div>
          )}
          {!fullscreen && (
            <div
              onPointerDown={startResize}
              title="Drag to resize"
              className="absolute left-0 bottom-0 w-4 h-4 cursor-nesw-resize opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg viewBox="0 0 16 16" className="w-full h-full text-ink-300">
                <path d="M2 6 L10 14 M2 10 L6 14" stroke="currentColor" strokeWidth="1.25" fill="none" />
              </svg>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick(): void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="grid place-items-center w-7 h-7 rounded text-ink-300 hover:text-ink-100 hover:bg-ink-700 disabled:opacity-35 disabled:hover:bg-transparent transition-colors"
    >
      {children}
    </button>
  );
}
