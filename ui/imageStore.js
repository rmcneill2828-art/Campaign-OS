(function () {
  // Generic image blob store, backed by IndexedDB rather than localStorage. Map
  // images (and anything else that wants it) are saved here keyed by a generated ID;
  // only that short key goes into the encounter state that gets JSON-serialized into
  // localStorage. A couple of real map images as inline base64 would otherwise blow
  // past localStorage's ~5-10MB origin quota with no error handling at the write site.
  const DB_NAME = "campaign-os-image-store";
  const STORE_NAME = "images";

  const openDB = window.CampaignOSIdb.openDatabase(DB_NAME, 1, (db) => {
    db.createObjectStore(STORE_NAME, { keyPath: "key" });
  });

  function runTransaction(mode, work) {
    return window.CampaignOSIdb.runTransaction(openDB, STORE_NAME, mode, work);
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

  // Content-addressed save: the key IS a hash of the image bytes, so saving the exact same
  // image twice -- e.g. three goblins spawned from the same Token Library entry, which
  // previously each got their own full copy via generateKey() -- naturally reuses one record
  // the second and third time instead of writing a fresh duplicate. `put()` on an existing key
  // is already idempotent, but this still checks first with loadImage() rather than
  // unconditionally re-writing, since the caller may have already resized/re-encoded the same
  // source image slightly differently on a later call and a blind put() would silently replace
  // a still-referenced record with different (if visually similar) bytes.
  //
  // Falls back to generateKey()'s plain random-key save when Web Crypto isn't available (an
  // unexpectedly old/restricted browser) -- dedup is a nice-to-have, not something that should
  // ever block a token from getting its portrait.
  //
  // IMPORTANT for callers: a key returned by this function may be referenced by more than one
  // token. Only ever pass a key to deleteImage() if you know it came from plain saveImage()
  // (a generateKey()-based key, guaranteed unique to one caller) -- see
  // ui/app.js's deleteTokenImageIfUnshared() for the "don't delete a maybe-shared image" guard
  // every token-image replace/clear path needs to use instead of calling deleteImage()
  // directly. Keys from this function are prefixed "sha256-" specifically so callers can
  // recognize and skip them.
  async function hashDataUrl(dataUrl) {
    const bytes = new TextEncoder().encode(dataUrl);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function saveImageDeduped(dataUrl) {
    if (!window.crypto?.subtle) {
      const key = generateKey("token");
      await saveImage(key, dataUrl);
      return key;
    }
    const key = `sha256-${await hashDataUrl(dataUrl)}`;
    const existing = await loadImage(key);
    if (!existing) await saveImage(key, dataUrl);
    return key;
  }

  window.CampaignOSImageStore = { generateKey, saveImage, loadImage, deleteImage, saveImageDeduped };
})();
