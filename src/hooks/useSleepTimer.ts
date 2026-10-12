import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioOutput } from '@/audio/output';

export const SLEEP_MINUTES = [15, 30, 60, 90] as const;
export type SleepMinutes = (typeof SLEEP_MINUTES)[number];

const FADE_SECONDS = 60;
const CHECK_MS = 1000;

/**
 * Fades the output to silence over the last minute of the chosen playing time, then calls
 * `onExpire`. Paused time does not count, since the audio clock stops with playback.
 */
export function useSleepTimer(output: AudioOutput, onExpire: () => Promise<void> | void) {
  const [minutes, setMinutes] = useState<SleepMinutes | null>(null);
  const endsAt = useRef<number | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const set = useCallback(
    (m: SleepMinutes | null) => {
      setMinutes(m);
      if (m === null) {
        endsAt.current = null;
        output.restoreLevel();
        return;
      }
      const end = output.ctx.currentTime + m * 60;
      endsAt.current = end;
      output.scheduleFadeOut(end, FADE_SECONDS);
    },
    [output],
  );

  useEffect(() => {
    if (minutes === null) return;
    const timer = setInterval(() => {
      const end = endsAt.current;
      if (end === null || output.ctx.currentTime < end) return;
      endsAt.current = null;
      setMinutes(null);
      void Promise.resolve(onExpireRef.current()).then(() => output.restoreLevel());
    }, CHECK_MS);
    return () => clearInterval(timer);
  }, [minutes, output]);

  /** Seconds of playing time left, or null when the timer is off. */
  const remaining = useCallback(
    () => (endsAt.current === null ? null : Math.max(0, endsAt.current - output.ctx.currentTime)),
    [output],
  );

  return { minutes, set, remaining, fading: () => (remaining() ?? Infinity) <= FADE_SECONDS };
}
