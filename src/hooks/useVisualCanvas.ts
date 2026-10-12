import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { FeatureBus } from '@/audio/featureBus';
import type { FeatureMap } from '@/audio/features';
import { NEUTRAL_LOOK, type SectionLook } from '@/audio/form';
import type { VisualGraph } from '@/patch/io';
import type { SeedHex } from '@/patch/types';
import { VisualRenderer } from '@/visual/renderer';
import { createVisualState, stepVisual, visualSeedOf, type VisualState } from '@/visual/step';

const MAX_DPR = 2;
const MIN_SCALE = 0.5;
const SCALE_STEP_DOWN = 0.1;
const SCALE_STEP_UP = 0.05;
const ADJUST_EVERY_MS = 1200;
/** Frame interval budgets; a refresh-rate jitter of a few ms is tolerated before skipping. */
const DESKTOP_BUDGET = 1000 / 60;
const MOBILE_BUDGET = 1000 / 30;
const CAP_SLACK_MS = 4;
const EMPTY: FeatureMap = new Map();
const neutral = () => NEUTRAL_LOOK;

/**
 * Drives a canvas with the visual graph, fed by live audio features when available.
 * Returns an error message if WebGL2 is unavailable or rendering fails.
 */
export function useVisualCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  graph: VisualGraph,
  patchSeed: SeedHex,
  features: FeatureBus | null,
  enabled = true,
  maxDpr = MAX_DPR,
  look: () => SectionLook = neutral,
): string | null {
  const graphRef = useRef(graph);
  const seedRef = useRef(patchSeed);
  const lookRef = useRef(look);
  const latest = useRef<FeatureMap>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    graphRef.current = graph;
    seedRef.current = patchSeed;
    lookRef.current = look;
  }, [graph, patchSeed, look]);

  useEffect(() => {
    if (!features) {
      latest.current = EMPTY;
      return;
    }
    const unsubscribe = features.subscribe((f) => {
      latest.current = f;
    });
    return () => {
      unsubscribe();
      latest.current = EMPTY;
    };
  }, [features]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    let renderer: VisualRenderer;
    try {
      renderer = new VisualRenderer(canvas);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Visuals could not start.');
      return;
    }
    setError(null);
    const mobile = window.matchMedia('(pointer: coarse)').matches;
    const budget = mobile ? MOBILE_BUDGET : DESKTOP_BUDGET;
    let state: VisualState | null = null;
    let stateSeed = '';
    let last = performance.now();
    let raf = 0;
    let scale = 1;
    let frameMs = budget;
    let lastAdjust = last;
    const onVisible = () => {
      if (document.hidden) return;
      last = lastAdjust = performance.now();
      frameMs = budget;
    };
    document.addEventListener('visibilitychange', onVisible);
    // Lost contexts (GPU reset, or Safari reclaiming one) come back only if the loss is prevented.
    const onLost = (e: Event) => e.preventDefault();
    const onRestored = () => {
      try {
        renderer = new VisualRenderer(canvas);
      } catch (err) {
        cancelAnimationFrame(raf);
        setError(err instanceof Error ? err.message : 'Visuals could not restart.');
      }
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    const adapt = (interval: number, now: number) => {
      frameMs += (interval - frameMs) * 0.1;
      if (now - lastAdjust < ADJUST_EVERY_MS) return;
      if (frameMs > budget * 1.25 && scale > MIN_SCALE) scale = Math.max(MIN_SCALE, scale - SCALE_STEP_DOWN);
      else if (frameMs < budget * 1.08 && scale < 1) scale = Math.min(1, scale + SCALE_STEP_UP);
      else return;
      lastAdjust = now;
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const interval = now - last;
      if (mobile && interval < MOBILE_BUDGET - CAP_SLACK_MS) return;
      const dt = Math.min(0.1, Math.max(0, interval / 1000));
      last = now;
      adapt(interval, now);
      const { node, links } = graphRef.current;
      if (!node) return;
      const seed = visualSeedOf(node.data, seedRef.current);
      if (!state || stateSeed !== seed) {
        stateSeed = seed;
        state = createVisualState(seed);
      }
      const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      try {
        renderer.render(stepVisual(state, node.data, links, latest.current, dt, lookRef.current()), w, h);
      } catch (err) {
        cancelAnimationFrame(raf);
        setError(err instanceof Error ? err.message : 'Visuals stopped unexpectedly.');
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisible);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      const done = renderer;
      done.dispose();
      // A canvas that stays mounted may get a new renderer (effects re-run); one that left the page
      // gives its context back now rather than whenever it is collected.
      setTimeout(() => {
        if (!canvas.isConnected) done.release();
      }, 0);
    };
  }, [canvasRef, enabled, maxDpr]);

  return error;
}
