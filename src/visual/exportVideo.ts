import { ArrayBufferTarget, Muxer, StreamTarget } from 'mp4-muxer';
import { featuresFromBuffer } from '@/audio/features';
import { formLook, formPosition, NEUTRAL_LOOK } from '@/audio/form';
import { normalizeLoudness, patchCeilingDb, type LoudnessResult, type LoudnessTarget } from '@/audio/loudness';
import { MAX_TAPS, renderOffline } from '@/audio/offlineRender';
import { shortSeed } from '@/audio/random';
import { audioOnly, downloadBlob, slugify, toVisualGraph } from '@/patch/io';
import type { PatchFile } from '@/patch/types';
import { VisualRenderer } from './renderer';
import { createVisualState, stepVisual, visualSeedOf } from './step';

export const VIDEO_SIZES = [
  { id: 'hd', label: '1080p', width: 1920, height: 1080 },
  { id: 'uhd', label: '4K', width: 3840, height: 2160 },
  { id: 'vertical', label: 'Vertical', width: 1080, height: 1920 },
] as const;

export interface VideoSettings {
  seconds: number;
  fps: 24 | 30;
  width: number;
  height: number;
  loudness: LoudnessTarget;
}

export type VideoStage = 'audio' | 'frames' | 'finishing';

export interface VideoProgress {
  stage: VideoStage;
  /** 0..1 within the whole export. */
  fraction: number;
  frame: number;
  totalFrames: number;
}

const SAMPLE_RATE = 48000;
const AUDIO_BITRATE = 192_000;
const VIDEO_BITS_PER_PIXEL = 0.2;
const STREAM_CHUNK = 8 * 1024 * 1024;
export const MEMORY_WARN_BYTES = 500 * 1024 * 1024;
const AUDIO_CHUNK = 4800;
const MAX_QUEUE = 6;
/** Largest frame (in pixels) H.264 level 4.2 allows; bigger frames need level 5.1+. */
const LEVEL_42_MAX_PIXELS = 8704 * 256;

let offscreenWebGL: boolean | null = null;

/** Safari before 17 has OffscreenCanvas without WebGL on it; probe once and drop the context. */
function canDrawOffscreen(): boolean {
  if (offscreenWebGL !== null) return offscreenWebGL;
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
    offscreenWebGL = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    offscreenWebGL = false;
  }
  return offscreenWebGL;
}

/** Why this browser cannot export video, in words a listener can act on; null when it can. */
export function videoExportSupport(): string | null {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return 'Video export needs WebCodecs, which this browser lacks. Use a recent Chrome or Edge, or Safari 16.4 or later. WAV export works everywhere.';
  }
  if (typeof AudioEncoder === 'undefined') {
    return 'This browser can encode video but not audio, so MP4 export is unavailable here. Older Safari versions lack audio encoding; update Safari, use Chrome or Edge, or export a WAV.';
  }
  if (typeof OffscreenCanvas === 'undefined' || !canDrawOffscreen()) {
    return 'Video export draws frames off-screen with WebGL2, which this browser does not offer. Update the browser or use Chrome or Edge.';
  }
  return null;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
  }
}

export const estimateVideoBytes = ({ seconds, fps, width, height }: VideoSettings) =>
  ((width * height * fps * VIDEO_BITS_PER_PIXEL + AUDIO_BITRATE) * seconds) / 8;

export const videoFileName = (patch: PatchFile) => `${slugify(patch.name)}-${shortSeed(patch.seed)}`;

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

const savePicker = () => (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;

/** The picker is blocked inside cross-origin frames, so only offer it in a top-level secure page. */
export function canStreamToDisk(): boolean {
  try {
    return typeof savePicker() === 'function' && window.isSecureContext && window.self === window.top;
  } catch {
    return false;
  }
}

/** Must run inside the click that starts the export. Returns null when the browser can't stream to disk. */
export async function pickVideoFile(patch: PatchFile): Promise<FileSystemFileHandle | null> {
  const picker = savePicker();
  if (!picker || !canStreamToDisk()) return null;
  try {
    return await picker({
      suggestedName: `${videoFileName(patch)}.mp4`,
      types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new ExportCancelled();
    return null;
  }
}

async function pickVideoConfig(width: number, height: number, fps: number): Promise<VideoEncoderConfig> {
  const big = width * height > LEVEL_42_MAX_PIXELS;
  const codecs = big
    ? ['avc1.640033', 'avc1.640034', 'avc1.4D4033', 'avc1.42E033']
    : ['avc1.64002A', 'avc1.640028', 'avc1.4D402A', 'avc1.42E02A', 'avc1.640033'];
  const bitrate = Math.round(width * height * fps * VIDEO_BITS_PER_PIXEL);
  for (const codec of codecs) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    };
    const { supported } = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (supported) return config;
  }
  throw new Error(`This browser cannot encode H.264 video at ${width}×${height}. Try a smaller size.`);
}

async function pickAudioConfig(): Promise<{ config: AudioEncoderConfig; muxCodec: 'aac' | 'opus' }> {
  const candidates = [
    { codec: 'mp4a.40.2', muxCodec: 'aac' as const },
    { codec: 'opus', muxCodec: 'opus' as const },
  ];
  for (const { codec, muxCodec } of candidates) {
    const config: AudioEncoderConfig = { codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE };
    const { supported } = await AudioEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (supported) return { config, muxCodec };
  }
  throw new Error('This browser cannot encode audio for video export.');
}

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Renders audio offline with a tap per analysed module, then draws every frame from the same
 * feature math as the live view, encodes H.264 + audio with WebCodecs and muxes an MP4.
 * With a file handle the MP4 streams straight to disk; otherwise it is built in memory and downloaded.
 */
export async function exportVideo(
  patch: PatchFile,
  settings: VideoSettings,
  file: FileSystemFileHandle | null,
  onProgress: (p: VideoProgress) => void,
  signal: AbortSignal,
): Promise<{ loudness: LoudnessResult; savedTo: string | null }> {
  const unsupported = videoExportSupport();
  if (unsupported) throw new Error(unsupported);
  const { node, links } = toVisualGraph(patch);
  if (!node) throw new Error('Add a Visual module to export video.');

  const { seconds, fps, width, height } = settings;
  const totalFrames = Math.max(1, Math.round(seconds * fps));
  const check = () => {
    if (signal.aborted) throw new ExportCancelled();
  };
  const report = (stage: VideoStage, fraction: number, frame = 0) =>
    onProgress({ stage, fraction, frame, totalFrames });

  const [videoConfig, audio] = await Promise.all([pickVideoConfig(width, height, fps), pickAudioConfig()]);
  check();

  report('audio', 0);
  const audioGraph = audioOnly({ seed: patch.seed, nodes: patch.nodes, edges: patch.edges, form: patch.form });
  const audioIds = new Set(audioGraph.nodes.map((n) => n.id));
  const tapIds = [...new Set(links.map((l) => l.source))].filter((id) => audioIds.has(id));
  if (tapIds.length > MAX_TAPS) throw new Error(`At most ${MAX_TAPS} modules can drive the Visual at once.`);
  const { mix, taps } = await renderOffline(audioGraph, seconds, SAMPLE_RATE, tapIds);
  check();
  const loudness = normalizeLoudness(mix, settings.loudness, patchCeilingDb(patch));
  report('audio', 0.08);

  let encodeError: Error | null = null;
  const disk = file ? await file.createWritable() : null;
  let writing = Promise.resolve();
  const memory = disk ? null : new ArrayBufferTarget();
  const target =
    memory ??
    new StreamTarget({
      chunked: true,
      chunkSize: STREAM_CHUNK,
      onData: (data, position) => {
        const bytes = data.slice();
        writing = writing
          .then(() => disk?.write({ type: 'write', data: bytes, position }))
          .catch((e: unknown) => {
            encodeError ??= new Error(`Writing the video file failed: ${e instanceof Error ? e.message : 'disk error'}`);
          });
      },
    });
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: { codec: audio.muxCodec, numberOfChannels: 2, sampleRate: SAMPLE_RATE },
    fastStart: memory ? 'in-memory' : false,
    firstTimestampBehavior: 'offset',
  });

  const fail = (e: DOMException) => {
    encodeError ??= new Error(`The encoder stopped: ${e.message}`);
  };
  const videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: fail });
  const audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: fail });
  const guard = () => {
    check();
    if (encodeError) throw encodeError;
  };

  try {
    videoEncoder.configure(videoConfig);
    audioEncoder.configure(audio.config);

    const left = mix.getChannelData(0);
    const right = mix.getChannelData(1);
    for (let start = 0; start < mix.length; start += AUDIO_CHUNK) {
      const n = Math.min(AUDIO_CHUNK, mix.length - start);
      const planar = new Float32Array(n * 2);
      planar.set(left.subarray(start, start + n), 0);
      planar.set(right.subarray(start, start + n), n);
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: SAMPLE_RATE,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((start / SAMPLE_RATE) * 1e6),
        data: planar,
      });
      audioEncoder.encode(data);
      data.close();
    }
    await audioEncoder.flush();
    guard();
    report('frames', 0.1);

    const canvas = new OffscreenCanvas(width, height);
    const renderer = new VisualRenderer(canvas);
    const state = createVisualState(visualSeedOf(node.data, patch.seed));
    const dt = 1 / fps;
    const keyEvery = fps * 2;
    const form = patch.form;
    try {
      for (let i = 0; i < totalFrames; i++) {
        guard();
        const features = featuresFromBuffer(taps, SAMPLE_RATE, i, fps);
        const look = form ? formLook(form, formPosition(form, i / fps)) : NEUTRAL_LOOK;
        renderer.render(stepVisual(state, node.data, links, features, dt, look), width, height);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        });
        videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
        frame.close();
        while (videoEncoder.encodeQueueSize > MAX_QUEUE) {
          await nextTask();
          guard();
        }
        if (i % 4 === 0) {
          report('frames', 0.1 + 0.85 * (i / totalFrames), i);
          await nextTask();
        }
      }
    } finally {
      renderer.release();
    }

    report('finishing', 0.96, totalFrames);
    await videoEncoder.flush();
    guard();
    muxer.finalize();
    await writing;
    guard();
    await disk?.close();
  } catch (err) {
    await writing;
    await disk?.abort().catch(() => undefined);
    throw err;
  } finally {
    if (videoEncoder.state !== 'closed') videoEncoder.close();
    if (audioEncoder.state !== 'closed') audioEncoder.close();
  }

  const round = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(2)) : null);
  const base = videoFileName(patch);
  if (memory) downloadBlob(new Blob([memory.buffer], { type: 'video/mp4' }), `${base}.mp4`);
  const sidecar = {
    ...patch,
    render: {
      kind: 'video',
      ...settings,
      sampleRate: SAMPLE_RATE,
      videoCodec: videoConfig.codec,
      audioCodec: audio.config.codec,
      peakDbfs: round(loudness.peakDb),
      loudnessTarget: settings.loudness,
      integratedLufs: round(loudness.final),
      measuredLufs: round(loudness.measured),
      renderedAt: new Date().toISOString(),
    },
  };
  await new Promise((r) => setTimeout(r, 400));
  downloadBlob(new Blob([JSON.stringify(sidecar, null, 2)], { type: 'application/json' }), `${base}.json`);
  report('finishing', 1, totalFrames);
  return { loudness, savedTo: file?.name ?? null };
}
