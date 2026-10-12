import { useCallback, useEffect, useRef, useState } from 'react';
import { CROSSFADE_SECONDS, type Deck, type EndlessAudio } from '@/audio/endless';
import { freshSeed } from '@/drift/pick';
import { DriftCancelled, resolveDrift, type Drift } from '@/drift/resolve';
import type { DriftStore } from '@/drift/store';
import type { Locks } from '@/drift/traits';
import { audioOnly } from '@/patch/io';
import type { AudioGraph, PatchFile } from '@/patch/types';
import type { VisualRenderer } from '@/visual/renderer';
import { createGate } from './useDrift';

export const ENDLESS_MINUTES = [3, 5, 10] as const;
export type EndlessMinutes = (typeof ENDLESS_MINUTES)[number];

const CHECK_MS = 500;
const RETRY_MS = 15000;
const FIRST_FADE = 1.5;

export interface PlayingDeck {
  deck: Deck;
  drift: Drift;
}

const audioGraphOf = (patch: PatchFile): AudioGraph =>
  audioOnly({ seed: patch.seed, nodes: patch.nodes.map(({ id, type, data }) => ({ id, type, data })), edges: patch.edges, form: patch.form });

/**
 * Runs endless mode on an EndlessAudio session: plays the current drift, resolves the next one in
 * the background, and crossfades to it every `minutes` of playing time (or sooner on skip).
 */
export function useEndless(session: EndlessAudio, first: Drift | null, store: DriftStore | null, locks: Locks, minutes: EndlessMinutes) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [labels, setLabels] = useState<Map<number, Drift>>(() => new Map());
  const [current, setCurrent] = useState<Drift | null>(null);
  const [nextReady, setNextReady] = useState(false);
  const [skipQueued, setSkipQueued] = useState(false);
  const [paused, setPausedState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = useRef<Drift | null>(null);
  const skip = useRef(false);
  const lastSwitch = useRef(0);
  const minutesRef = useRef(minutes);
  minutesRef.current = minutes;
  const locksRef = useRef(locks);
  locksRef.current = locks;
  const gate = useRef<VisualRenderer | null | undefined>(undefined);
  const preparing = useRef(false);
  const started = useRef(false);
  const abort = useRef(new AbortController());

  useEffect(() => session.subscribe(setDecks), [session]);

  useEffect(() => {
    setLabels((prev) => {
      const kept = [...prev].filter(([id]) => decks.some((d) => d.id === id));
      return kept.length === prev.size ? prev : new Map(kept);
    });
  }, [decks]);

  const play = useCallback(
    (drift: Drift, fade: number) => {
      const deck = session.play(audioGraphOf(drift.patch), fade);
      setLabels((prev) => new Map(prev).set(deck.id, drift));
      setCurrent(drift);
      lastSwitch.current = session.ctx.currentTime;
    },
    [session],
  );

  const prepare = useCallback(async () => {
    if (preparing.current || next.current) return;
    preparing.current = true;
    const { signal } = abort.current;
    if (signal.aborted) {
      preparing.current = false;
      return;
    }
    try {
      const seed = await freshSeed(store, locksRef.current);
      if (gate.current === undefined) gate.current = createGate();
      const found = await resolveDrift({ seed, visualSeed: seed }, gate.current, undefined, signal);
      if (signal.aborted) return;
      next.current = found;
      setNextReady(true);
      setError(null);
      await store?.markSeen(seed).catch(() => undefined);
    } catch (err) {
      if (err instanceof DriftCancelled || signal.aborted) return;
      setError('The next drift could not be prepared. Retrying shortly.');
      setTimeout(() => void prepare(), RETRY_MS);
    } finally {
      if (abort.current.signal === signal) preparing.current = false;
    }
  }, [store]);

  const advance = useCallback(() => {
    const drift = next.current;
    if (!drift) return;
    next.current = null;
    skip.current = false;
    setNextReady(false);
    setSkipQueued(false);
    play(drift, session.live ? CROSSFADE_SECONDS : FIRST_FADE);
    void prepare();
  }, [play, prepare, session]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (first) {
      play(first, FIRST_FADE);
    } else {
      skip.current = true;
      setSkipQueued(true);
    }
  }, [first, play]);

  useEffect(() => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    preparing.current = false;
    void prepareRef.current();
    const timer = setInterval(() => {
      if (session.paused || !next.current) return;
      const due = session.ctx.currentTime >= lastSwitch.current + minutesRef.current * 60;
      if (skip.current || due) advanceRef.current();
    }, CHECK_MS);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, [session]);

  useEffect(
    () => () => {
      gate.current?.release();
      gate.current = undefined;
    },
    [],
  );

  const skipNow = useCallback(() => {
    if (next.current && !session.paused) {
      advanceRef.current();
      return;
    }
    skip.current = true;
    setSkipQueued(true);
  }, [session]);

  const togglePause = useCallback(async () => {
    const pause = !session.paused;
    await session.setPaused(pause);
    setPausedState(pause);
  }, [session]);

  /** Seconds of playing time until the next crossfade. */
  const remaining = useCallback(
    () => Math.max(0, lastSwitch.current + minutesRef.current * 60 - session.ctx.currentTime),
    [session],
  );

  const playing: PlayingDeck[] = decks.flatMap((deck) => {
    const drift = labels.get(deck.id);
    return drift ? [{ deck, drift }] : [];
  });

  return { playing, current, nextReady, skipQueued, paused, error, skip: skipNow, togglePause, remaining };
}
