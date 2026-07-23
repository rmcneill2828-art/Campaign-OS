const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScript } = require("./load-script");

// mapLibrary.js only touches `indexedDB` inside functions that are called lazily (openDB),
// so loading the script in Node -- which has no indexedDB global -- is safe as long as we
// only exercise the pure, synchronous normalizeName() here. The actual IndexedDB read/write
// round trip is covered by a real-browser test instead, same as tokenLibrary.js.
const { CampaignOSMapLibrary } = loadScript("ui/mapLibrary.js");

test("normalizeName trims and lowercases a map name", () => {
  assert.equal(CampaignOSMapLibrary.normalizeName("  The Standing Ring  "), "the standing ring");
  assert.equal(CampaignOSMapLibrary.normalizeName("URSKELDE"), "urskelde");
});

test("normalizeName does NOT strip a trailing number -- unlike tokens, maps aren't spawned in numbered instances", () => {
  assert.equal(CampaignOSMapLibrary.normalizeName("Level 2"), "level 2");
  assert.equal(CampaignOSMapLibrary.normalizeName("Floor 3"), "floor 3");
});

test("normalizeName returns an empty string for empty or missing input", () => {
  assert.equal(CampaignOSMapLibrary.normalizeName(""), "");
  assert.equal(CampaignOSMapLibrary.normalizeName(undefined), "");
});
