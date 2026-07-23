(function () {
  // Persists picked FileSystemDirectoryHandles (a maps folder, a tokens folder) across
  // reloads -- same pattern as dmBridgeStore.js, generalized to hold more than one handle
  // by key. FileSystemHandle objects are structured-cloneable, so IndexedDB can store the
  // handle itself, not just a description of it. Permission still has to be re-confirmed
  // each session (browser security requirement) -- see requestPermission()/queryPermission()
  // usage in app.js's connect handlers.
  const DB_NAME = "campaign-os-asset-folders";
  const STORE_NAME = "handles";

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  function saveHandle(kind, handle) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(handle, kind);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function loadHandle(kind) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(kind);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
  }

  window.CampaignOSAssetFolders = { saveHandle, loadHandle };
})();
