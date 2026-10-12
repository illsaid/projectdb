import type { Planting } from '@/audio/plantings';
import type { SeedHex } from '@/patch/types';
import type { DriftId } from './generate';
import type { Archetype, Brightness, DriftLength } from './traits';

const DB_NAME = 'driftbox';
const DB_VERSION = 1;
const SEEN = 'seen';
const LIBRARY = 'library';

export interface KeptDrift extends DriftId {
  key: string;
  name: string;
  archetype: Archetype;
  brightness: Brightness;
  length: DriftLength;
  keptAt: number;
  /** Notes planted while listening, replayed whenever this drift plays. */
  plantings?: Planting[];
}

export const driftKey = (id: DriftId) =>
  `${id.seed}.${id.attempt}.${id.visualSeed}.${id.visualAttempt}${id.cards?.length ? `.${id.cards.join('+')}` : ''}`;

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Storage request failed'));
  });

const PRIVATE_HINT = 'Local storage for drifts is unavailable (private browsing can block it), so the library is off.';

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('This browser has no local storage for drifts, so the library is off.'));
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return reject(new Error(PRIVATE_HINT));
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SEEN)) db.createObjectStore(SEEN, { keyPath: 'seed' });
      if (!db.objectStoreNames.contains(LIBRARY)) db.createObjectStore(LIBRARY, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(PRIVATE_HINT));
    req.onblocked = () => reject(new Error('Drift storage is busy in another tab. Close other Driftbox tabs and reload.'));
  });

/**
 * Seen seeds and kept drifts, persisted in this browser's IndexedDB. Safari drops the connection
 * when a page sits in the background, so a request on a closed connection reopens it once.
 */
export class DriftStore {
  private constructor(private db: IDBDatabase) {
    this.watch(db);
  }

  static async open(): Promise<DriftStore> {
    const store = new DriftStore(await openDb());
    // Ask the browser not to evict the library under storage pressure (Safari otherwise may after weeks unused).
    void navigator.storage?.persist?.().catch(() => false);
    return store;
  }

  private watch(db: IDBDatabase) {
    db.onversionchange = () => db.close();
  }

  private async run<T>(name: string, mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    try {
      return await done(op(this.db.transaction(name, mode).objectStore(name)));
    } catch (err) {
      if (!(err instanceof DOMException) || err.name !== 'InvalidStateError') throw err;
      this.db = await openDb();
      this.watch(this.db);
      return done(op(this.db.transaction(name, mode).objectStore(name)));
    }
  }

  async hasSeen(seed: SeedHex): Promise<boolean> {
    return (await this.run(SEEN, 'readonly', (s) => s.count(seed))) > 0;
  }

  async markSeen(seed: SeedHex): Promise<void> {
    await this.run(SEEN, 'readwrite', (s) => s.put({ seed, at: Date.now() }));
  }

  async list(): Promise<KeptDrift[]> {
    const all = (await this.run(LIBRARY, 'readonly', (s) => s.getAll())) as KeptDrift[];
    return all.sort((a, b) => b.keptAt - a.keptAt);
  }

  async has(key: string): Promise<boolean> {
    return (await this.run(LIBRARY, 'readonly', (s) => s.count(key))) > 0;
  }

  async keep(entry: KeptDrift): Promise<void> {
    await this.run(LIBRARY, 'readwrite', (s) => s.put(entry));
  }

  async remove(key: string): Promise<void> {
    await this.run(LIBRARY, 'readwrite', (s) => s.delete(key));
  }
}
