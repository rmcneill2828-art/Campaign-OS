(function () {
  // Persists the picked dm-bridge FileSystemDirectoryHandle across reloads --
  // FileSystemHandle objects are structured-cloneable, so IndexedDB can store the
  // handle itself (not just a description of it). Permission still has to be
  // re-confirmed each session (browser security requirement), but this at least
  // avoids re-picking the folder every time -- see requestPermission() usage in
  // app.js's connect handler.
  const DB_NAME = "campaign-os-dm-bridge-store";
  const STORE_NAME = "handles";
  const HANDLE_KEY = "dm-bridge-dir";

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

  function saveHandle(handle) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function loadHandle() {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
  }

  window.CampaignOSDMBridgeStore = { saveHandle, loadHandle };
})();
