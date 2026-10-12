import type { Category } from '@/patch/definitions';

export const CATEGORY_STYLE: Record<Category, { accent: string; text: string; bar: string; label: string }> = {
  source: { accent: '#fbbf24', text: 'text-amber-300', bar: 'bg-amber-400', label: 'Sources' },
  processor: { accent: '#38bdf8', text: 'text-sky-300', bar: 'bg-sky-400', label: 'Processors' },
  modulator: { accent: '#a3c94a', text: 'text-lime-300', bar: 'bg-lime-400', label: 'Modulators' },
  output: { accent: '#fb7185', text: 'text-rose-300', bar: 'bg-rose-400', label: 'Output' },
};
