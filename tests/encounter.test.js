const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScript } = require("./load-script");

const { CampaignOS } = loadScript("engine/encounter.js");

// rollDie/rollDice are Math.random-driven and not injectable, so tests that need a
// specific roll stub Math.random for the duration of the call. `sequence` is consumed
// in order; the last value repeats once exhausted.
function withRandom(sequence, fn) {
  const original = Math.random;
  let calls = 0;
  Math.random = () => {
    const value = sequence[Math.min(calls, sequence.length - 1)];
    calls += 1;
    return value;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function stateOnMap(mapName) {
  const state = CampaignOS.createState();
  state.mapName = mapName;
  return state;
}

test("createState returns an empty default state", () => {
  const state = CampaignOS.createState();
  assert.deepEqual(state, {
    mapName: "",
    maps: {},
    fogEnabled: false,
    selectedTokenId: null,
    log: [],
    tokens: []
  });
});

// spawnMonster itself is an internal helper (not part of window.CampaignOS) -- it's only
// reachable through parseCommand, so that's what these exercise.
test("parseCommand spawning goblins gives them their canonical stat block and increments numbering", () => {
  let state = stateOnMap("Urskelde");
  state = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one goblin")).state;
  const second = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one goblin"));

  const goblins = second.state.tokens.filter((t) => t.name.startsWith("Goblin"));
  assert.deepEqual(goblins.map((t) => t.name), ["Goblin 1", "Goblin 2"]);
  const first = goblins[0];
  assert.equal(first.hp, 7);
  assert.equal(first.maxHp, 7);
  assert.equal(first.ac, 15);
  assert.equal(first.attackBonus, 4);
  assert.equal(first.damageDice, "1d6+2");
});

test("parseCommand spawning an unlisted monster falls back to a generic stat block", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one orc"));
  const [orc] = result.state.tokens;
  assert.equal(orc.hp, 10);
  assert.equal(orc.ac, 13);
  assert.equal(orc.attackBonus, 3);
  assert.equal(orc.damageDice, "1d8+1");
});

test("addToken clamps HP/AC/attackBonus into their valid ranges and defaults missing fields", () => {
  const state = stateOnMap("Urskelde");
  const { token } = CampaignOS.addToken(state, { name: "Test Hero", hp: 9001, maxHp: 20 });
  assert.equal(token.hp, 20, "hp should clamp down to maxHp");
  assert.equal(token.ac, 12, "ac should default to 12 when not provided");
  assert.equal(token.attackBonus, 3, "attackBonus should default to 3 when not provided");
  assert.equal(token.damageDice, "1d6+1");
  assert.deepEqual(token.conditions, []);
});

test("applyDamage and applyHealing clamp HP within [0, maxHp]", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Target", hp: 10, maxHp: 10 });

  const overdamaged = CampaignOS.applyDamage(withToken, token.id, 999);
  assert.equal(overdamaged.tokens[0].hp, 0);

  const overhealed = CampaignOS.applyHealing(overdamaged, token.id, 999);
  assert.equal(overhealed.tokens[0].hp, 10);
});

test("attack always misses on a natural 1, regardless of attack bonus", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 50, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 1, hp: 10, maxHp: 10 }).state;
  const [attacker, target] = state.tokens;

  const result = withRandom([0], () => CampaignOS.attack(state, attacker.id, target.id));
  assert.match(result.message, /Miss\.$/);
  assert.equal(result.state.tokens.find((t) => t.id === target.id).hp, 10, "a miss should not apply damage");
});

test("attack doubles damage on a natural 20 that clears target AC", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, damageDice: "1d1", hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 10, hp: 10, maxHp: 10 }).state;
  const [attacker, target] = state.tokens;

  // Math.random -> ~1 for both the d20 (natural 20) and the damage die (max face, 1 on a d1).
  const result = withRandom([0.999999], () => CampaignOS.attack(state, attacker.id, target.id));
  assert.match(result.message, /Critical hit\./);
  assert.equal(result.state.tokens.find((t) => t.id === target.id).hp, 8, "1d1 critical should deal 2 damage (1 doubled)");
});

test("a natural 20 is an automatic critical hit even against an AC the attack bonus alone can't clear", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, damageDice: "1d1", hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 99, hp: 10, maxHp: 10 }).state;
  const [attacker, target] = state.tokens;

  const result = withRandom([0.999999], () => CampaignOS.attack(state, attacker.id, target.id));
  assert.match(result.message, /Critical hit\./);
  assert.equal(result.state.tokens.find((t) => t.id === target.id).hp, 8, "natural 20 should hit and double damage regardless of AC");
});

test("attack reports a miss when the roll is below target AC (and no natural 1/20 is in play)", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 25, hp: 10, maxHp: 10 }).state;
  const [attacker, target] = state.tokens;

  // Math.random -> 0.45 gives d20 = floor(0.45*20)+1 = 10, well under AC 25 and not a 1 or 20.
  const result = withRandom([0.45], () => CampaignOS.attack(state, attacker.id, target.id));
  assert.match(result.message, /Miss\.$/);
  assert.doesNotMatch(result.message, /Critical/);
});

test("attack returns a failure message when attacker or target cannot be found", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.attack(state, "missing-attacker", "missing-target");
  assert.equal(result.message, "Attack failed: attacker or target was not found.");
});

test("removeToken drops the token and reselects the next by initiative if it was selected", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "A", initiative: 5 }).state;
  state = CampaignOS.addToken(state, { name: "B", initiative: 15 }).state;
  const [tokenA, tokenB] = state.tokens;
  state.selectedTokenId = tokenA.id;

  const next = CampaignOS.removeToken(state, tokenA.id);
  assert.equal(next.tokens.length, 1);
  assert.equal(next.selectedTokenId, tokenB.id, "the higher-initiative survivor should become selected");
});

test("setTokenPosition refuses to move a token onto a tile another token already occupies", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "A" }).state;
  state = CampaignOS.addToken(state, { name: "B" }).state;
  const [tokenA, tokenB] = state.tokens;
  state = CampaignOS.setTokenPosition(state, tokenA.id, 6, 6);

  const blocked = CampaignOS.setTokenPosition(state, tokenB.id, 6, 6);
  assert.equal(blocked, state, "occupied tile should be rejected (same state reference returned)");

  // moving the *same* token onto the tile it already occupies is a harmless no-op, not "blocked"
  const selfMove = CampaignOS.setTokenPosition(state, tokenA.id, 6, 6);
  assert.equal(selfMove.tokens.find((t) => t.id === tokenA.id).x, 6);
});

test("toggleCondition adds then removes a condition", () => {
  let state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "A" });
  const withCondition = CampaignOS.toggleCondition(withToken, token.id, "Prone");
  assert.deepEqual(withCondition.tokens[0].conditions, ["Prone"]);
  const withoutCondition = CampaignOS.toggleCondition(withCondition, token.id, "Prone");
  assert.deepEqual(withoutCondition.tokens[0].conditions, []);
});

test("setMapGrid clamps grid size and repositions out-of-bounds tokens back onto the shrunk grid", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.setMapGrid(state, "Urskelde", 12, 8);
  state = CampaignOS.addToken(state, { name: "A" }).state;
  state = CampaignOS.setTokenPosition(state, state.tokens[0].id, 12, 8);

  const shrunk = CampaignOS.setMapGrid(state, "Urskelde", 4, 4);
  assert.equal(shrunk.maps.Urskelde.columns, 4);
  assert.equal(shrunk.maps.Urskelde.rows, 4);
  assert.equal(shrunk.tokens[0].x, 4, "token x should clamp into the new, smaller grid");
  assert.equal(shrunk.tokens[0].y, 4, "token y should clamp into the new, smaller grid");

  const tooSmall = CampaignOS.setMapGrid(state, "Urskelde", 1, 1);
  assert.equal(tooSmall.maps.Urskelde.columns, 4, "columns should clamp up to the minimum of 4");
});

test("sortByInitiative sorts descending and breaks ties alphabetically", () => {
  const tokens = [
    { name: "Zed", initiative: 10 },
    { name: "Amy", initiative: 10 },
    { name: "Mid", initiative: 15 }
  ];
  const sorted = CampaignOS.sortByInitiative(tokens).map((t) => t.name);
  assert.deepEqual(sorted, ["Mid", "Amy", "Zed"]);
});

test("parseCommand resolves an attack command by token name", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1", attackBonus: 0, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Darkhawk", ac: 1, hp: 10, maxHp: 10 }).state;

  const result = withRandom([0], () => CampaignOS.parseCommand(state, "Goblin 1 attacks Darkhawk."));
  assert.match(result.message, /Goblin 1 attacks Darkhawk/);
});

test("parseCommand spawns the requested number of monsters from natural-language phrasing", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "Three goblins emerge from the trees."));
  const goblinTokens = result.state.tokens.filter((t) => t.name.startsWith("Goblin"));
  assert.equal(goblinTokens.length, 3);
  assert.equal(result.message, "Goblin 1, Goblin 2, Goblin 3 joined the encounter.");
});

test("parseCommand falls back to an unhandled message for unrecognized narration", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.parseCommand(state, "The rain begins to fall.");
  assert.equal(result.message, "I understood the narration, but no tool action matched yet.");
});
