(function () {
  // Named map art, persisted in IndexedDB (not localStorage) -- same rationale as
  // tokenLibrary.js: battle map images are exactly the kind of content that blows past
  // localStorage's ~5-10MB origin quota. Kept in its own store/DB rather than reusing
  // tokenLibrary.js's, since map entries carry an aspectRatio a token entry has no use for,
  // and there's no name-normalization-by-stripping-a-trailing-number here -- maps aren't
  // spawned in numbered instances the way monsters are.
  const DB_NAME = "campaign-os-map-library";
  const STORE_NAME = "maps";

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function runTransaction(mode, work) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
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

  function listEntries() {
    return runTransaction("readonly", (store) => store.getAll())
      .then((entries) => entries.sort((a, b) => a.displayName.localeCompare(b.displayName)));
  }

  function saveEntry(name, image, aspectRatio) {
    const key = normalizeName(name);
    if (!key) return Promise.reject(new Error("Name is required"));
    return runTransaction("readwrite", (store) => store.put({
      key,
      displayName: name.trim(),
      image,
      aspectRatio: aspectRatio || "12 / 8",
      addedAt: new Date().toISOString()
    }));
  }

  function deleteEntry(key) {
    return runTransaction("readwrite", (store) => store.delete(key));
  }

  // Escape hatch for a library that's gotten into a bad state (e.g. a bulk import from
  // before image downscaling existed, large enough that just loading the list is heavy) --
  // wipes every entry so the DM can start over with the current, size-capped upload path.
  function clearAll() {
    return runTransaction("readwrite", (store) => store.clear());
  }

  function getEntry(key) {
    return runTransaction("readonly", (store) => store.get(key));
  }

  window.CampaignOSMapLibrary = { listEntries, saveEntry, deleteEntry, clearAll, getEntry, normalizeName };
})();
