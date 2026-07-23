(function () {
  // Named token art, persisted in IndexedDB (not localStorage) -- portrait images are
  // exactly the kind of content that blows past localStorage's ~5-10MB origin quota,
  // and this library is meant to accumulate entries over time.
  //
  // Metadata (name, when it was added) lives in its own store, separate from image bytes.
  // This matters: listEntries() is what renders the library panel, and it needs to run
  // over EVERY entry to sort/list them -- if image bytes lived in the same row, that alone
  // pulls every saved image's full bytes into memory in one IndexedDB getAll(), regardless
  // of how few are actually rendered as thumbnails. A library that accumulated a large
  // batch before image downscaling existed could crash the tab on nothing more than
  // opening the page, before any rendering happened. Splitting the stores means listing is
  // always cheap (just strings), and image bytes are only ever fetched one row at a time,
  // on demand (getImage/findImage).
  const DB_NAME = "campaign-os-token-library";
  const META_STORE = "meta";
  const IMAGE_STORE = "images";
  const DB_VERSION = 2;

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        // v1 kept metadata and image bytes in one "tokens" store. Dropped rather than
        // migrated on upgrade -- if a v1 store had already accumulated enough to be a
        // problem, migrating it would mean reading all those same oversized rows anyway.
        // Re-add art through the (now size-capped) add form or a connected Tokens folder.
        if (db.objectStoreNames.contains("tokens")) db.deleteObjectStore("tokens");
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
        if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE);
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

  function runTransaction(storeName, mode, work) {
    return openDB().then((db) => new Promise((resolve, reject) => {
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

  // Metadata only -- safe to call over an arbitrarily large library, since it never touches
  // image bytes. Use getImage()/findImage() to fetch a specific entry's actual art.
  function listEntries() {
    return runTransaction(META_STORE, "readonly", (store) => store.getAll())
      .then((entries) => entries.sort((a, b) => a.displayName.localeCompare(b.displayName)));
  }

  function saveEntry(name, image) {
    const key = normalizeName(name);
    if (!key) return Promise.reject(new Error("Name is required"));
    return Promise.all([
      runTransaction(META_STORE, "readwrite", (store) => store.put({
        key,
        displayName: name.trim(),
        addedAt: new Date().toISOString()
      })),
      runTransaction(IMAGE_STORE, "readwrite", (store) => store.put(image, key))
    ]);
  }

  function deleteEntry(key) {
    return Promise.all([
      runTransaction(META_STORE, "readwrite", (store) => store.delete(key)),
      runTransaction(IMAGE_STORE, "readwrite", (store) => store.delete(key))
    ]);
  }

  // Escape hatch for a library that's gotten into a bad state -- wipes every entry so the
  // DM can start over with the current, size-capped upload path.
  function clearAll() {
    return Promise.all([
      runTransaction(META_STORE, "readwrite", (store) => store.clear()),
      runTransaction(IMAGE_STORE, "readwrite", (store) => store.clear())
    ]);
  }

  // Fetches one entry's image bytes by its already-known key -- what the library panel
  // calls per visible thumbnail, never for the whole list at once.
  function getImage(key) {
    return runTransaction(IMAGE_STORE, "readonly", (store) => store.get(key)).then((image) => image || null);
  }

  function findImage(name) {
    const key = normalizeName(name);
    if (!key) return Promise.resolve(null);
    return getImage(key);
  }

  window.CampaignOSTokenLibrary = { listEntries, saveEntry, deleteEntry, clearAll, getImage, findImage, normalizeName };
})();
