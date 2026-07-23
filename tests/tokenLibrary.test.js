const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScript } = require("./load-script");

// tokenLibrary.js only touches `indexedDB` inside functions that are called lazily
// (openDB), so loading the script in Node -- which has no indexedDB global -- is safe
// as long as we only exercise the pure, synchronous normalizeName() here. The actual
// IndexedDB read/write round trip is covered by a real-browser test instead.
const { CampaignOSTokenLibrary } = loadScript("ui/tokenLibrary.js");

test("normalizeName lowercases and strips a spawned monster's trailing instance number", () => {
  assert.equal(CampaignOSTokenLibrary.normalizeName("Goblin 3"), "goblin");
  assert.equal(CampaignOSTokenLibrary.normalizeName("GOBLIN"), "goblin");
  assert.equal(CampaignOSTokenLibrary.normalizeName("  Darkhawk  "), "darkhawk");
});

test("normalizeName leaves multi-word names without a trailing number untouched", () => {
  assert.equal(CampaignOSTokenLibrary.normalizeName("Sister Ysolde Marrow"), "sister ysolde marrow");
});

test("normalizeName only strips a number that is its own trailing word, not one embedded in the name", () => {
  // "Unit 731" ends in digits as a distinct word -> stripped, same rule spawned tokens rely on.
  assert.equal(CampaignOSTokenLibrary.normalizeName("Unit 731"), "unit");
  // "R2D2" has no space before the digits, so it is not a trailing "word" and stays whole.
  assert.equal(CampaignOSTokenLibrary.normalizeName("R2D2"), "r2d2");
});

test("normalizeName returns an empty string for empty or missing input", () => {
  assert.equal(CampaignOSTokenLibrary.normalizeName(""), "");
  assert.equal(CampaignOSTokenLibrary.normalizeName(undefined), "");
});
