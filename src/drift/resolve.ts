import type { Form } from '@/audio/form';
import { renderOffline } from '@/audio/offlineRender';
import { toVisualGraph } from '@/patch/io';
import type { PatchFile, SeedHex } from '@/patch/types';
import type { VisualRenderer } from '@/visual/renderer';
import {
  assessAudio,
  assessVisual,
  PREVIEW_SAMPLE_RATE,
  PREVIEW_SECONDS,
  requireEarlyNote,
  worse,
  type AudioReport,
  type PreviewWindow,
  type VisualReport,
} from './gate';
import { composePatch, soundFor, soundSeedOf, type DriftId, type SoundPlan } from './generate';
import { traitsFor, type Traits } from './traits';

export const MAX_ATTEMPTS = 8;
/** Warm-up rendered before the loudest-section window so delays and reverbs are already ringing. */
const PRE_ROLL = 1;

export interface Drift {
  id: DriftId;
  traits: Traits;
  look: Traits;
  patch: PatchFile;
  /** Null when the attempt was already known (shared link, library) and not re-checked. */
  audio: AudioReport | null;
  visual: VisualReport | null;
}

export interface DriftRequest {
  seed: SeedHex;
  visualSeed: SeedHex;
  /** Known passing attempts skip their quality gate. */
  attempt?: number;
  visualAttempt?: number;
  cards?: string[];
}

export interface ResolveProgress {
  stage: 'sound' | 'visual';
  attempt: number;
}

export class DriftCancelled extends Error {
  constructor() {
    super('Drift cancelled');
  }
}

/** Where the 4-second window inside the loudest section begins, or null if it would repeat the opening. */
function peakWindowStart(form: Form): number | null {
  const section = form.sections[form.peak];
  if (!section) return null;
  const latest = Math.max(0, form.length - form.fadeOut - PREVIEW_SECONDS);
  const start = Math.min(latest, Math.max(form.fadeIn, section.start + section.duration / 2 - PREVIEW_SECONDS / 2));
  return start < PREVIEW_SECONDS / 2 ? null : start;
}

/** Renders the opening and the loudest section. The master fade is left out: the gates judge content, not the fade-in. */
async function previews({ sound, form }: SoundPlan, seed: SeedHex): Promise<PreviewWindow[]> {
  const nodes = sound.nodes.map(({ id, type, data }) => ({ id, type, data }));
  const ids = nodes.map((n) => n.id);
  const graph = { seed, nodes, edges: sound.edges, form: { ...form, lanes: form.lanes.filter((l) => l.key !== 'fade') } };
  const opening = await renderOffline(graph, PREVIEW_SECONDS, PREVIEW_SAMPLE_RATE, ids);
  const windows: PreviewWindow[] = [{ ...opening, skip: 0, formStart: 0 }];
  const peak = peakWindowStart(form);
  if (peak !== null) {
    const pre = Math.min(PRE_ROLL, peak);
    const loud = await renderOffline(graph, PREVIEW_SECONDS + pre, PREVIEW_SAMPLE_RATE, ids, peak - pre);
    windows.push({ ...loud, skip: pre, formStart: peak - pre });
  }
  return windows;
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

/**
 * Finds the first attempt of each seed that passes its quality gate (or the best one if none do),
 * so the resulting DriftId rebuilds the exact same drift later.
 */
export async function resolveDrift(
  req: DriftRequest,
  gate: VisualRenderer | null,
  onProgress: (p: ResolveProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<Drift> {
  const check = () => {
    if (signal?.aborted) throw new DriftCancelled();
  };

  type Candidate = { attempt: number; plan: SoundPlan; windows: PreviewWindow[] | null; report: AudioReport | null };
  let chosen: Candidate;
  if (req.attempt !== undefined) {
    chosen = { attempt: req.attempt, plan: soundFor({ seed: req.seed, attempt: req.attempt }), windows: null, report: null };
  } else {
    let best: Candidate | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      check();
      onProgress({ stage: 'sound', attempt });
      const plan = soundFor({ seed: req.seed, attempt });
      const windows = await previews(plan, soundSeedOf({ seed: req.seed, attempt }));
      const heard = windows.map(assessAudio).reduce(worse);
      const report = plan.traits.archetype === 'airports' ? requireEarlyNote(heard, plan.sound.nodes, plan.form) : heard;
      const candidate = { attempt, plan, windows, report };
      if (report.verdict === 'ok') {
        best = candidate;
        break;
      }
      if (!best || report.score < (best.report?.score ?? Infinity)) best = candidate;
    }
    chosen = best!;
  }
  check();

  const idFor = (visualAttempt: number): DriftId => ({
    seed: req.seed,
    attempt: chosen.attempt,
    visualSeed: req.visualSeed,
    visualAttempt,
    ...(req.cards?.length ? { cards: req.cards } : {}),
  });
  const look = traitsFor(req.visualSeed);
  const result = (id: DriftId, patch: PatchFile, visual: VisualReport | null): Drift => ({
    id,
    traits: chosen.plan.traits,
    look,
    patch,
    audio: chosen.report,
    visual,
  });

  if (req.visualAttempt !== undefined || !gate) {
    const id = idFor(req.visualAttempt ?? 0);
    return result(id, composePatch(id, chosen.plan), null);
  }

  const first = composePatch(idFor(0), chosen.plan);
  const windows = chosen.windows ?? (await previews(chosen.plan, first.seed));
  let best: Drift | null = null;
  for (let visualAttempt = 0; visualAttempt < MAX_ATTEMPTS; visualAttempt++) {
    check();
    onProgress({ stage: 'visual', attempt: visualAttempt });
    await yieldToUi();
    const id = idFor(visualAttempt);
    const patch = visualAttempt === 0 ? first : composePatch(id, chosen.plan);
    const graph = toVisualGraph(patch);
    const report = windows.map((w) => assessVisual(gate, graph, patch.seed, w, chosen.plan.form)).reduce(worse);
    const candidate = result(id, patch, report);
    if (report.verdict === 'ok') return candidate;
    if (!best || report.score < best.visual!.score) best = candidate;
  }
  return best!;
}
