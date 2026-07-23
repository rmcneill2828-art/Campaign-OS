const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScript } = require("./load-script");

// indexFolder/readEntryAsDataUrl touch the File System Access API (FileSystemDirectoryHandle,
// FileReader), not available under Node -- those are verified in-browser, same as the
// IndexedDB-backed library modules. nameFromFileName and findInIndex are pure and exercised
// here.
const { CampaignOSFolderAssets } = loadScript("ui/folderAssets.js");

test("nameFromFileName strips the extension and normalizes separators, matching the upload-form helper", () => {
  assert.equal(CampaignOSFolderAssets.nameFromFileName("orc-warrior.png"), "orc warrior");
  assert.equal(CampaignOSFolderAssets.nameFromFileName("Abandoned_Temple_HD.jpg"), "Abandoned Temple HD");
  assert.equal(CampaignOSFolderAssets.nameFromFileName("goblin.PNG"), "goblin");
});

test("findInIndex matches by the caller's normalizeKey function, same as the library modules use", () => {
  const normalizeName = (name) => String(name || "").trim().toLowerCase().replace(/\s+\d+$/, "");
  const index = [
    { name: "Goblin", key: normalizeName("Goblin"), handle: "goblin-handle" },
    { name: "The Standing Ring", key: normalizeName("The Standing Ring"), handle: "ring-handle" }
  ];

  assert.equal(CampaignOSFolderAssets.findInIndex(index, "Goblin 3", normalizeName).handle, "goblin-handle");
  assert.equal(CampaignOSFolderAssets.findInIndex(index, "the standing ring", normalizeName).handle, "ring-handle");
  assert.equal(CampaignOSFolderAssets.findInIndex(index, "Nonexistent", normalizeName), null);
});

test("findInIndex returns null for an empty or missing name", () => {
  const normalizeName = (name) => String(name || "").trim().toLowerCase();
  assert.equal(CampaignOSFolderAssets.findInIndex([{ name: "A", key: "a" }], "", normalizeName), null);
  assert.equal(CampaignOSFolderAssets.findInIndex([{ name: "A", key: "a" }], undefined, normalizeName), null);
});
