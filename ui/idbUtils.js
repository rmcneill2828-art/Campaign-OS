(function () {
  // Shared IndexedDB open + transaction-wrapping helper -- extracted from what used to be five
  // near-identical copies of this exact boilerplate (imageStore.js, tokenLibrary.js,
  // mapLibrary.js, assetFolders.js, dmBridgeStore.js). Each store still owns its own DB name,
  // version, and schema/upgrade logic, and nothing about which database a store reads from or
  // what's already persisted in it changes here -- this only de-duplicates the promise-wrapping
  // code around indexedDB's callback-based API.

  // Returns a memoized `open()` function for one database: the first call opens (and, via
  // `upgrade`, creates/migrates) it; every call after that resolves the same cached promise.
  // Callers keep this the same way they used to keep their own `dbPromise`-backed `openDB()` --
  // just without repeating the open/onupgradeneeded/onsuccess/onerror wiring each time.
  function openDatabase(name, version, upgrade) {
    let dbPromise = null;
    return function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => upgrade(request.result);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return dbPromise;
    };
  }

  // Runs `work(store)` inside a transaction against `storeName` (opening the database first via
  // `open`, an `openDatabase()`-returned function). Resolves with the underlying IDBRequest's
  // result if `work` returns one (most calls -- `store.get()`/`store.put()`/etc. all return a
  // request), or on transaction completion if it doesn't (a caller that ran a multi-step write
  // with no single meaningful result to hand back). Same shape every one of the five duplicated
  // copies of this function used.
  function runTransaction(open, storeName, mode, work) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = work(store);
      tx.onerror = () => reject(tx.error);
      if (request) {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } else {
        tx.oncomplete = () => resolve();
      }
    }));
  }

  window.CampaignOSIdb = { openDatabase, runTransaction };
})();
