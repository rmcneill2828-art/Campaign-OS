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
