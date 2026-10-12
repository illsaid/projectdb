import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type NodeTypes,
} from '@xyflow/react';
import { Power } from 'lucide-react';
import { useFormLook } from '@/hooks/useFormLook';
import { MeterContext } from '@/hooks/meterContext';
import { useLiveAudio } from '@/hooks/useLiveAudio';
import { legacySeed, randomSeed } from '@/audio/random';
import { defaultData, NODE_DEFS, PALETTE_ORDER, SINGLETON_KINDS } from '@/patch/definitions';
import {
  audioOnly,
  downloadBlob,
  fromPatchFile,
  isVisualEdge,
  parsePatchFile,
  patchGraph,
  slugify,
  styleEdge,
  toPatchFile,
  toVisualGraph,
  type PatchFlowNode,
} from '@/patch/io';
import { createsDelayFreeCycle, isAllowedLink } from '@/patch/graphRules';
import { STARTER_PATCHES } from '@/patch/starters';
import type { NodeKind, PatchFile } from '@/patch/types';
import { CATEGORY_STYLE } from './categoryStyle';
import { ExportDialog } from './ExportDialog';
import { DRAG_MIME, MobilePalette, Palette } from './Palette';
import { PatchNode } from './PatchNode';
import { TopBar } from './TopBar';
import { VideoExportDialog } from './VideoExportDialog';
import { VisualPanel } from './VisualPanel';

const STORAGE_KEY = 'driftbox:patch';

const nodeTypes = Object.fromEntries(PALETTE_ORDER.map((k) => [k, PatchNode])) as NodeTypes;

const uid = () => Math.random().toString(36).slice(2, 9);

function loadInitial(): PatchFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parsePatchFile(JSON.parse(raw));
  } catch {
    // fall through to the starter patch
  }
  return STARTER_PATCHES[0];
}

const EMPTY_PATCH: PatchFile = {
  format: 'patcher',
  version: 2,
  name: 'Untitled',
  seed: legacySeed(1),
  nodes: [{ id: 'master', type: 'master', position: { x: 600, y: 120 }, data: defaultData('master') }],
  edges: [],
};

type Toast = { text: string; tone: 'ok' | 'error' } | null;

interface Props {
  /** A patch handed over from another view; otherwise the autosaved patch is restored. */
  incoming: PatchFile | null;
  onHome(): void;
}

export function Patcher({ incoming, onHome }: Props) {
  const [initial] = useState(() => incoming ?? loadInitial());
  const [name, setName] = useState(initial.name);
  const [seed, setSeed] = useState(initial.seed);
  const [form, setForm] = useState(initial.form);
  const [nodes, setNodes, onNodesChange] = useNodesState<PatchFlowNode>(fromPatchFile(initial).nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(fromPatchFile(initial).edges);
  const [exportOpen, setExportOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const addCount = useRef(0);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const full = useMemo(() => patchGraph(nodes, edges, seed, form), [nodes, edges, seed, form]);
  const graph = useMemo(() => audioOnly(full), [full]);
  const visual = useMemo(() => toVisualGraph(full), [full]);
  const audio = useLiveAudio(graph);
  const look = useFormLook(form, audio.formPosition);

  const locked = useMemo(() => SINGLETON_KINDS.filter((k) => nodes.some((n) => n.type === k)), [nodes]);

  const getPatch = useCallback(() => toPatchFile(name, seed, nodes, edges, form), [name, seed, nodes, edges, form]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getPatch()));
      } catch {
        // storage full or disabled; autosave is best-effort
      }
    }, 400);
    return () => clearTimeout(t);
  }, [getPatch]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const applyPatch = useCallback(
    (file: PatchFile) => {
      const flow = fromPatchFile(file);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setSeed(file.seed);
      setForm(file.form);
      setName(file.name);
      setTimeout(() => fitView({ padding: 0.15, duration: 350 }), 60);
    },
    [setNodes, setEdges, fitView],
  );

  const addNode = useCallback(
    (kind: NodeKind, position: { x: number; y: number }) => {
      if (locked.includes(kind)) {
        setToast({ text: `A patch can only have one ${NODE_DEFS[kind].title} module.`, tone: 'error' });
        return;
      }
      setNodes((ns) => [...ns, { id: `${kind}-${uid()}`, type: kind, position, data: defaultData(kind) }]);
    },
    [setNodes, locked],
  );

  const addAtCenter = (kind: NodeKind) => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rect) return;
    const jitter = (addCount.current++ % 6) * 24;
    const p = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    addNode(kind, { x: p.x - 128 + jitter, y: p.y - 80 + jitter });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData(DRAG_MIME);
    if (!(kind in NODE_DEFS)) return;
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(kind as NodeKind, { x: p.x - 128, y: p.y - 16 });
  };

  const onConnect = useCallback(
    (c: Connection) => {
      const audioEdges = edges.filter((e) => !isVisualEdge(e));
      if (!isVisualEdge(c) && createsDelayFreeCycle(nodes, audioEdges, c.source, c.target)) {
        setToast({ text: 'That would create a feedback loop. Route it through a Delay module.', tone: 'error' });
        return;
      }
      setEdges((es) => addEdge(styleEdge({ ...c, id: `e-${uid()}` }), es));
    },
    [nodes, edges, setEdges],
  );

  const kindOf = useCallback((id: string) => nodes.find((n) => n.id === id)?.type, [nodes]);
  const isValidConnection: IsValidConnection = useCallback((c) => isAllowedLink(c, kindOf), [kindOf]);

  const onOpenFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const patch = parsePatchFile(JSON.parse(await file.text()));
      applyPatch(patch);
      setToast({ text: `Opened "${patch.name}"`, tone: 'ok' });
    } catch (err) {
      const text = err instanceof SyntaxError ? 'That file is not valid JSON.' : err instanceof Error ? err.message : 'Could not open that file.';
      setToast({ text, tone: 'error' });
    }
  };

  const onSave = () => {
    const patch = getPatch();
    downloadBlob(new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' }), `${slugify(patch.name)}.json`);
    setToast({ text: 'Patch saved to your downloads', tone: 'ok' });
  };

  return (
    <div className="h-full flex flex-col">
      <TopBar
        onHome={onHome}
        name={name}
        onRename={setName}
        seed={seed}
        onSeedChange={setSeed}
        onRandomizeSeed={() => setSeed(randomSeed())}
        status={audio.status}
        onStartAudio={audio.start}
        onTogglePause={audio.togglePause}
        starters={STARTER_PATCHES}
        onLoadStarter={applyPatch}
        onNew={() => applyPatch(EMPTY_PATCH)}
        onSave={onSave}
        onOpen={() => fileInput.current?.click()}
        onExport={() => setExportOpen(true)}
      />
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          void onOpenFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <div className="flex-1 flex min-h-0">
        <Palette onAdd={addAtCenter} locked={locked} />
        <div ref={wrapper} className="relative flex-1 min-w-0" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <MeterContext.Provider value={audio.meters}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              nodeTypes={nodeTypes}
              colorMode="dark"
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.2}
              maxZoom={2}
              snapToGrid
              snapGrid={[8, 8]}
              connectionRadius={22}
              deleteKeyCode={['Backspace', 'Delete']}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#1f262f" />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap
                className="!hidden lg:!block"
                pannable
                zoomable
                maskColor="rgba(9, 11, 14, 0.7)"
                nodeColor={(n) => CATEGORY_STYLE[NODE_DEFS[n.type as NodeKind]?.category ?? 'processor'].accent}
                nodeBorderRadius={3}
              />
            </ReactFlow>
          </MeterContext.Provider>

          {visual.node && (
            <VisualPanel graph={visual} seed={seed} features={audio.features} look={look} onExport={() => setVideoOpen(true)} />
          )}

          {(audio.status === 'off' || audio.status === 'error') && (
            <div className="animate-fade-up pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
              <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850/95 backdrop-blur pl-4 pr-2 py-2 shadow-2xl">
                <span className="text-[12px] text-ink-300">
                  {audio.status === 'error'
                    ? audio.error
                    : 'Audio is off. Browsers need a click before sound can play.'}
                </span>
                <button
                  type="button"
                  onClick={audio.start}
                  className="inline-flex items-center gap-1.5 h-7 px-3 rounded bg-amber-400 text-ink-950 text-[11.5px] font-semibold hover:bg-amber-300 transition-colors"
                >
                  <Power size={12} strokeWidth={2.5} /> Start audio
                </button>
              </div>
            </div>
          )}

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-[12px] text-ink-400">
              Drag modules from the left to start patching.
            </div>
          )}

          {toast && (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
              <div
                className={`animate-fade-up rounded-md border px-3 py-1.5 text-[12px] shadow-xl ${
                  toast.tone === 'ok'
                    ? 'border-emerald-500/30 bg-ink-850 text-emerald-300'
                    : 'border-rose-500/40 bg-ink-850 text-rose-300'
                }`}
              >
                {toast.text}
              </div>
            </div>
          )}
        </div>
      </div>
      <MobilePalette onAdd={addAtCenter} locked={locked} />

      {exportOpen && <ExportDialog getPatch={getPatch} onClose={() => setExportOpen(false)} />}
      {videoOpen && <VideoExportDialog getPatch={getPatch} onClose={() => setVideoOpen(false)} />}
    </div>
  );
}
