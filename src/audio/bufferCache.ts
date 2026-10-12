/** Enough for two crossfading drifts' noise, hiss and reverb buffers; older ones are rebuilt on demand. */
const MAX_ENTRIES = 24;

const caches = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/**
 * Seeded buffers (noise, reverb tails) are identical for every form pass of a drift, so each
 * context keeps the most recent ones instead of regenerating seconds of samples per pass.
 * `key` must name everything the buffer's contents depend on.
 */
export function cachedBuffer(ctx: BaseAudioContext, key: string, build: () => AudioBuffer): AudioBuffer {
  let cache = caches.get(ctx);
  if (!cache) {
    cache = new Map();
    caches.set(ctx, cache);
  }
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const buffer = build();
  cache.set(key, buffer);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return buffer;
}
