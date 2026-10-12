import { useEffect, useRef, useState } from 'react';
import type { Drift } from '@/drift/resolve';
import { ARCHETYPE_LABEL } from '@/drift/traits';
import { toVisualGraph } from '@/patch/io';
import type { VisualRenderer } from '@/visual/renderer';
import { createStillRenderer, renderStill } from '@/visual/still';

const ARTWORK_SIZE = 512;

export interface MediaControls {
  play(): void;
  pause(): void;
  next(): void;
}

const supported = () => typeof navigator !== 'undefined' && 'mediaSession' in navigator;

/**
 * Publishes the playing drift to the OS media controls (lock screen, notification, headset keys)
 * with a still of its visual as artwork. Pass a null drift to step aside for another publisher.
 */
export function useMediaSession(drift: Drift | null, playing: boolean, controls: MediaControls) {
  const [artwork, setArtwork] = useState<{ seed: string; url: string } | null>(null);
  const stills = useRef<{ renderer: VisualRenderer; canvas: OffscreenCanvas } | null | undefined>(undefined);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const patch = drift?.patch ?? null;

  useEffect(() => {
    if (!supported() || !patch) return;
    let alive = true;
    let url: string | null = null;
    if (stills.current === undefined) stills.current = createStillRenderer(ARTWORK_SIZE);
    const target = stills.current;
    if (!target) return;
    const timer = setTimeout(() => {
      renderStill(target, toVisualGraph(patch), patch.seed)
        .then((blob) => {
          if (!alive || !blob) return;
          url = URL.createObjectURL(blob);
          setArtwork({ seed: patch.seed, url });
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [patch]);

  useEffect(
    () => () => {
      stills.current?.renderer.release();
      stills.current = undefined;
    },
    [],
  );

  const title = patch?.name ?? null;
  const archetype = drift ? ARCHETYPE_LABEL[drift.traits.archetype] : null;
  const art = artwork && patch && artwork.seed === patch.seed ? artwork.url : null;

  useEffect(() => {
    if (!supported() || title === null) return;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({
      title,
      artist: archetype ?? '',
      album: 'Driftbox',
      artwork: art ? [{ src: art, sizes: `${ARTWORK_SIZE}x${ARTWORK_SIZE}`, type: 'image/png' }] : [],
    });
    return () => {
      session.metadata = null;
    };
  }, [title, archetype, art]);

  const active = drift !== null;

  useEffect(() => {
    if (!supported() || !active) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', () => controlsRef.current.play()],
      ['pause', () => controlsRef.current.pause()],
      ['stop', () => controlsRef.current.pause()],
      ['nexttrack', () => controlsRef.current.next()],
    ];
    for (const [action, fn] of handlers) {
      try {
        session.setActionHandler(action, fn);
      } catch {
        // Not every platform knows every action.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // As above.
        }
      }
      session.playbackState = 'none';
    };
  }, [active]);

  useEffect(() => {
    if (supported() && active) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [active, playing]);
}
