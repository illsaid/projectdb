import type { FeatureMap } from '@/audio/features';
import { NEUTRAL_LOOK } from '@/audio/form';
import type { VisualGraph } from '@/patch/io';
import type { SeedHex } from '@/patch/types';
import { VisualRenderer } from './renderer';
import { createVisualState, stepVisual, visualSeedOf } from './step';

const SETTLE_SECONDS = 6;
const STEP = 1 / 30;
const SILENCE: FeatureMap = new Map();

/** Reusable square offscreen renderer for stills; null where OffscreenCanvas or WebGL2 is missing. */
export function createStillRenderer(size: number): { renderer: VisualRenderer; canvas: OffscreenCanvas } | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const canvas = new OffscreenCanvas(size, size);
    return { renderer: new VisualRenderer(canvas), canvas };
  } catch {
    return null;
  }
}

/** A deterministic PNG of the visual a few seconds in, with the sound treated as silence. */
export async function renderStill(
  target: { renderer: VisualRenderer; canvas: OffscreenCanvas },
  graph: VisualGraph,
  patchSeed: SeedHex,
): Promise<Blob | null> {
  const { node, links } = graph;
  if (!node) return null;
  const state = createVisualState(visualSeedOf(node.data, patchSeed));
  let frame = stepVisual(state, node.data, links, SILENCE, STEP, NEUTRAL_LOOK);
  for (let t = STEP; t < SETTLE_SECONDS; t += STEP) frame = stepVisual(state, node.data, links, SILENCE, STEP, NEUTRAL_LOOK);
  const { canvas, renderer } = target;
  renderer.render(frame, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/png' });
}
