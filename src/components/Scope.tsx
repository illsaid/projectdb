import { useEffect, useRef } from 'react';
import { useAnimationFrame, useMeterSource } from '@/hooks/meterContext';

const WINDOW = 1024;

interface Props {
  nodeId: string;
  width?: number;
  height?: number;
  /** Transparent, gridless trace for floating over visuals. */
  bare?: boolean;
}

export function Scope({ nodeId, width: W = 232, height: H = 76, bare = false }: Props) {
  const source = useMeterSource();
  const canvas = useRef<HTMLCanvasElement>(null);
  const buf = useRef(new Float32Array(2048));
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;

  const drawGrid = (c: CanvasRenderingContext2D) => {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (bare) {
      c.clearRect(0, 0, W, H);
      c.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, H / 2 + 0.5);
      c.lineTo(W, H / 2 + 0.5);
      c.stroke();
      return;
    }
    c.fillStyle = '#0a0d10';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = '#1a2028';
    c.lineWidth = 1;
    for (let x = 0; x <= W; x += W / 8) {
      c.beginPath();
      c.moveTo(Math.round(x) + 0.5, 0);
      c.lineTo(Math.round(x) + 0.5, H);
      c.stroke();
    }
    c.strokeStyle = '#232b35';
    c.beginPath();
    c.moveTo(0, H / 2 + 0.5);
    c.lineTo(W, H / 2 + 0.5);
    c.stroke();
  };

  useEffect(() => {
    const c = canvas.current?.getContext('2d');
    if (c) drawGrid(c);
  });

  useAnimationFrame(() => {
    const c = canvas.current?.getContext('2d');
    if (!c || !source || !source.getWaveform(nodeId, buf.current)) return;
    const data = buf.current;
    let start = 0;
    for (let i = 1; i < data.length - WINDOW; i++) {
      if (data[i - 1] < 0 && data[i] >= 0) {
        start = i;
        break;
      }
    }
    drawGrid(c);
    c.strokeStyle = bare ? 'rgba(255, 255, 255, 0.85)' : '#fb7185';
    c.lineWidth = bare ? 1.5 : 1.25;
    c.shadowColor = bare ? 'rgba(255, 255, 255, 0.5)' : 'rgba(251, 113, 133, 0.6)';
    c.shadowBlur = 6;
    c.beginPath();
    for (let x = 0; x < W; x++) {
      const v = data[start + Math.floor((x / W) * WINDOW)];
      const y = H / 2 - v * (H / 2 - 4);
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.shadowBlur = 0;
  }, !!source);

  return (
    <canvas
      ref={canvas}
      width={W * dpr}
      height={H * dpr}
      style={{ width: W, height: H }}
      className={bare ? 'block' : 'block rounded border border-ink-700'}
    />
  );
}
