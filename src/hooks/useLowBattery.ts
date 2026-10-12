import { useEffect, useRef } from 'react';

const LOW_LEVEL = 0.2;

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
}

type WithBattery = Navigator & { getBattery?: () => Promise<BatteryManager> };

/** Calls `onLow` once per visit the first time the battery is below 20% and not charging. */
export function useLowBattery(onLow: () => void) {
  const onLowRef = useRef(onLow);
  onLowRef.current = onLow;

  useEffect(() => {
    const getBattery = (navigator as WithBattery).getBattery;
    if (!getBattery) return;
    let battery: BatteryManager | null = null;
    let fired = false;
    let alive = true;
    const check = () => {
      if (fired || !battery || battery.charging || battery.level >= LOW_LEVEL) return;
      fired = true;
      onLowRef.current();
    };
    getBattery
      .call(navigator)
      .then((b) => {
        if (!alive) return;
        battery = b;
        b.addEventListener('levelchange', check);
        b.addEventListener('chargingchange', check);
        check();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      battery?.removeEventListener('levelchange', check);
      battery?.removeEventListener('chargingchange', check);
    };
  }, []);
}
