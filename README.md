# Driftbox

Driftbox is a generative audio and visual instrument that runs entirely in the browser. Every piece ("a drift") is grown from a seed, checked by quality gates, and played by a standalone Web Audio engine. Nothing is sent to a server. The app installs as an offline PWA.

## Features

- **Drift randomizer.** One tap builds a new sound and visual from a fresh seed. There are ten archetypes: drone, texture, pulse, swell, field, bells, choir, tides, machine and airports. Each archetype is a family of patches, not a fixed preset.
- **Form.** Every drift is a sequence of sections. Parameters change along automation lanes, and loops start and stop per section.
- **Airports and tape loops.** Note events repeat on loops of unequal length, so they phase against each other. The cycle view shows each loop and when they line up.
- **Planting.** You can drop notes into a playing drift. They are quantised to its scale.
- **Drift Cards.** About 40 one-line instructions, such as "Lengthen every cycle by half" or "Let one loop fall silent", mutate a drift. The cards you apply are stored in the link.
- **Hours.** Optional. Traits drift slowly with local time and date.
- **Room mode.** Halves event density, caps transients, slows the visual with no bursts, and lowers the output by 6 dB.
- **Endless.** Plays a chain of drifts that crossfade over 8 s with equal-power curves. A sleep timer (15, 30, 60 or 90 min) fades out over 60 s.
- **Drift of the Day.** A daily seed derived from the UTC date, so everyone hears the same drift.
- **Visuals.** Six WebGL2 shader families (drift, rings, fog, ink, interference, horizon) are driven by audio features. You can lock the visual while rerolling the sound.
- **Library.** Saved drifts are stored locally in IndexedDB.
- **Patcher.** An advanced view for editing the module graph directly. It includes oscillators, noise, filters, FM operators, chorus, formant, tape echo, reverb, Loop Voice, LFOs, random walks and a Master module.
- **PWA.** Installable and works offline. It integrates with Media Session (lock screen and headset controls) and keeps playing in the background where the browser allows it.

## Seeds and links

A seed is a 128-bit value written as 32 hex characters. All randomness comes from it: sound, form, loops and visuals. Each part draws from its own labelled random stream (cyrb128 hashing into sfc32), so changing one part never shifts another.

A drift is identified by:

| Field | Meaning |
| --- | --- |
| `s` | sound seed |
| `a` | attempt number. Attempt 0 is the seed itself; later attempts hash the seed with the attempt index. |
| `v` | visual seed (omitted when it equals the sound seed) |
| `va` | visual attempt |
| `c` | comma-separated Drift Card ids, applied in order |

These are stored in the URL hash, for example `#s=…&a=0&va=1&c=lengthen-cycles,silence-loop`. Opening the link regenerates exactly the same drift. No audio or patch data is stored in the link.

## Export formats

- **WAV.** 16-bit stereo PCM, rendered offline faster than real time. You can normalise to −14 LUFS (web), −23 LUFS (broadcast) or leave it as rendered. Normalising never exceeds the Master ceiling; the dialog tells you when the ceiling limited the result.
- **MP4.** H.264 video with AAC audio, or Opus where AAC is not available. It is encoded with WebCodecs and muxed with mp4-muxer. Where the File System Access API exists the file streams straight to disk; otherwise it is built in memory.
- **JSON sidecar.** Each export also downloads a JSON file containing the full patch (seed included) plus render settings, peak and loudness.
- **Patch JSON.** The patcher can save and load module graphs.

## Browser support

| Browser | Audio and visuals | WAV export | MP4 export |
| --- | --- | --- | --- |
| Chrome / Edge 94+ | Yes | Yes | Yes |
| Safari 14.1+ (macOS, iOS) | Yes | Yes | Safari 16.4+ only, and only if WebCodecs audio encoding is available |
| Firefox | Yes | Yes | Only in versions with WebCodecs (130+) |

When something is missing, Driftbox explains it in the app instead of failing silently. This covers:

- older browsers without full Web Audio;
- audio blocked by the browser;
- memory limits during offline renders;
- missing WebCodecs or OffscreenCanvas WebGL2;
- private browsing that disables IndexedDB (the library turns off and everything else still works).

Audio only ever starts after a tap or click.

## Architecture

```
generator ──► gates ──► patch ──► Player ──► AudioEngine (reconciler) ──► output
                                    │              │
                                    │              └─ analysers ─► FeatureBus ─► VisualRenderer
                                    └─ EventScheduler ─► loop voices / plantings (voice pools)
```

- **Generator** (`src/drift`). `generatePatch(id)` turns a drift id into a patch. It picks traits and an archetype, builds the sound graph (`sound.ts`, `builder.ts`), composes a form score (`form.ts`), then applies any Drift Cards.
- **Gates** (`src/drift/gate.ts`, `resolve.ts`). Each candidate is rendered offline at 22.05 kHz before you hear it. The audio gate rejects audio that is silent, clipping, too quiet, too loud or spectrally flat. It checks both the whole render and the loudest 4-second window, and rejects Airports drifts with no note in the first 6 s. The visual gate renders frames off-screen and rejects flashing, low-contrast or static images. A failing candidate moves to the next attempt, up to 8 attempts.
- **Engine and reconciler** (`src/audio/engine.ts`). `AudioEngine.reconcile(patch)` compares the new graph with the running one. It creates, updates or destroys only the nodes and connections that changed, so edits made in the patcher never restart the sound. Modulation edges go through a scaling gain. The UI only edits graphs; the engine owns all audio nodes.
- **Form** (`src/audio/form.ts`). Writes each section's automation lanes onto audio parameters from the current time forward, and decides which loops are active.
- **Loop scheduler** (`src/audio/events.ts`, `loopVoice.ts`, `voicePool.ts`).
  - `EventScheduler` is a deterministic cursor over each loop's note times.
  - Live playback pulls 1.5 s ahead on a 200 ms tick. Offline renders pull at suspend points, so live and exported audio match.
  - Each note claims a voice in two pools: 6 per loop or 8 for plantings, and 24 per audio context. When a pool is full the oldest note fades out over 50 ms. Steals depend only on event times, which keeps them deterministic.
  - Finished nodes disconnect on `ended`. Noise and reverb buffers are cached per context.
- **Player** (`src/audio/player.ts`). Runs one engine per form pass and keeps shared tap buses for analysis. It is used for live playback, offline export and every Endless deck.
- **Visual bus** (`src/audio/featureBus.ts`, `src/visual`). Analysers feed loudness, spectral and envelope features into a `FeatureBus`. `VisualRenderer` (WebGL2) reads them each frame. Resolution scales with frame time, and mobile is capped at 30 fps. Renderers free their GL resources and release the context when unmounted.
- **Endless** (`src/audio/endless.ts`). Two decks crossfade on one context. When a crossfade ends, the old deck's player, engine, analysers and gain are disconnected and disposed.

## Development

```
npm install
npm run dev        # start the dev server
npm run typecheck
npm run lint
npm run build
npm run icons      # regenerate PWA icons
```

Built with Vite, React, TypeScript, Tailwind, React Flow and lucide-react.
