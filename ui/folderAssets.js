(function () {
  // Reads a connected FileSystemDirectoryHandle (a Maps folder, a Tokens folder) without
  // ever bulk-copying its contents into browser storage. Building an index only reads file
  // NAMES (cheap, metadata-only) -- actual file bytes are read one at a time, only for an
  // entry that's actually about to be used (a token that's about to spawn, a map the DM
  // picks), which is what keeps this safe at a scale (hundreds to thousands of files) that
  // copy-everything-into-IndexedDB was not.
  const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif)$/i;
  // Music Folder (Phase 10, 2026-08-22) reuses this exact same walk-and-index approach --
  // audio files are typically much larger than portrait/map images and can't be downscaled
  // the way an image can, so a folder connection (read one file at a time, nothing bulk-
  // copied) is the only safe storage model here, not an IndexedDB-uploaded library like the
  // Token/Map Library's. Common web-playable formats only; browser-native <audio> support
  // for anything beyond these varies too much to promise it'll actually play.
  const AUDIO_EXTENSION_PATTERN = /\.(mp3|ogg|wav|m4a|flac|opus|aac)$/i;

  function nameFromFileName(fileName) {
    return String(fileName || "")
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Walks a directory (subfolders included -- an asset pack's own category folders don't
  // need flattening first) and returns [{ name, key, handle }] for every image file found.
  // `normalizeKey` is the same normalizeName a caller's library module already uses
  // (tokenLibrary strips a trailing instance number, mapLibrary doesn't), so folder-sourced
  // and manually-uploaded entries match names the same way.
  // `extensionPattern` defaults to images (the only caller for the first year of this
  // function's life) -- Music Folder is the first caller to pass AUDIO_EXTENSION_PATTERN
  // explicitly instead.
  async function indexFolder(dirHandle, normalizeKey, extensionPattern) {
    const pattern = extensionPattern || IMAGE_EXTENSION_PATTERN;
    const entries = [];

    async function walk(handle) {
      for await (const [name, entryHandle] of handle.entries()) {
        if (entryHandle.kind === "directory") {
          await walk(entryHandle);
          continue;
        }
        if (!pattern.test(name)) continue;
        const displayName = nameFromFileName(name);
        const key = normalizeKey(displayName);
        if (key) entries.push({ name: displayName, key, handle: entryHandle });
      }
    }

    await walk(dirHandle);
    return entries;
  }

  // First indexed entry whose normalized key matches `name`, or null.
  function findInIndex(index, name, normalizeKey) {
    const target = normalizeKey(name);
    if (!target) return null;
    return index.find((entry) => entry.key === target) || null;
  }

  function readEntryAsDataUrl(entry) {
    return entry.handle.getFile().then((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(file);
    }));
  }

  // A Blob URL, not a data URL, for Music Folder's own use -- an <audio> element streams
  // from a blob: URL natively (seek/duration/partial-buffering all work immediately), where
  // a base64 data: URL both adds ~33% size overhead and forces the whole file to be read
  // into memory as a string before playback can start at all. Images use
  // readEntryAsDataUrl() instead because a data URL is what ends up persisted (in a token's
  // own state, in library IndexedDB records) -- audio here is never persisted anywhere, so
  // there's no reason to pay the data-URL cost. Caller must call
  // URL.revokeObjectURL(...) once done with it (when the track stops/changes) -- unrevoked
  // blob: URLs leak for the life of the page otherwise.
  function readEntryAsObjectUrl(entry) {
    return entry.handle.getFile().then((file) => URL.createObjectURL(file));
  }

  window.CampaignOSFolderAssets = {
    indexFolder,
    findInIndex,
    readEntryAsDataUrl,
    readEntryAsObjectUrl,
    nameFromFileName,
    AUDIO_EXTENSION_PATTERN
  };
})();
