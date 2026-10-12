import { audioOnly, downloadBlob, slugify } from '@/patch/io';
import type { PatchFile } from '@/patch/types';
import { normalizeLoudness, patchCeilingDb, type LoudnessResult, type LoudnessTarget } from './loudness';
import { encodeWav16, renderOffline } from './offlineRender';
import { shortSeed } from './random';

export interface ExportSettings {
  seconds: number;
  sampleRate: number;
  loudness: LoudnessTarget;
}

const round = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(2)) : null);

/** Rebuilds the patch offline, normalises its loudness, and downloads the WAV with a JSON sidecar. */
export async function exportPatch(patch: PatchFile, settings: ExportSettings): Promise<LoudnessResult> {
  const { mix: buffer } = await renderOffline(
    audioOnly({ seed: patch.seed, nodes: patch.nodes, edges: patch.edges, form: patch.form }),
    settings.seconds,
    settings.sampleRate,
  );
  const loudness = normalizeLoudness(buffer, settings.loudness, patchCeilingDb(patch));
  const base = `${slugify(patch.name)}-${shortSeed(patch.seed)}`;
  downloadBlob(encodeWav16(buffer), `${base}.wav`);
  const sidecar = {
    ...patch,
    render: {
      ...settings,
      bitDepth: 16,
      channels: 2,
      peakDbfs: round(loudness.peakDb),
      integratedLufs: round(loudness.final),
      measuredLufs: round(loudness.measured),
      renderedAt: new Date().toISOString(),
    },
  };
  await new Promise((r) => setTimeout(r, 400));
  downloadBlob(new Blob([JSON.stringify(sidecar, null, 2)], { type: 'application/json' }), `${base}.json`);
  return loudness;
}
