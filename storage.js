/* Надёжное хранение. Основные данные лежат в localStorage, но это хранилище
   браузера: оно может переполниться или быть очищено. Поэтому каждое сохранение
   дублируется снимком в IndexedDB — независимом хранилище того же устройства,
   и приложение умеет восстановиться из него, если основное потерялось. */

const SNAP_DB = 'koshelek-snapshots';
const SNAP_STORE = 'snapshots';
const SNAP_KEEP = 5;

const Snapshots = {
  db: null,

  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB недоступна'));
      const req = indexedDB.open(SNAP_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SNAP_STORE)) db.createObjectStore(SNAP_STORE, { keyPath: 'at' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error || new Error('не удалось открыть хранилище'));
    });
  },

  async put(json, count) {
    try {
      const db = await this.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(SNAP_STORE, 'readwrite');
        tx.objectStore(SNAP_STORE).put({ at: Date.now(), count, json });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      await this.trim();
      return true;
    } catch (e) {
      return false;
    }
  },

  async list() {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(SNAP_STORE, 'readonly').objectStore(SNAP_STORE).getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.at - a.at));
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return [];
    }
  },

  async trim() {
    const all = await this.list();
    if (all.length <= SNAP_KEEP) return;
    const db = await this.open();
    const tx = db.transaction(SNAP_STORE, 'readwrite');
    for (const s of all.slice(SNAP_KEEP)) tx.objectStore(SNAP_STORE).delete(s.at);
  },

  async newest() {
    return (await this.list())[0] || null;
  },
};

/* Просим браузер не вычищать наши данные при нехватке места. */
async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) {
    return null;
  }
}

async function storageReport() {
  const out = { persisted: null, usedKb: null, quotaKb: null, snapshots: 0, lastSnapshot: null };
  try {
    if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      out.usedKb = Math.round((e.usage || 0) / 1024);
      out.quotaKb = Math.round((e.quota || 0) / 1024);
    }
  } catch (e) {}
  const snaps = await Snapshots.list();
  out.snapshots = snaps.length;
  out.lastSnapshot = snaps[0] || null;
  return out;
}
