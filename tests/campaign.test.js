const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScript } = require("./load-script");

const { CampaignOSCampaign } = loadScript("engine/campaign.js");

// Mimics a browser File: importMarkdownFiles only calls .name, .webkitRelativePath,
// .lastModified, and the async .text() method, so a plain object is enough.
function fakeFile(relativePath, text) {
  return {
    name: relativePath.split(/[\\/]/).pop(),
    webkitRelativePath: relativePath,
    lastModified: Date.now(),
    text: async () => text
  };
}

test("classify() sorts real campaign paths into their expected categories", () => {
  assert.equal(CampaignOSCampaign.classify("Campaign/active.md", "# Active Campaign"), "notes");
  assert.equal(CampaignOSCampaign.classify("Campaign/campaigns/blood-debt/overview.md", "# Blood Debt"), "notes");
  assert.equal(CampaignOSCampaign.classify("Campaign/characters/Darkhawk Blondin.md", "# Darkhawk Blondin"), "characters");
});

test("classify() treats world-state.md as notes, not a single mislabeled location", () => {
  // Regression test: world-state.md used to be hard-classified as category "locations",
  // which meant the whole living-tracker file showed up as one nonsensical "location"
  // instead of the real named places inside its table (see extractLocationEntries below).
  assert.equal(CampaignOSCampaign.classify("Campaign/campaigns/blood-debt/world-state.md", "# World State"), "notes");
});

test("classify() treats session-log.md as notes, not one giant undifferentiated session", () => {
  // Same reasoning as world-state.md: the real, individually browsable entries now
  // come from extractSessionEntries splitting this file's ## Session N headings.
  assert.equal(CampaignOSCampaign.classify("Campaign/campaigns/blood-debt/session-log.md", "# Session Log"), "notes");
});

test("isTemplatePath() recognizes this campaign format's underscore-prefixed templates", () => {
  assert.equal(CampaignOSCampaign.isTemplatePath("Campaign/characters/_template.md"), true);
  assert.equal(CampaignOSCampaign.isTemplatePath("Campaign/campaigns/_template/overview.md"), true);
  assert.equal(CampaignOSCampaign.isTemplatePath("Campaign/campaigns/_template/world-state.md"), true);
});

test("isTemplatePath() does not false-positive on real files that merely contain 'template'-like text", () => {
  assert.equal(CampaignOSCampaign.isTemplatePath("Campaign/characters/Darkhawk Blondin.md"), false);
  assert.equal(CampaignOSCampaign.isTemplatePath("Campaign/characters/Templeton.md"), false);
});

test("canSpawnCharacterToken() is true only for real character-folder files", () => {
  assert.equal(CampaignOSCampaign.canSpawnCharacterToken("Campaign/characters/Darkhawk Blondin.md", "characters"), true);
  assert.equal(CampaignOSCampaign.canSpawnCharacterToken("Campaign/active.md", "notes"), false);
  assert.equal(CampaignOSCampaign.canSpawnCharacterToken("Campaign/campaigns/blood-debt/overview.md", "notes"), false);
});

test("importMarkdownFiles extracts each row of a world-state 'Known Locations' table as its own location item", async () => {
  const worldState = [
    "# World State -- Blood Debt",
    "",
    "## Known Locations -- current status",
    "| Location | Status |",
    "|----------|--------|",
    "| Kessick's Ford | Home base for Corwin, Tomas, Halvard, Kell |",
    "| **Urskelde** (formerly Ashpit/the mine/\"the Bear Cave\") | Home base, stable without the party present. |",
    "| The Standing Ring (deep Greyhorn Range) | Opened, seal freshly reinforced. |",
    "",
    "## Active Quest Log",
    "- Prepare Urskelde for new arrivals."
  ].join("\n");

  const campaign = await CampaignOSCampaign.importMarkdownFiles([
    fakeFile("Campaign/campaigns/blood-debt/world-state.md", worldState)
  ]);

  assert.equal(campaign.categories.notes.length, 1, "the source world-state.md file itself should file under notes");
  assert.equal(campaign.categories.locations.length, 3);

  const titles = campaign.categories.locations.map((item) => item.title);
  assert.deepEqual(titles, ["Kessick's Ford", "Urskelde", "The Standing Ring"]);
  assert.ok(campaign.categories.locations.every((item) => item.canSpawnToken === false));
  assert.ok(campaign.categories.locations.every((item) => item.sourceKind === "location-entry"));
});

test("importMarkdownFiles produces no location entries from an empty template locations table", async () => {
  const templateWorldState = [
    "# World State",
    "",
    "## Locations Discovered",
    "| Name | Notes |",
    "|------|-------|"
  ].join("\n");

  const campaign = await CampaignOSCampaign.importMarkdownFiles([
    fakeFile("Campaign/campaigns/_template/world-state.md", templateWorldState)
  ]);

  assert.equal(campaign.categories.locations.length, 0);
  assert.equal(campaign.categories.notes[0].isTemplate, true);
});

test("importMarkdownFiles splits session-log.md's ## Session N headings into individually browsable sessions", async () => {
  const sessionLog = [
    "# Session Log -- Blood Debt",
    "",
    "## Session 1 -- 2026-07-11",
    "",
    "Darkhawk arrives in Kessick's Ford and finds a suspicious hire notice.",
    "",
    "## Session 2 -- 2026-07-18",
    "",
    "The party investigates the Dead Ground and finds signs of the Circuit.",
    "",
    "## Session 15 -- 2026-08-15",
    "",
    "Duskgate falls; the Warden's bargain is broken for good."
  ].join("\n");

  const campaign = await CampaignOSCampaign.importMarkdownFiles([
    fakeFile("Campaign/campaigns/blood-debt/session-log.md", sessionLog)
  ]);

  assert.equal(campaign.categories.notes.length, 1, "the source session-log.md file itself should file under notes");
  assert.equal(campaign.categories.sessions.length, 3);

  const titles = campaign.categories.sessions.map((item) => item.title);
  assert.deepEqual(titles, ["Session 1 -- 2026-07-11", "Session 2 -- 2026-07-18", "Session 15 -- 2026-08-15"]);

  const session15 = campaign.categories.sessions.find((item) => item.title.startsWith("Session 15"));
  assert.match(session15.summary, /Duskgate falls/);
  assert.equal(session15.canSpawnToken, false);
  assert.equal(session15.sourceKind, "session-entry");
});

test("importMarkdownFiles produces no session entries from a session-log.md with no ## Session N headings", async () => {
  const campaign = await CampaignOSCampaign.importMarkdownFiles([
    fakeFile("Campaign/campaigns/blood-debt/session-log.md", "# Session Log\n\nNothing logged yet.")
  ]);
  assert.equal(campaign.categories.sessions.length, 0);
});

test("tokenDraftFromItem reads HP/AC from flat fields and attack/damage from the Attacks table's first row", () => {
  const sheet = [
    "# Darkhawk Blondin",
    "",
    "## Combat",
    "- **AC:** 17 (fitted breastplate...)",
    "- **HP:** 117 / 117",
    "- **Initiative bonus:** +1, with advantage (Feral Instinct)",
    "",
    "### Attacks",
    "Dual-wielding two longswords.",
    "",
    "| | To Hit | Damage (not raging) | Damage (raging) |",
    "|---|---|---|---|",
    "| Main-hand longsword | +10 | 1d8+5 slashing | 1d8+7 slashing |",
    "| Off-hand longsword | +10 | 1d8+5 slashing | 1d8+7 slashing |"
  ].join("\n");

  const draft = CampaignOSCampaign.tokenDraftFromItem({ title: "Darkhawk Blondin", path: "characters/Darkhawk Blondin.md", text: sheet });

  assert.equal(draft.hp, 117);
  assert.equal(draft.maxHp, 117);
  assert.equal(draft.ac, 17);
  assert.equal(draft.attackBonus, 10, "should read the leftmost damage column's matching To Hit value, not the generic default of 3");
  assert.equal(draft.damageDice, "1d8+5", "should pick the leftmost (non-raging) Damage column, not the raging one");
});

test("tokenDraftFromItem strips a conditional bonus clause out of a damage cell", () => {
  const sheet = [
    "### Attacks",
    "| | To Hit | Damage |",
    "|---|---|---|",
    "| Fletch's longbow | +12 | 1d8+5 piercing (+1d6 if Hunter's Mark active) |"
  ].join("\n");

  const draft = CampaignOSCampaign.tokenDraftFromItem({ title: "Mara Fenn", path: "characters/Mara Fenn.md", text: sheet });
  assert.equal(draft.attackBonus, 12);
  assert.equal(draft.damageDice, "1d8+5", "the conditional +1d6 clause should not leak into the base damage notation");
});

test("tokenDraftFromItem falls back to generic defaults when there is no Attacks table at all", () => {
  const sheet = ["# Character Name", "", "## Combat", "- **AC:** --", "- **HP:** -- / --"].join("\n");
  const draft = CampaignOSCampaign.tokenDraftFromItem({ title: "Character Name", path: "characters/_template.md", text: sheet });

  assert.equal(draft.attackBonus, 3);
  assert.equal(draft.damageDice, "1d6+1");
  assert.equal(draft.hp, 12, "HP should fall back to the generic default when the field has no digits");
});

test("tokenDraftFromItem rolls initiative from the sheet's initiative bonus rather than using a frozen number", () => {
  const sheet = ["### Combat", "- **Initiative bonus:** +8 (DEX +5, plus WIS +3)"].join("\n");
  const item = { title: "Mara Fenn", path: "characters/Mara Fenn.md", text: sheet };

  const original = Math.random;
  try {
    Math.random = () => 0; // rollDie(20) -> 1
    assert.equal(CampaignOSCampaign.tokenDraftFromItem(item).initiative, 9);
    Math.random = () => 0.999999; // rollDie(20) -> 20
    assert.equal(CampaignOSCampaign.tokenDraftFromItem(item).initiative, 28);
  } finally {
    Math.random = original;
  }
});
