import { formatPhrase, loopSpec } from '@/audio/loops';
import { between, pick, rngFor, type Rng } from '@/audio/random';
import { NODE_DEFS, num, str, VOWELS } from '@/patch/definitions';
import type { NodeData, NodeKind, PatchFile } from '@/patch/types';
import { mapPalette } from '@/visual/color';
import { PRESET_CHOICE, VISUAL_INPUTS, VISUAL_INPUT_KEYS, envKey } from '@/visual/inputs';
import type { DriftId } from './generate';

type PatchNode = PatchFile['nodes'][number];

export interface DriftCard {
  id: string;
  text: string;
  applies(patch: PatchFile): boolean;
  apply(patch: PatchFile, rng: Rng): PatchFile;
}

const VOICE_KINDS: NodeKind[] = ['oscillator', 'noise', 'fm', 'loopVoice'];
const PITCHED_KINDS: NodeKind[] = ['oscillator', 'fm', 'loopVoice'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const specOf = (type: NodeKind, key: string) => (type === 'visual' ? VISUAL_INPUTS : NODE_DEFS[type].params).find((p) => p.key === key);

/** Node data with numeric param `key` changed by fn, clamped to the param's range (and `cap`, if tighter). */
function tweak(node: PatchNode, key: string, fn: (v: number) => number, cap = Infinity): NodeData {
  const spec = specOf(node.type, key);
  const lo = spec?.min ?? 0;
  const hi = Math.min(spec?.max ?? 1, cap);
  return { ...node.data, [key]: clamp(fn(num(node.data, key, spec?.default ?? 0)), lo, hi) };
}

const withData = (node: PatchNode, data: NodeData): PatchNode => ({ ...node, data });
const level = (n: PatchNode) => num(n.data, 'level', 0.3);
const audible = (p: PatchFile) => p.nodes.filter((n) => VOICE_KINDS.includes(n.type) && level(n) > 0);
const loops = (p: PatchFile) => p.nodes.filter((n) => n.type === 'loopVoice' && level(n) > 0);
const pitched = (p: PatchFile) => p.nodes.filter((n) => PITCHED_KINDS.includes(n.type) && level(n) > 0);
const has = (...kinds: NodeKind[]) => (p: PatchFile) => p.nodes.some((n) => kinds.includes(n.type));

/** The patch with fn applied to every node of the given kinds. */
function each(patch: PatchFile, kinds: NodeKind[], fn: (n: PatchNode) => PatchNode): PatchFile {
  return { ...patch, nodes: patch.nodes.map((n) => (kinds.includes(n.type) ? fn(n) : n)) };
}

function one(patch: PatchFile, target: PatchNode | undefined, fn: (n: PatchNode) => PatchNode): PatchFile {
  if (!target) return patch;
  return { ...patch, nodes: patch.nodes.map((n) => (n.id === target.id ? fn(n) : n)) };
}

const highest = <T>(items: T[], score: (t: T) => number) => items.reduce<T | undefined>((a, b) => (a === undefined || score(b) > score(a) ? b : a), undefined);
const lowest = <T>(items: T[], score: (t: T) => number) => highest(items, (t) => -score(t));
const pitchOf = (n: PatchNode) => num(n.data, 'frequency', specOf(n.type, 'frequency')?.default ?? 220);
const transpose = (n: PatchNode, f: number) => withData(n, tweak(n, 'frequency', (v) => v * f));

const WAVE_BRIGHTNESS: Record<string, number> = { sawtooth: 3, square: 2.5, triangle: 1, sine: 0 };
const TIMBRE_BRIGHTNESS: Record<string, number> = { breath: 2, bell: 2.2, pad: 1.5, sine: 0 };

function brightnessOf(n: PatchNode): number {
  switch (n.type) {
    case 'oscillator':
      return WAVE_BRIGHTNESS[str(n.data, 'wave', 'sawtooth')] ?? 0;
    case 'loopVoice':
      return TIMBRE_BRIGHTNESS[str(n.data, 'timbre', 'sine')] ?? 0;
    case 'fm':
      return (num(n.data, 'index', 2) * num(n.data, 'ratio', 2)) / 4;
    default:
      return 0;
  }
}

function toSine(n: PatchNode): PatchNode {
  if (n.type === 'oscillator') return withData(n, { ...n.data, wave: 'sine' });
  if (n.type === 'loopVoice') return withData(n, { ...n.data, timbre: 'sine' });
  return withData(n, { ...n.data, index: 0 });
}

const look = (patch: PatchFile, key: string, fn: (v: number) => number) =>
  each(patch, ['visual'], (n) => withData(n, tweak(n, key, fn)));
const palette = (patch: PatchFile, fn: Parameters<typeof mapPalette>[1]) =>
  each(patch, ['visual'], (n) => withData(n, mapPalette(n.data, fn)));

const card = (id: string, text: string, applies: DriftCard['applies'], apply: DriftCard['apply']): DriftCard => ({ id, text, applies, apply });

export const DRIFT_CARDS: DriftCard[] = [
  card('remove-loudest', 'Remove the loudest voice.', (p) => audible(p).length > 1, (p) =>
    one(p, highest(audible(p), level), (n) => withData(n, { ...n.data, level: 0 })),
  ),
  card('octave-down', 'Everything an octave lower.', (p) => pitched(p).length > 0, (p) => each(p, PITCHED_KINDS, (n) => transpose(n, 0.5))),
  card('lengthen-cycles', 'Lengthen every cycle by half.', has('loopVoice', 'lfo', 'randomWalk'), (p) =>
    each(p, ['loopVoice', 'lfo', 'randomWalk'], (n) =>
      withData(n, n.type === 'loopVoice' ? tweak(n, 'cycle', (v) => v * 1.5) : tweak(n, 'rate', (v) => v / 1.5)),
    ),
  ),
  card('silence-loop', 'Let one loop fall silent.', (p) => loops(p).length > 0 && audible(p).length > 1, (p, rng) =>
    one(p, pick(rng, loops(p)), (n) => withData(n, { ...n.data, level: 0 })),
  ),
  card('brightest-sine', 'Replace the brightest timbre with sine.', (p) => pitched(p).some((n) => brightnessOf(n) > 0), (p) =>
    one(p, highest(pitched(p).filter((n) => brightnessOf(n) > 0), brightnessOf), toSine),
  ),
  card('double-reverb', 'Double the reverb.', has('reverb'), (p) =>
    each(p, ['reverb'], (n) => withData(n, { ...tweak(n, 'mix', (v) => v * 2), decay: tweak(n, 'decay', (v) => v * 2).decay })),
  ),
  card('monochrome', 'Take the visual to monochrome.', has('visual'), (p) => palette(p, (c) => ({ ...c, s: 0 }))),
  card('dry', 'Take the room away; leave it dry.', has('reverb'), (p) => each(p, ['reverb'], (n) => withData(n, tweak(n, 'mix', (v) => v * 0.25)))),
  card('fewer-strikes', 'Strike half as often.', has('fm'), (p) => each(p, ['fm'], (n) => withData(n, tweak(n, 'density', (v) => v * 0.5)))),
  card('more-strikes', 'Let the strikes crowd in.', has('fm'), (p) => each(p, ['fm'], (n) => withData(n, tweak(n, 'density', (v) => v * 2, 2)))),
  card('ring-longer', 'Let every strike ring twice as long.', has('fm'), (p) => each(p, ['fm'], (n) => withData(n, tweak(n, 'decay', (v) => v * 2)))),
  card('close-filters', 'Close every filter by an octave.', has('filter'), (p) =>
    each(p, ['filter'], (n) => withData(n, tweak(n, 'frequency', (v) => (str(n.data, 'mode', 'lowpass') === 'highpass' ? v : v * 0.5)))),
  ),
  card('open-filters', 'Open the filters by an octave.', has('filter'), (p) =>
    each(p, ['filter'], (n) => withData(n, tweak(n, 'frequency', (v) => (str(n.data, 'mode', 'lowpass') === 'highpass' ? v * 0.5 : v * 2)))),
  ),
  card('resonance', 'Let the filters sing.', has('filter'), (p) => each(p, ['filter'], (n) => withData(n, tweak(n, 'q', (v) => Math.max(v * 2, 4), 8)))),
  card('stretch-echoes', 'Stretch the echoes.', has('delay', 'tapeEcho'), (p) => each(p, ['delay', 'tapeEcho'], (n) => withData(n, tweak(n, 'time', (v) => v * 1.5)))),
  card('linger-echoes', 'Let the echoes linger.', has('delay', 'tapeEcho'), (p) =>
    each(p, ['delay', 'tapeEcho'], (n) => withData(n, tweak(n, 'feedback', (v) => v + 0.15, n.type === 'tapeEcho' ? 0.92 : 0.85))),
  ),
  card('wear-tape', 'Wear the tape thin.', has('tapeEcho'), (p) =>
    each(p, ['tapeEcho'], (n) => withData(n, { ...tweak(n, 'wear', (v) => v + 0.4), tone: tweak(n, 'tone', (v) => v * 0.6).tone })),
  ),
  card('slow-movement', 'Halve the speed of every slow movement.', has('lfo', 'randomWalk'), (p) =>
    each(p, ['lfo', 'randomWalk'], (n) => withData(n, tweak(n, 'rate', (v) => v * 0.5))),
  ),
  card('deepen-movement', 'Deepen every modulation.', has('lfo', 'randomWalk'), (p) =>
    each(p, ['lfo', 'randomWalk'], (n) => withData(n, tweak(n, n.type === 'lfo' ? 'depth' : 'range', (v) => v * 1.5))),
  ),
  card('hold-still', 'Hold the modulators still.', has('lfo', 'randomWalk'), (p) =>
    each(p, ['lfo', 'randomWalk'], (n) => withData(n, tweak(n, n.type === 'lfo' ? 'depth' : 'range', (v) => v * 0.2))),
  ),
  card('out-of-tune', 'Pull one voice slightly out of tune.', has('oscillator', 'fm'), (p, rng) =>
    one(p, pick(rng, p.nodes.filter((n) => n.type === 'oscillator' || n.type === 'fm')), (n) =>
      withData(n, tweak(n, 'detune', (v) => v + (rng() < 0.5 ? -1 : 1) * between(rng, 8, 20))),
    ),
  ),
  card('up-a-fifth', 'Move one voice up a fifth.', (p) => pitched(p).length > 1, (p, rng) => one(p, pick(rng, pitched(p)), (n) => transpose(n, 1.5))),
  card('lowest-lower', 'Drop the lowest voice another octave.', (p) => pitched(p).some((n) => pitchOf(n) >= 80), (p) =>
    one(p, lowest(pitched(p).filter((n) => pitchOf(n) >= 80), pitchOf), (n) => transpose(n, 0.5)),
  ),
  card('highest-higher', 'Lift the highest voice an octave.', (p) => pitched(p).some((n) => pitchOf(n) <= 1000), (p) =>
    one(p, highest(pitched(p).filter((n) => pitchOf(n) <= 1000), pitchOf), (n) => transpose(n, 2)),
  ),
  card('quietest-forward', 'Bring the quietest voice forward.', (p) => audible(p).length > 1, (p) => {
    const loudest = Math.max(...audible(p).map(level));
    return one(p, lowest(audible(p), level), (n) => withData(n, tweak(n, 'level', (v) => Math.min(v * 2, loudest))));
  }),
  card('recede-noise', 'Let the noise recede.', has('noise'), (p) => each(p, ['noise'], (n) => withData(n, tweak(n, 'level', (v) => v * 0.4)))),
  card('pink-noise', 'Turn the white noise pink.', (p) => p.nodes.some((n) => n.type === 'noise' && str(n.data, 'color', 'white') === 'white'), (p) =>
    each(p, ['noise'], (n) => withData(n, { ...n.data, color: 'pink' })),
  ),
  card('spread-loops', 'Spread the loops wide.', (p) => loops(p).length > 1, (p) => {
    const ids = loops(p).map((n) => n.id);
    return each(p, ['loopVoice'], (n) => (ids.includes(n.id) ? withData(n, { ...n.data, pan: ids.indexOf(n.id) % 2 ? 0.75 : -0.75 }) : n));
  }),
  card('gather-loops', 'Gather every loop to the centre.', has('loopVoice'), (p) => each(p, ['loopVoice'], (n) => withData(n, tweak(n, 'pan', (v) => v * 0.2)))),
  card('soften-attacks', 'Soften every attack.', has('loopVoice'), (p) => each(p, ['loopVoice'], (n) => withData(n, tweak(n, 'attack', (v) => Math.max(v * 3, 0.8))))),
  card('slow-fades', 'Let every note fade twice as slowly.', has('loopVoice'), (p) => each(p, ['loopVoice'], (n) => withData(n, tweak(n, 'release', (v) => v * 2)))),
  card('first-note-only', 'Keep only the first note of each phrase.', (p) => loops(p).some((n) => loopSpec(n.data).notes.length > 1), (p) =>
    each(p, ['loopVoice'], (n) => withData(n, { ...n.data, phrase: formatPhrase(loopSpec(n.data).notes.slice(0, 1)) })),
  ),
  card('thicken-chorus', 'Thicken the chorus.', has('chorus'), (p) =>
    each(p, ['chorus'], (n) => withData(n, { ...tweak(n, 'depth', (v) => v * 1.6), mix: tweak(n, 'mix', (v) => v + 0.2).mix })),
  ),
  card('change-vowel', 'Change the vowel.', has('formant'), (p, rng) =>
    each(p, ['formant'], (n) => withData(n, { ...n.data, vowel: pick(rng, VOWELS.filter((v) => v !== str(n.data, 'vowel', 'a'))) })),
  ),
  card('crawl', 'Slow the picture to a crawl.', has('visual'), (p) => look(p, 'speed', (v) => v * 0.4)),
  card('grain', 'Add grain to the picture.', has('visual'), (p) => look(p, 'grain', (v) => v + 0.35)),
  card('bloom', 'Let the light bloom.', has('visual'), (p) => look(p, 'bloom', (v) => v + 0.3)),
  card('bend', 'Bend the picture further.', has('visual'), (p) => look(p, 'warp', (v) => v + 0.3)),
  card('opposite-colours', 'Turn the colours to their opposite.', has('visual'), (p) => palette(p, (c) => ({ ...c, h: c.h + 180 }))),
  card('dusk', 'Dim the picture to dusk.', has('visual'), (p) => palette(p, (c) => ({ ...c, s: c.s * 0.85, l: c.l * 0.7 }))),
  card('new-shape', 'Let the picture change its shape.', has('visual'), (p, rng) =>
    each(p, ['visual'], (n) => {
      const others = PRESET_CHOICE.options.map((o) => o.value).filter((v) => v !== str(n.data, 'preset', 'drift'));
      return withData(n, { ...n.data, preset: pick(rng, others) });
    }),
  ),
  card('ignore-sound', 'Let the picture stop listening.', has('visual'), (p) =>
    each(p, ['visual'], (n) => {
      const data = { ...n.data };
      for (const key of VISUAL_INPUT_KEYS) data[envKey(key, 'gain')] = num(n.data, envKey(key, 'gain'), 1) * 0.25;
      return withData(n, data);
    }),
  ),
];

const BY_ID = new Map(DRIFT_CARDS.map((c) => [c.id, c]));

export const isCardId = (id: string) => BY_ID.has(id);
export const cardText = (id: string) => BY_ID.get(id)?.text ?? '';

/** The patch with one card applied as the index-th of its drift; its randomness comes from the seed and that place. */
export function applyCard(patch: PatchFile, id: string, index: number): PatchFile {
  return BY_ID.get(id)?.apply(patch, rngFor(patch.seed, 'card', id, index)) ?? patch;
}

export const applyCards = (patch: PatchFile, cards: readonly string[]) => cards.reduce((p, id, i) => applyCard(p, id, i), patch);

/** The next card for this drift: seeded by the drift and how many cards it already holds, never a repeat. */
export function drawCard(id: DriftId, patch: PatchFile): DriftCard | null {
  const held = id.cards ?? [];
  const open = DRIFT_CARDS.filter((c) => !held.includes(c.id) && c.applies(patch));
  if (!open.length) return null;
  return pick(rngFor(id.seed, id.visualSeed, 'draw', held.length), open);
}
