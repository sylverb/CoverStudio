// cache.js — IndexedDB cache, persistent across sessions.
//   store "games": jeuInfos results, keyed by "<systemeid>:<md5>"
//   store "media": image Blobs, keyed by media URL
// Goal: never re-query / re-download something already fetched.

const DB_NAME = "cover-scraper-cache";
const DB_VERSION = 1;
const STORES = ["games", "media"];

let dbPromise = null;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function db() {
  return (dbPromise ||= open());
}

async function get(store, key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function set(store, key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearCache() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORES, "readwrite");
    for (const s of STORES) tx.objectStore(s).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function count(store) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(store, "readonly").objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// { games, media, bytes } — counts from IndexedDB, bytes from the storage
// estimate (origin usage; here essentially the cache).
export async function cacheStats() {
  const [games, media] = await Promise.all([count("games"), count("media")]);
  let bytes = 0;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      bytes = e.usage || 0;
    }
  } catch (e) { /* ignore */ }
  return { games, media, bytes };
}

export const cache = {
  getGame: (key) => get("games", key),
  setGame: (key, jeu) => set("games", key, jeu),
  getMedia: (url) => get("media", url),
  setMedia: (url, blob) => set("media", url, blob),
};
