import { useRef } from 'react';
import { useAnimationFrame, useMeterSource } from '@/hooks/meterContext';

const W = 44;
const H = 6;

export function LevelMeter({ nodeId }: { nodeId: string }) {
  const source = useMeterSource();
  const canvas = useRef<HTMLCanvasElement>(null);
  const smooth = useRef(0);
  const hold = useRef({ value: 0, at: 0 });

  useAnimationFrame(() => {
    const c = canvas.current?.getContext('2d');
    if (!c || !source) return;
    const peak = source.getLevel(nodeId);
    const db = 20 * Math.log10(Math.max(peak, 1e-6));
    const target = Math.min(1, Math.max(0, (db + 60) / 60));
    smooth.current = target > smooth.current ? target : smooth.current * 0.9 + target * 0.1;
    const now = performance.now();
    if (target >= hold.current.value || now - hold.current.at > 900) hold.current = { value: target, at: now };

    c.clearRect(0, 0, W, H);
    c.fillStyle = '#1d232b';
    c.fillRect(0, 0, W, H);
    const width = smooth.current * W;
    const grad = c.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#4ade80');
    grad.addColorStop(0.7, '#facc15');
    grad.addColorStop(0.95, '#f87171');
    c.fillStyle = grad;
    c.fillRect(0, 0, width, H);
    c.fillStyle = hold.current.value > 0.95 ? '#f87171' : '#e5e7eb';
    c.fillRect(Math.min(W - 1, hold.current.value * W), 0, 1, H);
  }, !!source);

  return (
    <canvas
      ref={canvas}
      width={W}
      height={H}
      className="rounded-[1px] bg-ink-800"
      style={{ width: W, height: H, opacity: source ? 1 : 0.35 }}
      title="Output level"
    />
  );
}
