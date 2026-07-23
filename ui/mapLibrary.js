(function () {
  // Named map art, persisted in IndexedDB (not localStorage) -- same rationale as
  // tokenLibrary.js: battle map images are exactly the kind of content that blows past
  // localStorage's ~5-10MB origin quota. Kept in its own store/DB rather than reusing
  // tokenLibrary.js's, since map entries carry an aspectRatio a token entry has no use for,
  // and there's no name-normalization-by-stripping-a-trailing-number here -- maps aren't
  // spawned in numbered instances the way monsters are.
  //
  // Metadata (name, aspectRatio) lives in its own store, separate from image bytes -- see
  // the longer comment in tokenLibrary.js for why: listEntries() (what renders the panel)
  // needs to run over every entry, and if image bytes lived in the same row, that alone
  // pulls every saved image's full bytes into memory in one getAll(), regardless of how few
  // are actually shown as thumbnails. A library that accumulated a large batch before image
  // downscaling existed could crash the tab on nothing more than opening the page.
  const DB_NAME = "campaign-os-map-library";
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
        // v1 kept metadata and image bytes in one "maps" store. Dropped rather than
        // migrated on upgrade -- see tokenLibrary.js's identical note for why. Re-add maps
        // through the (now size-capped) add form or a connected Maps folder.
        if (db.objectStoreNames.contains("maps")) db.deleteObjectStore("maps");
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
        if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
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
  // image bytes. Use getImage()/getEntry() to fetch a specific entry's actual art.
  function listEntries() {
    return runTransaction(META_STORE, "readonly", (store) => store.getAll())
      .then((entries) => entries.sort((a, b) => a.displayName.localeCompare(b.displayName)));
  }

  function saveEntry(name, image, aspectRatio) {
    const key = normalizeName(name);
    if (!key) return Promise.reject(new Error("Name is required"));
    return Promise.all([
      runTransaction(META_STORE, "readwrite", (store) => store.put({
        key,
        displayName: name.trim(),
        aspectRatio: aspectRatio || "12 / 8",
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

  // Full record (metadata + image bytes) for a single entry -- used only when actually
  // loading that one map (the "Use" flow), never for listing.
  function getEntry(key) {
    return Promise.all([
      runTransaction(META_STORE, "readonly", (store) => store.get(key)),
      getImage(key)
    ]).then(([meta, image]) => (meta ? { ...meta, image } : null));
  }

  window.CampaignOSMapLibrary = { listEntries, saveEntry, deleteEntry, clearAll, getImage, getEntry, normalizeName };
})();
