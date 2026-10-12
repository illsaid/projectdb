import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormPosition } from '@/audio/form';
import { startLiveAudio, type LiveAudio } from '@/audio/liveAudio';
import type { AudioGraph } from '@/patch/types';

export type AudioStatus = 'off' | 'starting' | 'running' | 'paused' | 'error';

/** Keeps the live audio engine in sync with the patch graph; the UI only edits the graph. */
export function useLiveAudio(graph: AudioGraph) {
  const [live, setLive] = useState<LiveAudio | null>(null);
  const [status, setStatus] = useState<AudioStatus>('off');
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);

  useEffect(() => {
    live?.reconcile(graph);
  }, [live, graph]);

  useEffect(() => () => live?.close(), [live]);

  const start = useCallback(async () => {
    if (live || starting.current) return;
    starting.current = true;
    setStatus('starting');
    setError(null);
    try {
      setLive(await startLiveAudio());
      setStatus('running');
    } catch (err) {
      setError(err instanceof Error && !(err instanceof DOMException) ? err.message : 'Your browser blocked audio. Try again.');
      setStatus('error');
    } finally {
      starting.current = false;
    }
  }, [live]);

  const togglePause = useCallback(async () => {
    if (!live) return;
    const pause = !live.output.paused;
    await live.output.setPaused(pause);
    setStatus(pause ? 'paused' : 'running');
  }, [live]);

  /** Current place in the looping form; read every frame by the timeline and visuals. */
  const formPosition = useCallback((): FormPosition | null => live?.player.position() ?? null, [live]);

  /** Seconds since playback (re)started, the clock plantings are timed against. */
  const elapsed = useCallback((): number | null => live?.player.elapsed() ?? null, [live]);

  const running = status === 'running';
  return {
    status,
    error,
    start,
    togglePause,
    formPosition,
    elapsed,
    meters: running ? live?.player ?? null : null,
    features: running ? live?.features ?? null : null,
  };
}
