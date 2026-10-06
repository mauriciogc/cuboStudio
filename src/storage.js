// Persistencia en localStorage.
//   cubostudio:index        -> [{ id, name, createdAt, updatedAt, count, thumb }]
//   cubostudio:model:<id>   -> datos serializados del modelo
//   cubostudio:current      -> id abierto
//   cubostudio:prefs        -> preferencias de la interfaz

const NS = 'cubostudio';
const KEY = {
  index: `${NS}:index`,
  current: `${NS}:current`,
  prefs: `${NS}:prefs`,
  model: (id) => `${NS}:model:${id}`,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** Lanza QuotaExceededError si el almacenamiento está lleno. */
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function isQuotaError(err) {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22);
}

export const store = {
  newId() {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  },

  list() {
    return read(KEY.index, []).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  entry(id) {
    return read(KEY.index, []).find((e) => e.id === id) ?? null;
  },

  load(id) {
    return read(KEY.model(id), null);
  },

  save({ id, name, data, thumb }) {
    const index = read(KEY.index, []);
    const now = Date.now();
    let entry = index.find((e) => e.id === id);
    if (!entry) {
      entry = { id, createdAt: now };
      index.push(entry);
    }
    Object.assign(entry, { name, updatedAt: now, count: data.voxels.length / 4, bg: data.background ?? null });
    if (thumb) entry.thumb = thumb;
    write(KEY.model(id), data);
    write(KEY.index, index);
    return entry;
  },

  rename(id, name) {
    const index = read(KEY.index, []);
    const entry = index.find((e) => e.id === id);
    if (!entry) return;
    entry.name = name;
    write(KEY.index, index);
  },

  remove(id) {
    write(KEY.index, read(KEY.index, []).filter((e) => e.id !== id));
    localStorage.removeItem(KEY.model(id));
  },

  get currentId() { return read(KEY.current, null); },
  set currentId(id) { write(KEY.current, id); },

  prefs() {
    const prefs = { background: 'pradera', showGrid: true, ...read(KEY.prefs, {}) };
    delete prefs.recent; // los colores recientes ya no existen
    delete prefs.recentOpen;
    delete prefs.sceneOpen; // Escena ya no es acordeón
    return prefs;
  },

  savePrefs(prefs) {
    try { write(KEY.prefs, prefs); } catch { /* no crítico */ }
  },

  /** Uso aproximado en bytes (UTF-16) de las claves de la app. */
  usage() {
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(NS)) bytes += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2;
    }
    return bytes;
  },
};

// Imágenes guía: pesan mucho para localStorage, van en IndexedDB (clave = id de figura).
let dbPromise = null;

function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NS, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('refs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function refsTx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('refs', mode);
    const req = fn(tx.objectStore('refs'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const refStore = {
  get: (id) => refsTx('readonly', (s) => s.get(id)).catch(() => null),
  set: (id, data) => refsTx('readwrite', (s) => s.put(data, id)),
  remove: (id) => refsTx('readwrite', (s) => s.delete(id)).catch(() => {}),
};
