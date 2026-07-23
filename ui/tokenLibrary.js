(function () {
  // Named token art, persisted in IndexedDB (not localStorage) -- portrait images are
  // exactly the kind of content that blows past localStorage's ~5-10MB origin quota,
  // and this library is meant to accumulate entries over time.
  const DB_NAME = "campaign-os-token-library";
  const STORE_NAME = "tokens";

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

  // Spawned monsters are numbered ("Goblin 3"); strip the trailing instance number so
  // they match a library entry keyed by monster type ("goblin"). Named characters
  // (e.g. "Darkhawk") pass through unchanged.
  function normalizeName(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+\d+$/, "");
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

  function saveEntry(name, image) {
    const key = normalizeName(name);
    if (!key) return Promise.reject(new Error("Name is required"));
    return runTransaction("readwrite", (store) => store.put({
      key,
      displayName: name.trim(),
      image,
      addedAt: new Date().toISOString()
    }));
  }

  function deleteEntry(key) {
    return runTransaction("readwrite", (store) => store.delete(key));
  }

  function findImage(name) {
    const key = normalizeName(name);
    if (!key) return Promise.resolve(null);
    return runTransaction("readonly", (store) => store.get(key))
      .then((entry) => (entry ? entry.image : null));
  }

  window.CampaignOSTokenLibrary = { listEntries, saveEntry, deleteEntry, findImage, normalizeName };
})();
