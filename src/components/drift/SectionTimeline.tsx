import { useRef, useState } from 'react';
import type { Form, FormPosition } from '@/audio/form';
import { useAnimationFrame } from '@/hooks/meterContext';

interface Props {
  form: Form;
  position(): FormPosition | null;
  active: boolean;
}

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function SectionTimeline({ form, position, active }: Props) {
  const head = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const [current, setCurrent] = useState(-1);
  const currentRef = useRef(current);

  useAnimationFrame(() => {
    const pos = position();
    const t = pos ? Math.min(form.length, Math.max(0, pos.time)) : 0;
    if (head.current) {
      head.current.style.left = `${(t / form.length) * 100}%`;
      head.current.style.opacity = pos ? '1' : '0';
    }
    if (time.current) time.current.textContent = clock(t);
    let idx = -1;
    if (pos) form.sections.forEach((s, i) => t >= s.start && (idx = i));
    if (idx !== currentRef.current) {
      currentRef.current = idx;
      setCurrent(idx);
    }
  }, active);

  const fadeIn = (form.fadeIn / form.length) * 100;
  const fadeOut = (form.fadeOut / form.length) * 100;

  return (
    <div className="flex w-full max-w-sm items-center gap-3 font-mono text-[10px] tabular-nums text-white/50">
      <span ref={time} className="w-8 text-right">
        0:00
      </span>
      <div className="relative flex-1 py-1.5" title={`${form.sections.length} sections`}>
        <div
          className="flex h-[3px] gap-[3px]"
          style={{
            maskImage: `linear-gradient(to right, rgba(0,0,0,0.35), #000 ${fadeIn}%, #000 ${100 - fadeOut}%, rgba(0,0,0,0.35))`,
            WebkitMaskImage: `linear-gradient(to right, rgba(0,0,0,0.35), #000 ${fadeIn}%, #000 ${100 - fadeOut}%, rgba(0,0,0,0.35))`,
          }}
        >
          {form.sections.map((s, i) => (
            <div
              key={i}
              style={{ flexGrow: s.duration }}
              className={`basis-0 rounded-full transition-colors duration-700 ${
                i === current ? 'bg-amber-200/90' : i === form.peak ? 'bg-white/45' : 'bg-white/25'
              }`}
            />
          ))}
        </div>
        <div
          ref={head}
          className="pointer-events-none absolute top-0 h-full w-[2px] -translate-x-1/2 rounded-full bg-white opacity-0 shadow-[0_0_8px_rgba(255,255,255,0.8)]"
        />
      </div>
      <span className="w-8 text-left">{clock(form.length)}</span>
    </div>
  );
}
