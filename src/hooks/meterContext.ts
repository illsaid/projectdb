import { createContext, useContext, useEffect, useRef } from 'react';

export interface MeterSource {
  getLevel(id: string): number;
  getWaveform(id: string, out: Float32Array): boolean;
}

export const MeterContext = createContext<MeterSource | null>(null);

export const useMeterSource = () => useContext(MeterContext);

export function useAnimationFrame(callback: () => void, active: boolean) {
  const cb = useRef(callback);
  cb.current = callback;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      cb.current();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}
