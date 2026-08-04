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

  const openDB = window.CampaignOSIdb.openDatabase(DB_NAME, 1, (db) => {
    db.createObjectStore(STORE_NAME);
  });

  function saveHandle(handle) {
    return window.CampaignOSIdb.runTransaction(openDB, STORE_NAME, "readwrite", (store) => store.put(handle, HANDLE_KEY));
  }

  function loadHandle() {
    return window.CampaignOSIdb.runTransaction(openDB, STORE_NAME, "readonly", (store) => store.get(HANDLE_KEY))
      .then((result) => result || null);
  }

  window.CampaignOSDMBridgeStore = { saveHandle, loadHandle };
})();
