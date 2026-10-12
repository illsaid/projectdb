import { useCallback, useEffect, useState } from 'react';
import { clockOf, type HoursSetting } from '@/drift/hours';

const HOURS_KEY = 'driftbox.hours';
const TICK_MS = 2000;
/** Switching Hours on or off blends in over this long, so nothing jumps. */
const RAMP_SECONDS = 180;
const STEP = TICK_MS / 1000 / RAMP_SECONDS;

const stored = () => localStorage.getItem(HOURS_KEY) === '1';

/** The Hours option and the clock it follows; `setting` is null while Hours has no effect. */
export function useHours() {
  const [on, setOn] = useState(stored);
  const [setting, setSetting] = useState<HoursSetting>(() => ({ clock: clockOf(new Date()), amount: stored() ? 1 : 0 }));

  useEffect(() => {
    localStorage.setItem(HOURS_KEY, on ? '1' : '0');
    const target = on ? 1 : 0;
    const tick = () =>
      setSetting((prev) => {
        const moved = prev.amount < target ? Math.min(target, prev.amount + STEP) : Math.max(target, prev.amount - STEP);
        const amount = Number(moved.toFixed(3));
        const clock = clockOf(new Date());
        return amount === prev.amount && clock === prev.clock ? prev : { clock, amount };
      });
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [on]);

  const toggle = useCallback(() => setOn((v) => !v), []);

  return { on, toggle, setting: setting.amount > 0 ? setting : null };
}
