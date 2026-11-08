/* Credentials Manager — local persistence (IndexedDB). Only ever stores the ENCRYPTED vault file + non-secret metadata. */
(function (global) {
  'use strict';
  const DB = 'credmgr', STORE = 'kv';
  let dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('This browser has no IndexedDB storage'));
      const req = global.indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open storage'));
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
    }));
  }

  global.VaultStore = Object.freeze({
    get: key => tx('readonly', s => s.get(key)),
    set: (key, val) => tx('readwrite', s => s.put(val, key)),
    del: key => tx('readwrite', s => s.delete(key)),
    async persist() {
      try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* ignore */ }
      return false;
    },
  });
})(window);
