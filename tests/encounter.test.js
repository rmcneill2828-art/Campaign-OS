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
    tokens: [],
    turn: { tokenId: null, round: 0 }
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

test("parseCommand spawning orcs gives them their canonical (SRD) stat block, distinct from goblins", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one orc"));
  const [orc] = result.state.tokens;
  assert.equal(orc.hp, 15);
  assert.equal(orc.ac, 13);
  assert.equal(orc.attackBonus, 5);
  assert.equal(orc.damageDice, "1d12+3");
});

test("parseCommand spawning a troll gives it Multiattack (Bite + two Claws), not a single generic attack", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one troll"));
  const [troll] = result.state.tokens;
  assert.equal(troll.hp, 84);
  assert.equal(troll.ac, 15);
  assert.equal(troll.attacks.length, 3);
  assert.deepEqual(troll.attacks.map((a) => a.name), ["Bite", "Claw", "Claw"]);
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

test("addToken carries a draft's Multiattack array (attacks[]) onto the token when there's more than one entry", () => {
  const state = stateOnMap("Urskelde");
  const attacks = [
    { name: "Claw", attackBonus: 8, damageDice: "1d8+4" },
    { name: "Claw", attackBonus: 8, damageDice: "1d8+4" },
    { name: "Sting", attackBonus: 8, damageDice: "2d8+4" }
  ];
  const { token } = CampaignOS.addToken(state, { name: "Malphestor", hp: 142, maxHp: 142, attacks });
  assert.deepEqual(token.attacks, attacks);
});

test("addToken ignores a single-entry attacks array (not a real Multiattack)", () => {
  const state = stateOnMap("Urskelde");
  const { token } = CampaignOS.addToken(state, { name: "Vale", attacks: [{ name: "Rapier", attackBonus: 3, damageDice: "1d8+1" }] });
  assert.equal(token.attacks, undefined);
});

test("applyDamage and applyHealing clamp HP within [0, maxHp]", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Target", hp: 10, maxHp: 10 });

  const overdamaged = CampaignOS.applyDamage(withToken, token.id, 999);
  assert.equal(overdamaged.state.tokens[0].hp, 0);
  assert.match(overdamaged.message, /Target drops to 0 HP and starts making death saves\./);

  const overhealed = CampaignOS.applyHealing(overdamaged.state, token.id, 999);
  assert.equal(overhealed.tokens[0].hp, 10);
  assert.equal(overhealed.tokens[0].dying, undefined, "healing back above 0 should clear the death-save tracker");
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

test("a critical hit doubles the damage dice only, not a flat modifier (RAW)", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, damageDice: "1d4+3", hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 1, hp: 50, maxHp: 50 }).state;
  const [attacker, target] = state.tokens;

  // Math.random -> ~1 gives a natural 20 and a max-face 1d4 (4).
  const result = withRandom([0.999999], () => CampaignOS.attack(state, attacker.id, target.id));
  assert.match(result.message, /Critical hit\./);
  // Correct: (4 * 2) + 3 = 11. The old bug would have doubled to (4 + 3) * 2 = 14.
  assert.equal(result.state.tokens.find((t) => t.id === target.id).hp, 39, "1d4+3 critical should deal 11 damage, not 14");
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

test("attack with advantage rolls two d20s and keeps the higher", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 15, hp: 10, maxHp: 10 }).state;
  const [attacker, target] = state.tokens;

  // rollDie(20) from 0.2 -> 5, from 0.85 -> 18. Advantage should keep 18 (a hit vs AC 15);
  // a normal roll of just the first die (5) would have missed.
  const result = withRandom([0.2, 0.85], () => CampaignOS.attack(state, attacker.id, target.id, { advantage: true }));
  assert.match(result.message, /18 \(advantage: 5, 18\)/);
  assert.match(result.message, /Hit\./);
});

test("attack with disadvantage rolls two d20s and keeps the lower", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 15, hp: 10, maxHp: 10 }).state;
  const [attacker, target] = state.tokens;

  // Same two rolls (5, 18) but disadvantage keeps the lower: 5, a miss vs AC 15.
  const result = withRandom([0.2, 0.85], () => CampaignOS.attack(state, attacker.id, target.id, { disadvantage: true }));
  assert.match(result.message, /5 \(disadvantage: 5, 18\)/);
  assert.match(result.message, /Miss\./);
});

test("attack against a token with a Multiattack profile (attacks[]) rolls every sub-attack and labels each by name", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Troll 1", attackBonus: 7, damageDice: "1d6+4", hp: 84, maxHp: 84 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 5, hp: 50, maxHp: 50 }).state;
  const [troll, target] = state.tokens;
  troll.attacks = [
    { name: "Bite", attackBonus: 7, damageDice: "1d6+4" },
    { name: "Claw", attackBonus: 7, damageDice: "2d6+4" },
    { name: "Claw", attackBonus: 7, damageDice: "2d6+4" }
  ];

  // 0.5 -> d20 = 11 (hits AC 5 every time, never a crit); damage dice also resolve off the
  // same repeating value: 1d6 -> 4 (+4 = 8), 2d6 -> 4+4 (+4 = 12) each. Total: 8+12+12 = 32.
  const result = withRandom([0.5], () => CampaignOS.attack(state, troll.id, target.id));
  assert.match(result.message, /Troll 1's Bite attacks Target/);
  assert.match(result.message, /Troll 1's Claw attacks Target/);
  assert.equal((result.message.match(/Troll 1's Claw/g) || []).length, 2, "both claw attacks should appear");
  assert.equal(result.state.tokens.find((t) => t.id === target.id).hp, 18, "50 - (8 + 12 + 12) = 18");
});

test("Multiattack stops rolling further sub-attacks once the target is already dropped to 0 HP", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Troll 1", attackBonus: 7, damageDice: "1d6+4", hp: 84, maxHp: 84 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 1, hp: 5, maxHp: 5 }).state;
  const [troll, target] = state.tokens;
  troll.attacks = [
    { name: "Bite", attackBonus: 7, damageDice: "1d6+4" },
    { name: "Claw", attackBonus: 7, damageDice: "2d6+4" },
    { name: "Claw", attackBonus: 7, damageDice: "2d6+4" }
  ];

  const result = withRandom([0.5], () => CampaignOS.attack(state, troll.id, target.id));
  assert.equal((result.message.match(/attacks Target/g) || []).length, 1, "only the first sub-attack should resolve once the target is at 0 HP");
  assert.equal(result.state.tokens.find((t) => t.id === target.id).hp, 0);
});

test("nextTurn starts round 1 at the highest-initiative token, then advances in order", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Low", initiative: 5 }).state;
  state = CampaignOS.addToken(state, { name: "High", initiative: 20 }).state;
  state = CampaignOS.addToken(state, { name: "Mid", initiative: 12 }).state;

  const round1 = CampaignOS.nextTurn(state);
  assert.deepEqual(round1.turn, { tokenId: round1.tokens.find((t) => t.name === "High").id, round: 1 });

  const stillRound1 = CampaignOS.nextTurn(round1);
  assert.equal(stillRound1.turn.tokenId, stillRound1.tokens.find((t) => t.name === "Mid").id);
  assert.equal(stillRound1.turn.round, 1);
});

test("nextTurn wraps back to the top of initiative order and increments the round", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "A", initiative: 10 }).state;
  state = CampaignOS.addToken(state, { name: "B", initiative: 5 }).state;

  let next = CampaignOS.nextTurn(state); // A, round 1
  next = CampaignOS.nextTurn(next); // B, round 1
  next = CampaignOS.nextTurn(next); // back to A, round 2

  assert.equal(next.turn.tokenId, next.tokens.find((t) => t.name === "A").id);
  assert.equal(next.turn.round, 2);
});

test("nextTurn resets the newly active token's movement budget for the new turn", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "A", initiative: 10, speed: 30 }).state;
  const tokenId = state.tokens[0].id;
  state.tokens[0].movementUsed = 25;
  state.tokens[0].diagonalStepsThisTurn = 3;

  const next = CampaignOS.nextTurn(state);
  const token = next.tokens.find((t) => t.id === tokenId);
  assert.equal(token.movementUsed, 0);
  assert.equal(token.diagonalStepsThisTurn, 0);
});

test("moveToken moves freely (no speed check) when the token isn't the active turn", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Bystander", speed: 5 }).state; // tiny speed, no active turn
  const token = state.tokens[0];

  const result = CampaignOS.moveToken(state, token.id, token.x + 10, token.y);
  assert.match(result.message, /moves to/);
  assert.notEqual(result.state, state);
});

test("moveToken enforces the active token's speed and rejects a move that costs too much", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Slow", speed: 10, initiative: 10 }).state; // 2 squares at 5 ft/square
  const token = state.tokens[0];
  state = CampaignOS.nextTurn(state); // makes Slow the active turn, movementUsed reset to 0

  // Straight-line move 3 squares east = 15 ft, more than the 10 ft speed allows.
  const blocked = CampaignOS.moveToken(state, token.id, token.x + 3, token.y);
  assert.equal(blocked.state, state, "an unaffordable move should be rejected (same state reference)");
  assert.match(blocked.message, /can't reach/);
  assert.match(blocked.message, /needs 15 ft/);
  assert.match(blocked.message, /10 ft left this turn \(speed 10 ft\)/);

  // Exactly 2 squares (10 ft) should be affordable.
  const allowed = CampaignOS.moveToken(state, token.id, token.x + 2, token.y);
  assert.notEqual(allowed.state, state);
  const movedToken = allowed.state.tokens.find((t) => t.id === token.id);
  assert.equal(movedToken.x, token.x + 2);
  assert.equal(movedToken.movementUsed, 10);
});

test("moveToken charges diagonal movement at the RAW alternating 5/10 ft rate, carrying parity across separate moves", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Rook", speed: 30, initiative: 10 }).state;
  const token = state.tokens[0];
  state = CampaignOS.nextTurn(state);

  // Move 2 squares diagonally: 1st diagonal = 5 ft, 2nd diagonal = 10 ft -> 15 ft total.
  const first = CampaignOS.moveToken(state, token.id, token.x + 2, token.y + 2);
  const afterFirst = first.state.tokens.find((t) => t.id === token.id);
  assert.equal(afterFirst.movementUsed, 15);
  assert.equal(afterFirst.diagonalStepsThisTurn, 2);

  // A 3rd diagonal square continues the alternation from where it left off (parity carries
  // across separate moveToken calls within the same turn): 3rd diagonal = 5 ft again.
  const second = CampaignOS.moveToken(first.state, token.id, afterFirst.x + 1, afterFirst.y + 1);
  assert.match(second.message, /5 ft/);
  const afterSecond = second.state.tokens.find((t) => t.id === token.id);
  assert.equal(afterSecond.movementUsed, 20);
  assert.equal(afterSecond.diagonalStepsThisTurn, 3);
});

test("setMapView stores feetPerSquare (defaulting to 5) and moveToken's cost scales with it", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.setMapView(state, "Urskelde", { feetPerSquare: 10 });
  assert.equal(CampaignOS.feetPerSquare(state), 10);

  state = CampaignOS.addToken(state, { name: "Giant Strider", speed: 30, initiative: 10 }).state;
  const token = state.tokens[0];
  state = CampaignOS.nextTurn(state);

  // 2 squares straight at 10 ft/square = 20 ft, leaving exactly 10 ft of a 30 ft speed.
  const result = CampaignOS.moveToken(state, token.id, token.x + 2, token.y);
  const moved = result.state.tokens.find((t) => t.id === token.id);
  assert.equal(moved.movementUsed, 20);
});

test("hasRealMapData is true only once a map has real art or a campaign sourcePath", () => {
  let state = stateOnMap("Urskelde");
  assert.equal(CampaignOS.hasRealMapData(state, "Urskelde"), false, "a bare map name with no art/sourcePath isn't real map data yet");

  state = CampaignOS.setMapImage(state, "Urskelde", "image-key-123");
  assert.equal(CampaignOS.hasRealMapData(state, "Urskelde"), true);
  assert.equal(CampaignOS.hasRealMapData(state, "Nonexistent Map"), false);
});

test("setActiveMap switches to an already-prepared map and rejects one with no real data", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.setMapImage(state, "The Standing Ring", "image-key-456");

  const switched = CampaignOS.setActiveMap(state, "The Standing Ring");
  assert.equal(switched.mapName, "The Standing Ring");

  const rejected = CampaignOS.setActiveMap(state, "Nowhere Prepared");
  assert.equal(rejected, state, "switching to an unprepared map should be rejected (same state reference)");
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

test("parseCommand strips a trailing 'with advantage' phrase before resolving the target name", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1", attackBonus: 0, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Darkhawk", ac: 15, hp: 10, maxHp: 10 }).state;

  const result = withRandom([0.2, 0.85], () => CampaignOS.parseCommand(state, "Goblin 1 attacks Darkhawk with advantage."));
  assert.match(result.message, /Goblin 1 attacks Darkhawk/);
  assert.match(result.message, /advantage: 5, 18/);
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

test("abilityModifier follows the standard 5e modifier table", () => {
  assert.equal(CampaignOS.abilityModifier(10), 0);
  assert.equal(CampaignOS.abilityModifier(16), 3);
  assert.equal(CampaignOS.abilityModifier(8), -1);
  assert.equal(CampaignOS.abilityModifier(1), -5);
});

test("rollSavingThrow uses the token's ability modifier when no explicit save bonus is recorded", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael", abilityScores: { WIS: 16 } });
  const result = withRandom([9 / 20], () => CampaignOS.rollSavingThrow(withToken, token.id, "wisdom", 12));
  assert.equal(result.success, true);
  assert.equal(result.total, 13); // roll 10 + WIS mod (+3)
  assert.match(result.message, /Sael rolls a WIS save: 10 \+3 = 13 vs DC 12\. Success\./);
});

test("rollSavingThrow prefers an explicit stated save bonus over the raw ability modifier", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    abilityScores: { WIS: 10 }, // +0 modifier alone would fail this save
    savingThrows: { WIS: 6 } // stated bonus (feat/multiclass) overrides the flat modifier
  });
  const result = withRandom([4 / 20], () => CampaignOS.rollSavingThrow(withToken, token.id, "WIS", 10));
  assert.equal(result.total, 11); // roll 5 + stated bonus 6
  assert.equal(result.success, true);
});

test("rollSavingThrow reports failure when the total doesn't meet the DC", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Mara", abilityScores: { DEX: 10 } });
  const result = withRandom([0], () => CampaignOS.rollSavingThrow(withToken, token.id, "dex", 15));
  assert.equal(result.success, false);
  assert.match(result.message, /Failure\.$/);
});

test("rollSavingThrow rejects an unrecognized ability without changing state", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Ysolde" });
  const result = CampaignOS.rollSavingThrow(withToken, token.id, "luck", 10);
  assert.equal(result.success, false);
  assert.match(result.message, /not a valid ability/);
  assert.deepEqual(result.state, withToken);
});

test("rollSavingThrow reports the token as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.rollSavingThrow(state, "nonexistent-id", "str", 10);
  assert.match(result.message, /token was not found/);
  assert.deepEqual(result.state, state);
});

test("addToken normalizes ability scores -- clamping out-of-range values and leaving unset abilities absent", () => {
  const state = stateOnMap("Urskelde");
  const { token } = CampaignOS.addToken(state, { name: "Odd Scores", abilityScores: { STR: 99, DEX: -5, CON: 14 } });
  assert.deepEqual(token.abilityScores, { STR: 30, DEX: 1, CON: 14 });
});

test("updateToken merges a partial ability-score change without wiping previously-set abilities", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Grows Over Time", abilityScores: { STR: 16, DEX: 12 } });
  const updated = CampaignOS.updateToken(withToken, token.id, { abilityScores: { WIS: 14 } });
  const found = updated.tokens.find((t) => t.id === token.id);
  assert.deepEqual(found.abilityScores, { STR: 16, DEX: 12, WIS: 14 });
});

test("updateToken merges a partial saving-throw override without wiping previously-set ones", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Feats Over Time", savingThrows: { STR: 8 } });
  const updated = CampaignOS.updateToken(withToken, token.id, { savingThrows: { WIS: 6 } });
  const found = updated.tokens.find((t) => t.id === token.id);
  assert.deepEqual(found.savingThrows, { STR: 8, WIS: 6 });
});

test("spawned monsters get their real SRD ability scores, including the corrected troll Dex", () => {
  const state = stateOnMap("Urskelde");
  const goblin = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one goblin")).state.tokens[0];
  assert.deepEqual(goblin.abilityScores, { STR: 8, DEX: 14, CON: 10, INT: 10, WIS: 8, CHA: 8 });

  const troll = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one troll")).state.tokens[0];
  assert.deepEqual(troll.abilityScores, { STR: 18, DEX: 13, CON: 20, INT: 7, WIS: 9, CHA: 7 });
  assert.equal(troll.initiative, 2); // roll 1 (Math.random stubbed to 0) + the corrected Dex mod (+1)
});

test("parseCommand resolves a saving throw command by token name", () => {
  let state = stateOnMap("Urskelde");
  state = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one goblin")).state;
  const result = withRandom([9 / 20], () => CampaignOS.parseCommand(state, "Goblin 1 rolls a wisdom saving throw against DC 10"));
  // Goblin's WIS is 8 (-1 mod): roll 10 - 1 = 9, vs DC 10 -> failure.
  assert.equal(result.success, false);
  assert.match(result.message, /Goblin 1 rolls a WIS save: 10 -1 = 9 vs DC 10\. Failure\./);
});

test("addToken normalizes spell slots and spellcasting, clamping out-of-range values", () => {
  const state = stateOnMap("Urskelde");
  const { token } = CampaignOS.addToken(state, {
    name: "Mara Fenn",
    spellcasting: { saveDC: 99, attackBonus: 8 },
    spellSlots: { 1: { max: 4, current: 4 }, 2: { max: 3, current: 10 }, 10: { max: 5, current: 5 } }
  });
  assert.deepEqual(token.spellcasting, { saveDC: 30, attackBonus: 8 });
  assert.deepEqual(token.spellSlots, {
    1: { max: 4, current: 4 },
    2: { max: 3, current: 3 } // current clamped down to max
    // level 10 is out of the valid 1-9 range and is dropped entirely
  });
});

test("updateToken merges a partial spell-slot change without wiping other levels", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    spellSlots: { 1: { max: 4, current: 4 }, 2: { max: 3, current: 3 } }
  });
  const updated = CampaignOS.updateToken(withToken, token.id, { spellSlots: { 2: { max: 3, current: 2 } } });
  const found = updated.tokens.find((t) => t.id === token.id);
  assert.deepEqual(found.spellSlots, {
    1: { max: 4, current: 4 },
    2: { max: 3, current: 2 }
  });
});

test("castSpell consumes a spell slot and logs which level it used", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Mara Fenn",
    spellSlots: { 1: { max: 4, current: 4 } }
  });
  const result = CampaignOS.castSpell(withToken, token.id, { level: 1, spellName: "Cure Wounds" });
  assert.match(result.message, /Mara Fenn casts Cure Wounds using a 1st-level spell slot \(3 remaining\)\./);
  const found = result.state.tokens.find((t) => t.id === token.id);
  assert.equal(found.spellSlots[1].current, 3);
});

test("castSpell fails without changing state once a level's slots are exhausted", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    spellSlots: { 1: { max: 1, current: 0 } }
  });
  const result = CampaignOS.castSpell(withToken, token.id, { level: 1, spellName: "Entangle" });
  assert.match(result.message, /Sael has no 1st-level spell slots remaining\./);
  assert.equal(result.state, withToken, "a failed cast should not change state");
});

test("castSpell treats level 0 as a cantrip -- never consumes a slot", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Ysolde" });
  const result = CampaignOS.castSpell(withToken, token.id, { level: 0, spellName: "Guidance" });
  assert.match(result.message, /Ysolde casts Guidance\./);
});

test("castSpell rolls a spell attack against a target using the caster's stated spell attack bonus", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, {
    name: "Ysolde",
    spellcasting: { attackBonus: 9 },
    spellSlots: { 1: { max: 4, current: 4 } }
  }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", ac: 15, hp: 10, maxHp: 10 }).state;
  const [caster, target] = state.tokens;

  // d20 roll of 15 (0.7 * 20 = 14, +1 = 15) + 9 = 24 vs AC 15 -> hit; damage roll 1d6 -> 4 (0.5*6=3,+1=4).
  const result = withRandom([0.7, 0.5], () => CampaignOS.castSpell(state, caster.id, {
    level: 1,
    spellName: "Guiding Bolt",
    targetId: target.id,
    damageDice: "1d6"
  }));
  assert.match(result.message, /using a 1st-level spell slot/);
  assert.match(result.message, /Ysolde's Guiding Bolt attacks Goblin 1.*Hit\. Damage 4/);
  const foundTarget = result.state.tokens.find((t) => t.id === target.id);
  assert.equal(foundTarget.hp, 6);
});

test("castSpell skips the attack roll and says so when the caster has no stated spell attack bonus", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Novice" }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", hp: 10, maxHp: 10 }).state;
  const [caster, target] = state.tokens;

  const result = CampaignOS.castSpell(state, caster.id, { level: 0, spellName: "Fire Bolt", targetId: target.id });
  assert.match(result.message, /no stated spell attack bonus for Novice -- attack roll skipped/);
  const foundTarget = result.state.tokens.find((t) => t.id === target.id);
  assert.equal(foundTarget.hp, 10, "no damage should be applied when the attack roll was skipped");
});

test("castSpell reports the caster as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.castSpell(state, "nonexistent-id", { level: 1 });
  assert.match(result.message, /caster was not found/);
  assert.equal(result.state, state);
});

test("parseCommand resolves a cast-spell command, consuming a slot and rolling an attack against a target", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, {
    name: "Ysolde",
    spellcasting: { attackBonus: 9 },
    spellSlots: { 1: { max: 4, current: 4 } }
  }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", ac: 15, hp: 10, maxHp: 10 }).state;

  const result = withRandom([0.7, 0.5], () => CampaignOS.parseCommand(
    state,
    "Ysolde casts Guiding Bolt at Goblin 1 (1st level) for 1d6."
  ));
  assert.match(result.message, /using a 1st-level spell slot/);
  assert.match(result.message, /Ysolde's Guiding Bolt attacks Goblin 1/);
});

test("parseCommand resolves a cantrip cast with no target", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael" }).state;
  const result = CampaignOS.parseCommand(state, "Sael casts Guidance (cantrip).");
  assert.match(result.message, /Sael casts Guidance\./);
});

test("addToken normalizes named resources, clamping out-of-range values and dropping invalid entries", () => {
  const state = stateOnMap("Urskelde");
  const { token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    resources: {
      Rage: { max: 4, current: 4 },
      "Second Wind": { max: 1, current: 5, recovery: "short" }, // current clamped down to max
      Invalid: { max: 0, current: 0 } // max <= 0 is dropped entirely
    }
  });
  assert.deepEqual(token.resources, {
    Rage: { max: 4, current: 4, recovery: "long" }, // defaults to "long" when unspecified
    "Second Wind": { max: 1, current: 1, recovery: "short" }
  });
});

test("updateToken merges a partial resource change without wiping other resources, and null deletes one", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    resources: { Rage: { max: 4, current: 4 }, "Second Wind": { max: 1, current: 1, recovery: "short" } }
  });

  const updated = CampaignOS.updateToken(withToken, token.id, { resources: { Rage: { max: 4, current: 2, recovery: "long" } } });
  assert.deepEqual(updated.tokens[0].resources, {
    Rage: { max: 4, current: 2, recovery: "long" },
    "Second Wind": { max: 1, current: 1, recovery: "short" }
  });

  const removed = CampaignOS.updateToken(updated, token.id, { resources: { "Second Wind": null } });
  assert.deepEqual(removed.tokens[0].resources, { Rage: { max: 4, current: 2, recovery: "long" } });
});

test("updateToken's resources merge preserves an existing resource's recovery type when only current/max are re-sent", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    resources: { "Wild Shape": { max: 2, current: 2, recovery: "short" } }
  });
  // Simulates the UI's current/max edit field, which resends the resource's own recovery
  // value alongside the edited numbers so it isn't silently reset to the "long" default.
  const updated = CampaignOS.updateToken(withToken, token.id, {
    resources: { "Wild Shape": { max: 2, current: 1, recovery: "short" } }
  });
  assert.deepEqual(updated.tokens[0].resources["Wild Shape"], { max: 2, current: 1, recovery: "short" });
});

test("updateToken clears the resources field entirely once the last resource is removed", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    resources: { Rage: { max: 4, current: 4 } }
  });
  const cleared = CampaignOS.updateToken(withToken, token.id, { resources: { Rage: null } });
  assert.equal(cleared.tokens[0].resources, undefined);
});

test("useResource spends a charge and reports how many remain, matching the resource name case-insensitively", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    resources: { Rage: { max: 4, current: 4 } }
  });
  const result = CampaignOS.useResource(withToken, token.id, "rage");
  assert.match(result.message, /Darkhawk uses Rage \(3\/4 remaining\)\./);
  assert.equal(result.state.tokens[0].resources.Rage.current, 3);
});

test("useResource spends more than one charge at once when asked", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    resources: { "Superiority Dice": { max: 4, current: 4 } }
  });
  const result = CampaignOS.useResource(withToken, token.id, "Superiority Dice", 2);
  assert.match(result.message, /uses Superiority Dice \(2\) \(2\/4 remaining\)\./);
});

test("useResource fails without changing state once a resource is exhausted", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    resources: { "Wild Shape": { max: 2, current: 0 } }
  });
  const result = CampaignOS.useResource(withToken, token.id, "Wild Shape");
  assert.match(result.message, /doesn't have 1 Wild Shape left \(0\/2 remaining\)/);
  assert.equal(result.state, withToken);
});

test("useResource fails without changing state for a resource the token doesn't track", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Mara" });
  const result = CampaignOS.useResource(withToken, token.id, "Ki Points");
  assert.match(result.message, /Mara has no "Ki Points" resource tracked/);
  assert.equal(result.state, withToken);
});

test("restoreResource defaults to restoring a resource to full", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    resources: { "Wild Shape": { max: 2, current: 0 } }
  });
  const result = CampaignOS.restoreResource(withToken, token.id, "Wild Shape");
  assert.match(result.message, /Sael regains Wild Shape \(2\/2 remaining\)\./);
});

test("restoreResource restores a partial amount, clamped so it can't exceed max", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    resources: { Rage: { max: 4, current: 1 } }
  });
  const result = CampaignOS.restoreResource(withToken, token.id, "Rage", 10);
  assert.equal(result.state.tokens[0].resources.Rage.current, 4);
});

test("castSpell starts concentration on a spell when asked", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael" });
  const result = CampaignOS.castSpell(withToken, token.id, { level: 0, spellName: "Guidance", concentration: true });
  assert.deepEqual(result.state.tokens[0].concentratingOn, { spell: "Guidance" });
  assert.ok(!/ends/.test(result.message), "nothing was concentrating before, so there's no prior spell to end");
});

test("castSpell ends a different prior concentration spell when casting a new one", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael" });
  const first = CampaignOS.castSpell(withToken, token.id, { level: 0, spellName: "Guidance", concentration: true });
  const second = CampaignOS.castSpell(first.state, token.id, { level: 0, spellName: "Moonbeam", concentration: true });
  assert.match(second.message, /Sael's concentration on Guidance ends\./);
  assert.deepEqual(second.state.tokens[0].concentratingOn, { spell: "Moonbeam" });
});

test("castSpell without the concentration flag leaves any existing concentration untouched", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael" });
  const first = CampaignOS.castSpell(withToken, token.id, { level: 0, spellName: "Guidance", concentration: true });
  const second = CampaignOS.castSpell(first.state, token.id, { level: 0, spellName: "Fire Bolt" });
  assert.deepEqual(second.state.tokens[0].concentratingOn, { spell: "Guidance" });
});

test("applyDamage triggers a concentration CON save and maintains it on a success", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    hp: 50,
    maxHp: 50,
    abilityScores: { CON: 14 } // +2 modifier
  });
  const concentrating = CampaignOS.castSpell(withToken, token.id, { level: 0, spellName: "Bless", concentration: true }).state;

  // 10 damage -> DC = max(10, floor(10/2)=5) = 10. Roll 0.5 -> d20 11, +2 CON = 13 >= 10: success.
  const result = withRandom([0.5], () => CampaignOS.applyDamage(concentrating, token.id, 10));
  assert.match(result.message, /Sael rolls a CON save \(concentration\): 11 \+2 = 13 vs DC 10\. Maintains concentration on Bless\./);
  assert.deepEqual(result.state.tokens[0].concentratingOn, { spell: "Bless" });
});

test("applyDamage clears concentration on a failed CON save", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    hp: 50,
    maxHp: 50,
    abilityScores: { CON: 10 } // +0 modifier
  });
  const concentrating = CampaignOS.castSpell(withToken, token.id, { level: 0, spellName: "Bless", concentration: true }).state;

  // 20 damage -> DC = max(10, 10) = 10. Roll 0 -> d20 1, +0 = 1 < 10: failure.
  const result = withRandom([0], () => CampaignOS.applyDamage(concentrating, token.id, 20));
  assert.match(result.message, /Loses concentration on Bless\./);
  assert.equal(result.state.tokens[0].concentratingOn, undefined);
});

test("applyDamage ends concentration automatically (no save) when it drops the target to 0 HP", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael", hp: 5, maxHp: 50 });
  const concentrating = CampaignOS.castSpell(withToken, token.id, { level: 0, spellName: "Bless", concentration: true }).state;

  const result = CampaignOS.applyDamage(concentrating, token.id, 999);
  assert.equal(result.state.tokens[0].hp, 0);
  assert.match(result.message, /Sael falls unconscious and loses concentration on Bless\./);
  assert.ok(!/CON save/.test(result.message), "an unconscious creature auto-loses concentration, no save attempted");
  assert.equal(result.state.tokens[0].concentratingOn, undefined);
});

test("applyDamage does nothing concentration-related for a token that isn't concentrating on anything", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Goblin 1", hp: 10, maxHp: 10 });
  const result = CampaignOS.applyDamage(withToken, token.id, 5);
  assert.equal(result.message, null);
});

test("dropConcentration ends an active concentration and logs it", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael" });
  const concentrating = CampaignOS.castSpell(withToken, token.id, { level: 0, spellName: "Guidance", concentration: true }).state;
  const result = CampaignOS.dropConcentration(concentrating, token.id);
  assert.match(result.message, /Sael stops concentrating on Guidance\./);
  assert.equal(result.state.tokens[0].concentratingOn, undefined);
});

test("dropConcentration is a harmless no-op when the token wasn't concentrating on anything", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Mara" });
  const result = CampaignOS.dropConcentration(withToken, token.id);
  assert.match(result.message, /Mara isn't concentrating on anything\./);
});

test("dropConcentration reports the token as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.dropConcentration(state, "nonexistent-id");
  assert.match(result.message, /token was not found/);
  assert.equal(result.state, state);
});

test("attack folds a concentration check into its combined message when the target is concentrating", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1", attackBonus: 10, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Sael", ac: 1, hp: 50, maxHp: 50, abilityScores: { CON: 10 } }).state;
  const [goblin, sael] = state.tokens;
  state = CampaignOS.castSpell(state, sael.id, { level: 0, spellName: "Bless", concentration: true }).state;

  // d20 15 (0.7) + attackBonus 10 = 25 vs AC 1: hit. Damage rolls next, then the
  // concentration save rolls last (0 -> guaranteed failure at any plausible DC).
  const result = withRandom([0.7, 0.5, 0], () => CampaignOS.attack(state, goblin.id, sael.id));
  assert.match(result.message, /Goblin 1 attacks Sael/);
  assert.match(result.message, /Loses concentration on Bless/);
  const foundSael = result.state.tokens.find((t) => t.id === sael.id);
  assert.equal(foundSael.concentratingOn, undefined);
});

test("parseCommand resolves a cast-spell command with a concentration flag", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael" }).state;
  const result = CampaignOS.parseCommand(state, "Sael casts Bless (cantrip, concentration).");
  assert.deepEqual(result.state.tokens[0].concentratingOn, { spell: "Bless" });
});

test("parseCommand resolves 'stops concentrating' and 'drops concentration' phrasing", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael" }).state;
  state = CampaignOS.castSpell(state, state.tokens[0].id, { level: 0, spellName: "Bless", concentration: true }).state;

  const stopped = CampaignOS.parseCommand(state, "Sael stops concentrating.");
  assert.match(stopped.message, /Sael stops concentrating on Bless\./);
  assert.equal(stopped.state.tokens[0].concentratingOn, undefined);

  const reCast = CampaignOS.castSpell(state, state.tokens[0].id, { level: 0, spellName: "Bless", concentration: true }).state;
  const dropped = CampaignOS.parseCommand(reCast, "Sael drops concentration.");
  assert.match(dropped.message, /Sael stops concentrating on Bless\./);
});

test("applyDamage starts death saves when a token drops from above 0 to exactly 0 HP", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 100 });
  const result = CampaignOS.applyDamage(withToken, token.id, 10);
  assert.deepEqual(result.state.tokens[0].dying, { successes: 0, failures: 0, stable: false });
  assert.match(result.message, /Darkhawk drops to 0 HP and starts making death saves\./);
});

test("rollDeathSave is a no-op when the token isn't currently making death saves", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 10 });
  const result = CampaignOS.rollDeathSave(withToken, token.id);
  assert.match(result.message, /Darkhawk isn't making death saves right now\./);
});

test("rollDeathSave accumulates successes and stabilizes on the 3rd", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;
  const tokenId = state.tokens[0].id;

  // 0.45 -> d20 10, a success (10+ succeeds).
  const first = withRandom([0.45], () => CampaignOS.rollDeathSave(state, tokenId));
  assert.match(first.message, /success \(1\/3\)/);
  const second = withRandom([0.45], () => CampaignOS.rollDeathSave(first.state, tokenId));
  assert.match(second.message, /success \(2\/3\)/);
  const third = withRandom([0.45], () => CampaignOS.rollDeathSave(second.state, tokenId));
  assert.match(third.message, /success \(3\/3\)/);
  assert.match(third.message, /Darkhawk stabilizes\./);
  assert.deepEqual(third.state.tokens[0].dying, { successes: 3, failures: 0, stable: true });
});

test("rollDeathSave accumulates failures and kills on the 3rd", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;
  const tokenId = state.tokens[0].id;

  // 0.4 -> d20 9, a failure (below 10 fails).
  const first = withRandom([0.4], () => CampaignOS.rollDeathSave(state, tokenId));
  assert.match(first.message, /failure \(1\/3\)/);
  const second = withRandom([0.4], () => CampaignOS.rollDeathSave(first.state, tokenId));
  assert.match(second.message, /failure \(2\/3\)/);
  const third = withRandom([0.4], () => CampaignOS.rollDeathSave(second.state, tokenId));
  assert.match(third.message, /failure \(3\/3\)/);
  assert.match(third.message, /Darkhawk dies\./);
  assert.equal(third.state.tokens[0].dying, undefined);
  assert.equal(third.state.tokens[0].dead, true);
});

test("rollDeathSave counts a natural 1 as two failures at once", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;

  const result = withRandom([0], () => CampaignOS.rollDeathSave(state, state.tokens[0].id));
  assert.match(result.message, /rolls a 1 on their death save -- 2 failures \(2\/3\)/);
  assert.equal(result.state.tokens[0].dying.failures, 2);
});

test("rollDeathSave revives the token at 1 HP on a natural 20", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;

  const result = withRandom([0.999999], () => CampaignOS.rollDeathSave(state, state.tokens[0].id));
  assert.match(result.message, /rolls a natural 20 on their death save and springs back to 1 HP/);
  assert.equal(result.state.tokens[0].hp, 1);
  assert.equal(result.state.tokens[0].dying, undefined);
});

test("rollDeathSave refuses to roll once the token is already stable", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;
  const tokenId = state.tokens[0].id;
  state = withRandom([0.45], () => CampaignOS.rollDeathSave(state, tokenId)).state;
  state = withRandom([0.45], () => CampaignOS.rollDeathSave(state, tokenId)).state;
  state = withRandom([0.45], () => CampaignOS.rollDeathSave(state, tokenId)).state;

  const result = CampaignOS.rollDeathSave(state, tokenId);
  assert.match(result.message, /already stable and doesn't need to roll/);
});

test("rollDeathSave reports the token as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.rollDeathSave(state, "nonexistent-id");
  assert.match(result.message, /token was not found/);
  assert.equal(result.state, state);
});

test("applyDamage counts damage taken while already down as one automatic failed death save", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;

  const result = CampaignOS.applyDamage(state, state.tokens[0].id, 5);
  assert.match(result.message, /1 automatic failed death save \(1\/3 failures\)\./);
  assert.equal(result.state.tokens[0].dying.failures, 1);
});

test("applyDamage counts a critical hit while already down as two automatic failed death saves", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;

  const result = CampaignOS.applyDamage(state, state.tokens[0].id, 5, { critical: true });
  assert.match(result.message, /2 automatic failed death saves \(critical hit\) \(2\/3 failures\)\./);
  assert.equal(result.state.tokens[0].dying.failures, 2);
});

test("applyDamage kills a token whose automatic failures while down reach 3", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state; // down, 0 failures
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 5).state; // 1 failure

  const result = CampaignOS.applyDamage(state, state.tokens[0].id, 5, { critical: true }); // +2 -> 3
  assert.match(result.message, /Darkhawk dies\./);
  assert.equal(result.state.tokens[0].dead, true);
  assert.equal(result.state.tokens[0].dying, undefined);
});

test("applyDamage does nothing death-save-related once a token is already dead", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 5).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 5, { critical: true }).state; // now dead

  const result = CampaignOS.applyDamage(state, state.tokens[0].id, 5);
  assert.equal(result.message, null);
});

test("applyHealing clears the death-save tracker and a dead flag when it brings a token back above 0 HP", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 5).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 5, { critical: true }).state; // dead

  const healed = CampaignOS.applyHealing(state, state.tokens[0].id, 10);
  assert.equal(healed.tokens[0].hp, 10);
  assert.equal(healed.tokens[0].dead, undefined);
  assert.equal(healed.tokens[0].dying, undefined);
});

test("updateToken clears the death-save tracker and a dead flag when hp is manually edited above 0", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;

  const updated = CampaignOS.updateToken(state, state.tokens[0].id, { hp: 50 });
  assert.equal(updated.tokens[0].dying, undefined);
});

test("attack allows hitting a target already at 0 HP, counting the hit as an automatic failed death save", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1", attackBonus: 20, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Darkhawk", ac: 1, hp: 1, maxHp: 100 }).state;
  const [goblin, darkhawk] = state.tokens;
  state = CampaignOS.applyDamage(state, darkhawk.id, 1).state; // Darkhawk is down, dying

  // d20 15 (0.7) + 20 = 35 vs AC 1: guaranteed hit.
  const result = withRandom([0.7, 0.5], () => CampaignOS.attack(state, goblin.id, darkhawk.id));
  assert.match(result.message, /Goblin 1 attacks Darkhawk/);
  assert.match(result.message, /automatic failed death save/);
  const foundDarkhawk = result.state.tokens.find((t) => t.id === darkhawk.id);
  assert.equal(foundDarkhawk.dying.failures, 1);
});

test("parseCommand resolves a death-save command by token name", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 1, maxHp: 100 }).state;
  state = CampaignOS.applyDamage(state, state.tokens[0].id, 1).state;

  const result = withRandom([0.45], () => CampaignOS.parseCommand(state, "Darkhawk rolls a death save."));
  assert.match(result.message, /success \(1\/3\)/);
});

test("longRest fully heals HP, restores all spell slots, and restores all resources regardless of recovery type", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    hp: 10,
    maxHp: 88,
    spellSlots: { 1: { max: 4, current: 0 }, 2: { max: 3, current: 1 } },
    resources: {
      "Wild Shape": { max: 2, current: 0, recovery: "short" },
      Rage: { max: 4, current: 1, recovery: "long" }
    }
  });

  const result = CampaignOS.longRest(withToken, token.id);
  const rested = result.state.tokens[0];
  assert.equal(rested.hp, 88);
  assert.equal(rested.spellSlots[1].current, 4);
  assert.equal(rested.spellSlots[2].current, 3);
  assert.equal(rested.resources["Wild Shape"].current, 2);
  assert.equal(rested.resources.Rage.current, 4);
  assert.match(result.message, /Sael takes a long rest\./);
  assert.match(result.message, /Fully healed \(88\/88 HP\)\./);
  assert.match(result.message, /All spell slots restored\./);
  assert.match(result.message, /All resources restored\./);
});

test("longRest skips healing/reviving a token flagged dead, but still refreshes its slots and resources", () => {
  const state = stateOnMap("Urskelde");
  let { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    hp: 1,
    maxHp: 50,
    spellSlots: { 1: { max: 2, current: 0 } }
  });
  withToken = CampaignOS.applyDamage(withToken, token.id, 1).state; // down, dying
  withToken = CampaignOS.applyDamage(withToken, token.id, 5).state; // 1 failure
  withToken = CampaignOS.applyDamage(withToken, token.id, 5, { critical: true }).state; // 3 failures -> dead

  const result = CampaignOS.longRest(withToken, token.id);
  const rested = result.state.tokens[0];
  assert.equal(rested.dead, true, "a long rest should not revive a token flagged dead");
  assert.equal(rested.hp, 0);
  assert.equal(rested.spellSlots[1].current, 2, "slots still refresh even though the token is dead");
  assert.ok(!/Fully healed/.test(result.message));
});

test("longRest reports the token as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.longRest(state, "nonexistent-id");
  assert.match(result.message, /token was not found/);
  assert.equal(result.state, state);
});

test("shortRest restores only resources tagged recovery: 'short', leaving spell slots and long-only resources untouched", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    hp: 10,
    maxHp: 88,
    spellSlots: { 1: { max: 4, current: 0 } },
    resources: {
      "Wild Shape": { max: 2, current: 0, recovery: "short" },
      Rage: { max: 4, current: 1, recovery: "long" }
    }
  });

  const result = CampaignOS.shortRest(withToken, token.id);
  const rested = result.state.tokens[0];
  assert.equal(rested.hp, 10, "a short rest does not restore HP -- Hit Dice aren't modeled");
  assert.equal(rested.spellSlots[1].current, 0, "spell slots don't recover on a short rest");
  assert.equal(rested.resources["Wild Shape"].current, 2);
  assert.equal(rested.resources.Rage.current, 1, "a long-only resource is untouched by a short rest");
  assert.match(result.message, /Sael takes a short rest\. Restored: Wild Shape\./);
});

test("shortRest reports when a token has no short-rest resources to restore", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    resources: { Rage: { max: 4, current: 1, recovery: "long" } }
  });
  const result = CampaignOS.shortRest(withToken, token.id);
  assert.match(result.message, /Darkhawk takes a short rest -- no short-rest resources to restore\./);
});

test("shortRest reports the token as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.shortRest(state, "nonexistent-id");
  assert.match(result.message, /token was not found/);
  assert.equal(result.state, state);
});

test("parseCommand resolves long-rest and short-rest commands by token name", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    hp: 10,
    maxHp: 88,
    resources: { "Wild Shape": { max: 2, current: 0, recovery: "short" } }
  });

  const longRested = CampaignOS.parseCommand(withToken, "Sael takes a long rest.");
  assert.match(longRested.message, /Fully healed \(88\/88 HP\)\./);

  const shortRested = CampaignOS.parseCommand(withToken, "Sael takes a short rest.");
  assert.match(shortRested.message, /Restored: Wild Shape\./);
  assert.equal(shortRested.state.tokens.find((t) => t.id === token.id).hp, 10, "a short rest via parseCommand should not touch HP");
});
