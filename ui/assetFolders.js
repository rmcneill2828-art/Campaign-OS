(function () {
  // Persists picked FileSystemDirectoryHandles (a maps folder, a tokens folder) across
  // reloads -- same pattern as dmBridgeStore.js, generalized to hold more than one handle
  // by key. FileSystemHandle objects are structured-cloneable, so IndexedDB can store the
  // handle itself, not just a description of it. Permission still has to be re-confirmed
  // each session (browser security requirement) -- see requestPermission()/queryPermission()
  // usage in app.js's connect handlers.
  const DB_NAME = "campaign-os-asset-folders";
  const STORE_NAME = "handles";

  const openDB = window.CampaignOSIdb.openDatabase(DB_NAME, 1, (db) => {
    db.createObjectStore(STORE_NAME);
  });

  function saveHandle(kind, handle) {
    return window.CampaignOSIdb.runTransaction(openDB, STORE_NAME, "readwrite", (store) => store.put(handle, kind));
  }

  function loadHandle(kind) {
    return window.CampaignOSIdb.runTransaction(openDB, STORE_NAME, "readonly", (store) => store.get(kind))
      .then((result) => result || null);
  }

  window.CampaignOSAssetFolders = { saveHandle, loadHandle };
})();
