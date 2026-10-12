import { useCallback, useMemo, useRef, useState } from 'react';
import type { Deck } from '@/audio/endless';
import type { Drift } from '@/drift/resolve';
import { useFormLook } from '@/hooks/useFormLook';
import { useVisualCanvas } from '@/hooks/useVisualCanvas';
import { toVisualGraph } from '@/patch/io';

interface Props {
  deck: Deck;
  drift: Drift;
  /** Seconds this deck's picture takes to fade in over the one beneath it. */
  fade: number;
  paused: boolean;
}

/** One deck's full-screen visual, fed by that deck's own audio features. */
export function EndlessDeck({ deck, drift, fade, paused }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [duration] = useState(fade);
  const graph = useMemo(() => toVisualGraph(drift.patch), [drift]);
  const position = useCallback(() => deck.player.position(), [deck]);
  const look = useFormLook(drift.patch.form, position);
  const error = useVisualCanvas(canvas, graph, drift.patch.seed, paused ? null : deck.features, true, 1.5, look);

  return (
    <>
      <canvas
        ref={canvas}
        aria-hidden
        className="absolute inset-0 h-full w-full"
        style={{ animation: `fade-in ${duration}s ease-in-out both`, animationPlayState: paused ? 'paused' : 'running' }}
      />
      {error && (
        <div className="absolute bottom-3 left-3 z-20 max-w-xs rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-[11px] leading-relaxed text-white/70 backdrop-blur">
          Visuals are unavailable in this browser. The sound still plays.
        </div>
      )}
    </>
  );
}
