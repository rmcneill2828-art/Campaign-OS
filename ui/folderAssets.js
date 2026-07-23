(function () {
  // Reads a connected FileSystemDirectoryHandle (a Maps folder, a Tokens folder) without
  // ever bulk-copying its contents into browser storage. Building an index only reads file
  // NAMES (cheap, metadata-only) -- actual file bytes are read one at a time, only for an
  // entry that's actually about to be used (a token that's about to spawn, a map the DM
  // picks), which is what keeps this safe at a scale (hundreds to thousands of files) that
  // copy-everything-into-IndexedDB was not.
  const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif)$/i;

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
  async function indexFolder(dirHandle, normalizeKey) {
    const entries = [];

    async function walk(handle) {
      for await (const [name, entryHandle] of handle.entries()) {
        if (entryHandle.kind === "directory") {
          await walk(entryHandle);
          continue;
        }
        if (!IMAGE_EXTENSION_PATTERN.test(name)) continue;
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

  window.CampaignOSFolderAssets = { indexFolder, findInIndex, readEntryAsDataUrl, nameFromFileName };
})();
