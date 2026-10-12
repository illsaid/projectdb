import { useCallback, useEffect, useRef, useState } from 'react';
import { VISUAL_PREVIEW } from '@/drift/gate';
import { applyCard, type DriftCard } from '@/drift/cards';
import { driftHash } from '@/drift/link';
import { freshSeed } from '@/drift/pick';
import { DriftCancelled, resolveDrift, type Drift, type DriftRequest, type ResolveProgress } from '@/drift/resolve';
import type { DriftStore } from '@/drift/store';
import { NO_LOCKS, type Locks } from '@/drift/traits';
import { VisualRenderer } from '@/visual/renderer';

export type DriftProgress = ResolveProgress | { stage: 'seed' };

export function progressText(p: DriftProgress): string {
  if (p.stage === 'seed') return 'Finding a seed';
  const what = p.stage === 'sound' ? 'Listening' : 'Looking';
  return p.attempt === 0 ? `${what}…` : `${what} · try ${p.attempt + 1}`;
}

/** An off-screen renderer for the visual quality gate, or null where OffscreenCanvas/WebGL2 is missing. */
export function createGate(): VisualRenderer | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    return new VisualRenderer(new OffscreenCanvas(VISUAL_PREVIEW.width, VISUAL_PREVIEW.height));
  } catch {
    return null;
  }
}

/** Finds, quality-checks and holds the current drift; mirrors it into the URL hash. */
export function useDrift(store: DriftStore | null) {
  const [drift, setDrift] = useState<Drift | null>(null);
  const [progress, setProgress] = useState<DriftProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Drift | null>(null);
  const gate = useRef<VisualRenderer | null | undefined>(undefined);
  const pending = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      pending.current?.abort();
      gate.current?.release();
      gate.current = undefined;
    },
    [],
  );

  const run = useCallback(
    async (request: () => Promise<DriftRequest>) => {
      pending.current?.abort();
      const ctrl = new AbortController();
      pending.current = ctrl;
      setError(null);
      setProgress({ stage: 'seed' });
      try {
        const req = await request();
        if (ctrl.signal.aborted) return;
        if (gate.current === undefined) gate.current = createGate();
        const found = await resolveDrift(req, gate.current, (p) => !ctrl.signal.aborted && setProgress(p), ctrl.signal);
        if (ctrl.signal.aborted) return;
        current.current = found;
        setDrift(found);
        history.replaceState(null, '', driftHash(found.id));
        if (store) {
          await Promise.all([store.markSeen(req.seed), store.markSeen(req.visualSeed)]).catch(() => {
            // history is a nicety; a failed write only risks hearing this seed again
          });
        }
      } catch (err) {
        if (err instanceof DriftCancelled || ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not generate a drift.');
      } finally {
        if (pending.current === ctrl) {
          pending.current = null;
          setProgress(null);
        }
      }
    },
    [store],
  );

  const next = useCallback(
    (locks: Locks) =>
      run(async () => {
        const prev = current.current;
        if (prev && locks.hold === 'sound') {
          const visualSeed = await freshSeed(store, { ...NO_LOCKS, brightness: locks.brightness });
          return { seed: prev.id.seed, attempt: prev.id.attempt, visualSeed };
        }
        const seed = await freshSeed(store, locks);
        if (prev && locks.hold === 'visual') {
          return { seed, visualSeed: prev.id.visualSeed };
        }
        return { seed, visualSeed: seed };
      }),
    [run, store],
  );

  const load = useCallback((req: DriftRequest) => run(async () => req), [run]);

  const cancel = useCallback(() => pending.current?.abort(), []);

  /** Applies a drawn card to the current drift in place and records it in the drift's id and link. */
  const play = useCallback((card: DriftCard) => {
    const prev = current.current;
    if (!prev || pending.current) return;
    const held = prev.id.cards ?? [];
    const found: Drift = { ...prev, id: { ...prev.id, cards: [...held, card.id] }, patch: applyCard(prev.patch, card.id, held.length) };
    current.current = found;
    setDrift(found);
    history.replaceState(null, '', driftHash(found.id));
  }, []);

  return { drift, progress, error, next, load, cancel, play };
}
