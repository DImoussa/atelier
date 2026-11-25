// Petit wrapper IndexedDB : un magasin pour le document, un pour les fichiers binaires.
const DB_NAME = 'atelier-db';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<any>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

export const kvGet = <T = any>(key: string) => tx<T>('kv', 'readonly', s => s.get(key));
export const kvSet = (key: string, val: any) => tx('kv', 'readwrite', s => s.put(val, key));
export const blobGet = (id: string) => tx<Blob | undefined>('blobs', 'readonly', s => s.get(id));
export const blobSet = (id: string, b: Blob) => tx('blobs', 'readwrite', s => s.put(b, id));
export const blobDel = (id: string) => tx('blobs', 'readwrite', s => s.delete(id));
export const blobKeys = () => tx<IDBValidKey[]>('blobs', 'readonly', s => s.getAllKeys());

/** Récupération d'un fichier absent de ce navigateur (copie en ligne). */
export const remote: { fetch: null | ((id: string) => Promise<Blob | null>) } = { fetch: null };

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
export function blobUrl(id: string): Promise<string | null> {
  if (urlCache.has(id)) return Promise.resolve(urlCache.get(id)!);
  if (pending.has(id)) return pending.get(id)!;
  const p = blobGet(id).catch(() => undefined).then(async b => {
    if (!b && remote.fetch) b = (await remote.fetch(id).catch(() => null)) || undefined;
    pending.delete(id);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urlCache.set(id, u);
    return u;
  });
  pending.set(id, p);
  return p;
}
export function cachedBlobUrl(id: string) { return urlCache.get(id) || null; }

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(b); });
}
export async function dataUrlToBlob(u: string): Promise<Blob> { return (await fetch(u)).blob(); }
