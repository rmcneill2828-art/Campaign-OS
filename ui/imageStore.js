(function () {
  // Generic image blob store, backed by IndexedDB rather than localStorage. Map
  // images (and anything else that wants it) are saved here keyed by a generated ID;
  // only that short key goes into the encounter state that gets JSON-serialized into
  // localStorage. A couple of real map images as inline base64 would otherwise blow
  // past localStorage's ~5-10MB origin quota with no error handling at the write site.
  const DB_NAME = "campaign-os-image-store";
  const STORE_NAME = "images";

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

  function generateKey(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function saveImage(key, dataUrl) {
    return runTransaction("readwrite", (store) => store.put({ key, dataUrl }));
  }

  function loadImage(key) {
    return runTransaction("readonly", (store) => store.get(key))
      .then((entry) => (entry ? entry.dataUrl : null));
  }

  function deleteImage(key) {
    return runTransaction("readwrite", (store) => store.delete(key));
  }

  window.CampaignOSImageStore = { generateKey, saveImage, loadImage, deleteImage };
})();
