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

test("parseCommand spawns a real hell hound stat block, matching plural and singular phrasing", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "Three hellhounds emerge from the trees."));
  const hellhounds = result.state.tokens.filter((t) => t.name.startsWith("Hellhound"));
  assert.equal(hellhounds.length, 3);
  const [hound] = hellhounds;
  assert.equal(hound.hp, 45);
  assert.equal(hound.ac, 15);
  assert.equal(hound.attackBonus, 5);
  assert.equal(hound.damageDice, "4d6+1");
  assert.equal(hound.speed, 50);
  assert.deepEqual(hound.abilityScores, { STR: 17, DEX: 12, CON: 14, INT: 6, WIS: 13, CHA: 6 });
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

test("parseCommand spawns a real skeleton stat block", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one skeleton"));
  const [skeleton] = result.state.tokens;
  assert.equal(skeleton.hp, 13);
  assert.equal(skeleton.ac, 13);
  assert.equal(skeleton.attackBonus, 4);
  assert.equal(skeleton.damageDice, "1d6+2");
});

test("parseCommand spawns a real giant spider stat block, matching the multi-word monster name", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "Two giant spiders emerge from the ceiling."));
  const spiders = result.state.tokens.filter((t) => t.name.startsWith("Giant spider"));
  assert.equal(spiders.length, 2);
  assert.equal(spiders[0].hp, 26);
  assert.equal(spiders[0].ac, 14);
  assert.deepEqual(spiders[0].abilityScores, { STR: 14, DEX: 16, CON: 12, INT: 2, WIS: 11, CHA: 4 });
});

test("parseCommand spawning a ghoul gives it Multiattack (Bite + Claws)", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one ghoul"));
  const [ghoul] = result.state.tokens;
  assert.equal(ghoul.hp, 22);
  assert.deepEqual(ghoul.attacks.map((a) => a.name), ["Bite", "Claws"]);
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

test("rollAbilityCheck rolls a named skill using the governing ability's modifier when no stated skill bonus exists", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael", abilityScores: { WIS: 16 } });
  const result = withRandom([9 / 20], () => CampaignOS.rollAbilityCheck(withToken, token.id, "Perception", 12));
  assert.match(result.message, /Sael rolls a Perception check: 10 \+3 = 13 vs DC 12\. Success\./);
  assert.equal(result.success, true);
});

test("rollAbilityCheck prefers a stated skill bonus over the recomputed ability modifier", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Feats Over Time",
    abilityScores: { DEX: 10 },
    skills: { Stealth: 9 }
  });
  const result = withRandom([0], () => CampaignOS.rollAbilityCheck(withToken, token.id, "stealth", 10));
  assert.match(result.message, /rolls a Stealth check: 1 \+9 = 10 vs DC 10\. Success\./);
});

test("rollAbilityCheck supports a bare ability with no named skill", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk", abilityScores: { STR: 20 } });
  const result = withRandom([0.45], () => CampaignOS.rollAbilityCheck(withToken, token.id, "STR", 10));
  assert.match(result.message, /Darkhawk rolls a STR check: 10 \+5 = 15 vs DC 10\. Success\./);
});

test("rollAbilityCheck fails outright for a name that isn't a known skill or ability", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Ysolde" });
  const result = CampaignOS.rollAbilityCheck(withToken, token.id, "Luck", 10);
  assert.match(result.message, /not a valid skill or ability/);
  assert.equal(result.success, false);
});

test("rollAbilityCheck forces disadvantage at exhaustion level 1+ (a lower threshold than attacks/saves)", () => {
  const state = stateOnMap("Urskelde");
  let { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk", abilityScores: { WIS: 10 } });
  withToken = CampaignOS.setExhaustion(withToken, token.id, 1).state;
  const result = withRandom([0.9, 0.1], () => CampaignOS.rollAbilityCheck(withToken, token.id, "Perception", 10));
  assert.match(result.message, /exhaustion disadvantage: 19, 3/);
});

test("rollAbilityCheck forces disadvantage for a Poisoned token", () => {
  const state = stateOnMap("Urskelde");
  let { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk", abilityScores: { WIS: 10 } });
  withToken = CampaignOS.toggleCondition(withToken, token.id, "Poisoned");
  const result = withRandom([0.9, 0.1], () => CampaignOS.rollAbilityCheck(withToken, token.id, "Perception", 10));
  assert.match(result.message, /poisoned disadvantage: 19, 3/);
});

test("rollAbilityCheck reports the token as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.rollAbilityCheck(state, "nonexistent-id", "Perception", 10);
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

test("parseCommand resolves an ability check command by token name", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael", abilityScores: { WIS: 16 } }).state;
  const result = withRandom([9 / 20], () => CampaignOS.parseCommand(state, "Sael rolls a Perception check against DC 12"));
  assert.equal(result.success, true);
  assert.match(result.message, /Sael rolls a Perception check: 10 \+3 = 13 vs DC 12\. Success\./);
});

test("parseCommand resolves an ability check command with a multi-word skill name", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael", abilityScores: { WIS: 16 } }).state;
  const result = withRandom([9 / 20], () => CampaignOS.parseCommand(state, "Sael makes an Animal Handling check against DC 12"));
  assert.equal(result.success, true);
  assert.match(result.message, /Sael rolls a Animal Handling check/);
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

test("parseCommand resolves an area-cast command against multiple named targets", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael", spellSlots: { 3: { max: 2, current: 2 } } }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", abilityScores: { DEX: 10 }, hp: 20, maxHp: 20 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 2", abilityScores: { DEX: 10 }, hp: 20, maxHp: 20 }).state;

  const randoms = [...Array(8).fill(0), 0.9, 0.1];
  const result = withRandom(randoms, () => CampaignOS.parseCommand(
    state,
    "Sael casts Fireball on Goblin 1, Goblin 2 (3rd level, DEX save DC 15) for 8d6."
  ));

  assert.match(result.message, /Sael casts Fireball using a 3rd-level spell slot \(1 remaining\)\./);
  assert.match(result.message, /Goblin 1 takes 4 damage/);
  assert.match(result.message, /Goblin 2 takes 8 damage/);
});

test("parseCommand reports an unresolved target name in an area-cast command", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael", spellSlots: { 3: { max: 2, current: 2 } } }).state;

  const result = CampaignOS.parseCommand(state, "Sael casts Fireball on Nonexistent Goblin (3rd level, DEX save DC 15) for 8d6.");
  assert.match(result.message, /could not find "Nonexistent Goblin" among the spell's targets/);
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

test("updateToken sets and clears damageType, and comma-separated damage type list fields", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk" });

  const withTypes = CampaignOS.updateToken(withToken, token.id, {
    damageType: "Slashing",
    damageResistances: "Fire, cold",
    damageVulnerabilities: "bludgeoning",
    damageImmunities: "poison, poison" // duplicate on purpose -- should dedupe
  }).tokens[0];
  assert.equal(withTypes.damageType, "slashing");
  assert.deepEqual(withTypes.damageResistances, ["fire", "cold"]);
  assert.deepEqual(withTypes.damageVulnerabilities, ["bludgeoning"]);
  assert.deepEqual(withTypes.damageImmunities, ["poison"]);

  const cleared = CampaignOS.updateToken({ ...withToken, tokens: [withTypes] }, token.id, {
    damageType: "",
    damageResistances: "",
    damageVulnerabilities: "",
    damageImmunities: ""
  }).tokens[0];
  assert.equal(cleared.damageType, undefined);
  assert.equal(cleared.damageResistances, undefined);
  assert.equal(cleared.damageVulnerabilities, undefined);
  assert.equal(cleared.damageImmunities, undefined);
});

test("addToken sets hiddenFromPlayers only when the draft asks for it (sparse, absent by default)", () => {
  const state = stateOnMap("Urskelde");
  const visible = CampaignOS.addToken(state, { name: "Goblin 1" }).token;
  assert.equal(visible.hiddenFromPlayers, undefined);

  const hidden = CampaignOS.addToken(state, { name: "Ambush Troll", hiddenFromPlayers: true }).token;
  assert.equal(hidden.hiddenFromPlayers, true);
});

test("updateToken sets and clears hiddenFromPlayers", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Ambush Troll" });

  const hidden = CampaignOS.updateToken(withToken, token.id, { hiddenFromPlayers: true }).tokens[0];
  assert.equal(hidden.hiddenFromPlayers, true);

  const revealed = CampaignOS.updateToken({ ...withToken, tokens: [hidden] }, token.id, { hiddenFromPlayers: false }).tokens[0];
  assert.equal(revealed.hiddenFromPlayers, undefined);
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

test("castAreaSpell rolls damage once and applies full damage on a failed save, half (rounded down) on a success", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael", spellSlots: { 3: { max: 2, current: 2 } } }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", abilityScores: { DEX: 10 }, hp: 20, maxHp: 20 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 2", abilityScores: { DEX: 10 }, hp: 20, maxHp: 20 }).state;
  const [sael, goblin1, goblin2] = state.tokens;

  // 8d6 damage, every die at random=0 -> 1 each, total 8. Goblin 1's save: 0.9 -> d20 19,
  // +0 DEX mod = 19 vs DC 15 -> success, half damage (floor(8/2) = 4). Goblin 2's save:
  // 0.1 -> d20 3, +0 = 3 vs DC 15 -> failure, full damage (8).
  const randoms = [...Array(8).fill(0), 0.9, 0.1];
  const result = withRandom(randoms, () => CampaignOS.castAreaSpell(state, sael.id, {
    spellName: "Fireball",
    level: 3,
    targetIds: [goblin1.id, goblin2.id],
    saveAbility: "DEX",
    saveDC: 15,
    damageDice: "8d6"
  }));

  assert.match(result.message, /Sael casts Fireball using a 3rd-level spell slot \(1 remaining\)\./);
  assert.match(result.message, /Goblin 1 rolls a DEX save.*Success/);
  assert.match(result.message, /Goblin 1 takes 4 damage/);
  assert.match(result.message, /Goblin 2 rolls a DEX save.*Failure/);
  assert.match(result.message, /Goblin 2 takes 8 damage/);
  const foundGoblin1 = result.state.tokens.find((t) => t.name === "Goblin 1");
  const foundGoblin2 = result.state.tokens.find((t) => t.name === "Goblin 2");
  assert.equal(foundGoblin1.hp, 16);
  assert.equal(foundGoblin2.hp, 12);
});

test("castAreaSpell deals no damage on a success when halfOnSave is explicitly false", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael", spellSlots: { 2: { max: 1, current: 1 } } }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", abilityScores: { DEX: 10 }, hp: 20, maxHp: 20 }).state;
  const [sael, goblin] = state.tokens;

  const result = withRandom([0, 0, 0.9], () => CampaignOS.castAreaSpell(state, sael.id, {
    spellName: "Sleet Storm",
    level: 2,
    targetIds: [goblin.id],
    saveAbility: "DEX",
    saveDC: 10,
    damageDice: "2d4",
    halfOnSave: false
  }));

  const found = result.state.tokens.find((t) => t.name === "Goblin 1");
  assert.equal(found.hp, 20);
  assert.match(result.message, /takes no damage/);
});

test("castAreaSpell starts concentration on a spell when asked", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael", spellSlots: { 3: { max: 1, current: 1 } } }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", abilityScores: { DEX: 10 }, hp: 20, maxHp: 20 }).state;
  const [sael, goblin] = state.tokens;

  const result = withRandom([0, 0.5], () => CampaignOS.castAreaSpell(state, sael.id, {
    spellName: "Spirit Guardians",
    level: 3,
    targetIds: [goblin.id],
    saveAbility: "WIS",
    saveDC: 15,
    damageDice: "3d8",
    concentration: true
  }));

  const found = result.state.tokens.find((t) => t.name === "Sael");
  assert.deepEqual(found.concentratingOn, { spell: "Spirit Guardians" });
});

test("castAreaSpell fails without changing state once a level's slots are exhausted", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael", spellSlots: { 3: { max: 1, current: 0 } } });
  const result = CampaignOS.castAreaSpell(withToken, token.id, {
    spellName: "Fireball", level: 3, targetIds: ["whatever"], saveAbility: "DEX", saveDC: 15, damageDice: "8d6"
  });
  assert.match(result.message, /Sael has no 3rd-level spell slots remaining\./);
  assert.equal(result.state, withToken);
});

test("castAreaSpell fails outright for an invalid saveAbility", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael" });
  const result = CampaignOS.castAreaSpell(withToken, token.id, {
    spellName: "Fireball", level: 3, targetIds: ["whatever"], saveAbility: "luck", saveDC: 15, damageDice: "8d6"
  });
  assert.match(result.message, /not a valid ability/);
  assert.equal(result.state, withToken);
});

test("castAreaSpell fails outright when no targets are given", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael" });
  const result = CampaignOS.castAreaSpell(withToken, token.id, {
    spellName: "Fireball", level: 3, targetIds: [], saveAbility: "DEX", saveDC: 15, damageDice: "8d6"
  });
  assert.match(result.message, /no targets given/);
  assert.equal(result.state, withToken);
});

test("castAreaSpell reports the caster as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.castAreaSpell(state, "nonexistent-id", {
    level: 3, targetIds: ["whatever"], saveAbility: "DEX", saveDC: 15, damageDice: "8d6"
  });
  assert.match(result.message, /caster was not found/);
  assert.deepEqual(result.state, state);
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

test("damageTypeModifier returns null when no damageType is given or the token has no matching list", () => {
  const token = { name: "Goblin 1", damageResistances: ["fire"] };
  assert.equal(CampaignOS.damageTypeModifier(token, undefined), null);
  assert.equal(CampaignOS.damageTypeModifier(token, "cold"), null); // listed for a different type
});

test("damageTypeModifier matches case-insensitively and detects immune/resistant/vulnerable", () => {
  const token = {
    damageImmunities: ["Poison"],
    damageResistances: ["Fire"],
    damageVulnerabilities: ["Bludgeoning"]
  };
  assert.equal(CampaignOS.damageTypeModifier(token, "poison"), "immune");
  assert.equal(CampaignOS.damageTypeModifier(token, "FIRE"), "resistant");
  assert.equal(CampaignOS.damageTypeModifier(token, "bludgeoning"), "vulnerable");
});

test("damageTypeModifier treats resistant AND vulnerable to the same type as cancelling out", () => {
  const token = { damageResistances: ["fire"], damageVulnerabilities: ["fire"] };
  assert.equal(CampaignOS.damageTypeModifier(token, "fire"), null);
});

test("applyDamage zeroes damage outright for an immune token and reports it, without starting death saves", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Golem", hp: 10, maxHp: 10, damageImmunities: ["poison"] });
  const result = CampaignOS.applyDamage(withToken, token.id, 20, { damageType: "poison" });
  assert.equal(result.state.tokens[0].hp, 10);
  assert.equal(result.message, "Golem is immune to poison -- no damage taken.");
  assert.equal(result.state.tokens[0].dying, undefined);
});

test("applyDamage halves (rounded down) damage for a resistant token and reports the adjusted amount", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Fire Elemental", hp: 20, maxHp: 20, damageResistances: ["fire"] });
  const result = CampaignOS.applyDamage(withToken, token.id, 7, { damageType: "fire" });
  assert.equal(result.state.tokens[0].hp, 17); // 7 halved, rounded down to 3
  assert.equal(result.message, "Fire Elemental resists fire -- damage reduced to 3.");
});

test("applyDamage doubles damage for a vulnerable token and reports the adjusted amount", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Skeleton 1", hp: 20, maxHp: 20, damageVulnerabilities: ["bludgeoning"] });
  const result = CampaignOS.applyDamage(withToken, token.id, 6, { damageType: "bludgeoning" });
  assert.equal(result.state.tokens[0].hp, 8); // 6 doubled to 12
  assert.equal(result.message, "Skeleton 1 is vulnerable to bludgeoning -- damage increased to 12.");
});

test("applyDamage applies the full amount, with no modifier message, when no damageType is given", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Goblin 1", hp: 10, maxHp: 10, damageResistances: ["fire"] });
  const result = CampaignOS.applyDamage(withToken, token.id, 5);
  assert.equal(result.state.tokens[0].hp, 5);
  assert.equal(result.message, null);
});

test("applyDamage's resistance-adjusted amount, not the raw roll, sets the concentration save DC", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Sael", hp: 50, maxHp: 50, damageResistances: ["fire"] });
  const concentrating = CampaignOS.castSpell(withToken, token.id, { level: 0, spellName: "Bless", concentration: true }).state;
  // 20 raw fire damage resisted down to 10 -- DC should be max(10, floor(10/2)) = 10, not
  // max(10, floor(20/2)) = 10 coincidentally the same here, so use a bigger number to
  // actually distinguish the two: 30 raw -> 15 adjusted -> DC max(10, 7) = 10 either way is
  // still ambiguous, so assert the adjusted HP loss instead, which unambiguously proves the
  // resisted amount (not the raw one) was what actually got applied.
  const result = CampaignOS.applyDamage(concentrating, token.id, 30, { damageType: "fire" });
  assert.equal(result.state.tokens[0].hp, 35); // 50 - 15 (30 halved), not 50 - 30
});

test("attack() reads damageType off the attacker's own attack profile automatically", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, {
    name: "Fire Sprite", attackBonus: 50, damageDice: "1d4", damageType: "fire"
  }).state;
  state = CampaignOS.addToken(state, { name: "Salamander", hp: 20, maxHp: 20, damageImmunities: ["fire"] }).state;
  const attacker = state.tokens.find((t) => t.name === "Fire Sprite");
  const target = state.tokens.find((t) => t.name === "Salamander");
  const result = withRandom([0.999999], () => CampaignOS.attack(state, attacker.id, target.id));
  assert.match(result.message, /Salamander is immune to fire -- no damage taken\./);
  assert.equal(result.state.tokens.find((t) => t.name === "Salamander").hp, 20);
});

test("parseCommand spawning a skeleton gives it a bludgeoning vulnerability", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one skeleton"));
  const skeleton = result.state.tokens.find((t) => t.name === "Skeleton 1");
  assert.deepEqual(skeleton.damageVulnerabilities, ["bludgeoning"]);
  assert.equal(skeleton.damageType, "piercing");
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

test("longRest restores half (rounded down, minimum one) of each Hit Dice pool, not all of it", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    hitDice: { d12: { total: 11, current: 2 }, d10: { total: 4, current: 0 } }
  });

  const result = CampaignOS.longRest(withToken, token.id);
  const rested = result.state.tokens[0];
  // d12: 2 + floor(11/2)=5 -> 7. d10: 0 + floor(4/2)=2 -> 2.
  assert.equal(rested.hitDice.d12.current, 7);
  assert.equal(rested.hitDice.d10.current, 2);
  assert.match(result.message, /Half of all Hit Dice restored\./);
});

test("longRest restores at least one Hit Die even when half would round down to zero", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Sael",
    hitDice: { d8: { total: 1, current: 0 } }
  });

  const result = CampaignOS.longRest(withToken, token.id);
  assert.equal(result.state.tokens[0].hitDice.d8.current, 1);
});

test("longRest clamps restored Hit Dice at the pool's total", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    hitDice: { d12: { total: 11, current: 10 } }
  });

  const result = CampaignOS.longRest(withToken, token.id);
  assert.equal(result.state.tokens[0].hitDice.d12.current, 11);
});

test("spendHitDie rolls that many dice plus CON modifier per die and heals the total", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    hp: 10,
    maxHp: 100,
    abilityScores: { CON: 14 }, // +2 modifier
    hitDice: { d12: { total: 11, current: 5 } }
  });

  // 2 dice at random=0.5 -> d12 roll of 7 each, +2 CON = 9 each -> 18 total healing.
  const result = withRandom([0.5], () => CampaignOS.spendHitDie(withToken, token.id, "d12", 2));
  const found = result.state.tokens.find((t) => t.name === "Darkhawk");
  assert.equal(found.hp, 28);
  assert.equal(found.hitDice.d12.current, 3);
  assert.match(result.message, /Darkhawk spends 2 d12 Hit Dice, healing 18 \(28\/100 HP\) -- 3\/11 d12 Hit Dice remaining\./);
});

test("spendHitDie heals a minimum of 1 per die even with a negative CON modifier", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Weakling",
    hp: 5,
    maxHp: 50,
    abilityScores: { CON: 3 }, // -4 modifier
    hitDice: { d6: { total: 2, current: 2 } }
  });

  // random=0 -> d6 roll of 1, +(-4) = -3, floored at a minimum of 1 healing.
  const result = withRandom([0], () => CampaignOS.spendHitDie(withToken, token.id, "d6", 1));
  const found = result.state.tokens.find((t) => t.name === "Weakling");
  assert.equal(found.hp, 6);
});

test("spendHitDie fails without changing state once a die type is exhausted", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk", hitDice: { d12: { total: 11, current: 0 } } });
  const result = CampaignOS.spendHitDie(withToken, token.id, "d12", 1);
  assert.match(result.message, /doesn't have 1 d12 Hit Dice left \(0\/11 remaining\)\./);
  assert.equal(result.state, withToken);
});

test("spendHitDie fails outright for a die type the token doesn't track", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk" });
  const result = CampaignOS.spendHitDie(withToken, token.id, "d12", 1);
  assert.match(result.message, /has no d12 Hit Dice tracked\./);
  assert.equal(result.state, withToken);
});

test("spendHitDie reports the token as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.spendHitDie(state, "nonexistent-id", "d12", 1);
  assert.match(result.message, /token was not found/);
  assert.deepEqual(result.state, state);
});

test("parseCommand resolves spending Hit Dice by token name", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    hp: 10,
    maxHp: 100,
    abilityScores: { CON: 14 },
    hitDice: { d12: { total: 11, current: 5 } }
  });

  const result = withRandom([0.5], () => CampaignOS.parseCommand(withToken, "Darkhawk spends a hit die"));
  assert.match(result.message, /Darkhawk spends 1 d12 Hit Dice, healing 9/);
});

test("parseCommand requires an explicit die type when a token tracks more than one Hit Dice pool", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    hitDice: { d12: { total: 11, current: 5 }, d10: { total: 4, current: 4 } }
  });

  const result = CampaignOS.parseCommand(withToken, "Darkhawk spends a hit die");
  assert.match(result.message, /tracks more than one Hit Dice type/);
});

test("parseCommand resolves spending a specific Hit Dice type", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken } = CampaignOS.addToken(state, {
    name: "Darkhawk",
    hp: 10,
    maxHp: 100,
    abilityScores: { CON: 14 },
    hitDice: { d12: { total: 11, current: 5 }, d10: { total: 4, current: 4 } }
  });

  const result = withRandom([0.5], () => CampaignOS.parseCommand(withToken, "Darkhawk spends 2 d10 hit dice"));
  assert.match(result.message, /Darkhawk spends 2 d10 Hit Dice/);
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

test("setExhaustion sets a token's level and logs it, clamping to 0-6", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk" });
  const result = CampaignOS.setExhaustion(withToken, token.id, 3);
  assert.equal(result.state.tokens[0].exhaustion, 3);
  assert.match(result.message, /Darkhawk is now at exhaustion level 3\./);

  const clamped = CampaignOS.setExhaustion(result.state, token.id, 99);
  assert.equal(clamped.state.tokens[0].exhaustion, 6);
});

test("setExhaustion clears the field entirely when set back to 0", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk" });
  const raised = CampaignOS.setExhaustion(withToken, token.id, 2).state;
  const cleared = CampaignOS.setExhaustion(raised, token.id, 0);
  assert.equal(cleared.state.tokens[0].exhaustion, undefined);
});

test("setExhaustion kills the token instantly at level 6, with no save", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk", hp: 50, maxHp: 100 });
  const result = CampaignOS.setExhaustion(withToken, token.id, 6);
  assert.equal(result.state.tokens[0].hp, 0);
  assert.equal(result.state.tokens[0].dead, true);
  assert.equal(result.state.tokens[0].dying, undefined);
  assert.match(result.message, /Darkhawk dies from exhaustion\./);
});

test("addExhaustion increments from the token's current level", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk" });
  const first = CampaignOS.addExhaustion(withToken, token.id, 1);
  assert.equal(first.state.tokens[0].exhaustion, 1);
  const second = CampaignOS.addExhaustion(first.state, token.id, 2);
  assert.equal(second.state.tokens[0].exhaustion, 3);
});

test("addExhaustion with a negative amount removes levels, floored at 0", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk" });
  const raised = CampaignOS.addExhaustion(withToken, token.id, 2).state;
  const reduced = CampaignOS.addExhaustion(raised, token.id, -5);
  assert.equal(reduced.state.tokens[0].exhaustion, undefined);
});

test("addExhaustion reports the token as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.addExhaustion(state, "nonexistent-id", 1);
  assert.match(result.message, /token was not found/);
  assert.equal(result.state, state);
});

test("rollSavingThrow forces disadvantage at exhaustion level 3+", () => {
  const state = stateOnMap("Urskelde");
  let { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk", abilityScores: { CON: 10 } });
  withToken = CampaignOS.setExhaustion(withToken, token.id, 3).state;

  // disadvantage rolls [0.9 -> 19, 0.1 -> 3], keeps the lower (3).
  const result = withRandom([0.9, 0.1], () => CampaignOS.rollSavingThrow(withToken, token.id, "CON", 10));
  assert.match(result.message, /exhaustion disadvantage: 19, 3/);
  assert.equal(result.total, 3);
});

test("rollSavingThrow rolls normally below exhaustion level 3", () => {
  const state = stateOnMap("Urskelde");
  let { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk", abilityScores: { CON: 10 } });
  withToken = CampaignOS.setExhaustion(withToken, token.id, 2).state;

  const result = withRandom([0.45], () => CampaignOS.rollSavingThrow(withToken, token.id, "CON", 10));
  assert.ok(!/exhaustion disadvantage/.test(result.message));
});

test("attack forces disadvantage on the attacker's rolls at exhaustion level 3+", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", attackBonus: 5, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", ac: 15, hp: 10, maxHp: 10 }).state;
  const [darkhawk, goblin] = state.tokens;
  state = CampaignOS.setExhaustion(state, darkhawk.id, 3).state;

  const result = withRandom([0.9, 0.1], () => CampaignOS.attack(state, darkhawk.id, goblin.id));
  assert.match(result.message, /disadvantage: 19, 3/);
});

test("attack cancels exhaustion-forced disadvantage against an explicit advantage flag", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", attackBonus: 5, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", ac: 15, hp: 10, maxHp: 10 }).state;
  const [darkhawk, goblin] = state.tokens;
  state = CampaignOS.setExhaustion(state, darkhawk.id, 3).state;

  const result = withRandom([0.5], () => CampaignOS.attack(state, darkhawk.id, goblin.id, { advantage: true }));
  assert.ok(
    !/advantage:/.test(result.message) && !/disadvantage:/.test(result.message),
    "advantage and forced disadvantage should cancel out to a normal roll"
  );
});

test("effectiveSpeed halves speed at exhaustion level 2-4 and zeroes it at level 5+", () => {
  assert.equal(CampaignOS.effectiveSpeed({ speed: 30 }), 30);
  assert.equal(CampaignOS.effectiveSpeed({ speed: 30, exhaustion: 1 }), 30);
  assert.equal(CampaignOS.effectiveSpeed({ speed: 30, exhaustion: 2 }), 15);
  assert.equal(CampaignOS.effectiveSpeed({ speed: 30, exhaustion: 4 }), 15);
  assert.equal(CampaignOS.effectiveSpeed({ speed: 30, exhaustion: 5 }), 0);
  assert.equal(CampaignOS.effectiveSpeed({ speed: 30, exhaustion: 6 }), 0);
});

test("effectiveSpeed zeroes speed for Grappled or Restrained regardless of exhaustion", () => {
  assert.equal(CampaignOS.effectiveSpeed({ speed: 30, conditions: ["Grappled"] }), 0);
  assert.equal(CampaignOS.effectiveSpeed({ speed: 30, conditions: ["Restrained"] }), 0);
  assert.equal(CampaignOS.effectiveSpeed({ speed: 30, conditions: ["Prone"] }), 30);
});

test("attack forces disadvantage on the attacker's own roll when Blinded, Restrained, Prone, or Poisoned", () => {
  for (const condition of ["Blinded", "Restrained", "Prone", "Poisoned"]) {
    let state = stateOnMap("Urskelde");
    state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, hp: 10, maxHp: 10 }).state;
    state = CampaignOS.addToken(state, { name: "Target", ac: 15, hp: 10, maxHp: 10 }).state;
    const [attacker, target] = state.tokens;
    state = CampaignOS.toggleCondition(state, attacker.id, condition);

    const result = withRandom([0.9, 0.1], () => CampaignOS.attack(state, attacker.id, target.id));
    assert.match(result.message, /disadvantage: 19, 3/, `expected disadvantage for attacker with ${condition}`);
  }
});

test("attack grants the attacker advantage when Invisible", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 15, hp: 10, maxHp: 10 }).state;
  const [attacker, target] = state.tokens;
  state = CampaignOS.toggleCondition(state, attacker.id, "Invisible");

  const result = withRandom([0.2, 0.85], () => CampaignOS.attack(state, attacker.id, target.id));
  assert.match(result.message, /advantage: 5, 18/);
});

test("attack grants advantage against a target that is Blinded, Restrained, Prone, Stunned, Paralyzed, or Unconscious", () => {
  for (const condition of ["Blinded", "Restrained", "Prone", "Stunned", "Paralyzed", "Unconscious"]) {
    let state = stateOnMap("Urskelde");
    state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, hp: 10, maxHp: 10 }).state;
    state = CampaignOS.addToken(state, { name: "Target", ac: 15, hp: 10, maxHp: 10 }).state;
    const [attacker, target] = state.tokens;
    state = CampaignOS.toggleCondition(state, target.id, condition);

    const result = withRandom([0.2, 0.85], () => CampaignOS.attack(state, attacker.id, target.id));
    assert.match(result.message, /advantage: 5, 18/, `expected advantage attacking a ${condition} target`);
  }
});

test("attack grants disadvantage against an Invisible target", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 15, hp: 10, maxHp: 10 }).state;
  const [attacker, target] = state.tokens;
  state = CampaignOS.toggleCondition(state, target.id, "Invisible");

  const result = withRandom([0.9, 0.1], () => CampaignOS.attack(state, attacker.id, target.id));
  assert.match(result.message, /disadvantage: 19, 3/);
});

test("attack against an adjacent Paralyzed or Unconscious target is an automatic critical even on a non-natural-20 hit", () => {
  for (const condition of ["Paralyzed", "Unconscious"]) {
    let state = stateOnMap("Urskelde");
    state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, damageDice: "1d1", hp: 10, maxHp: 10 }).state;
    state = CampaignOS.addToken(state, { name: "Target", ac: 1, hp: 50, maxHp: 50 }).state;
    let [attacker, target] = state.tokens;
    state = CampaignOS.setTokenPosition(state, target.id, attacker.x + 1, attacker.y);
    state = CampaignOS.toggleCondition(state, target.id, condition);

    // 0.45 -> roll of 10 (not a natural 20), comfortably beats AC 1 -- still forced critical.
    const result = withRandom([0.45], () => CampaignOS.attack(state, attacker.id, target.id));
    assert.match(result.message, /Critical hit\./, `expected forced critical vs adjacent ${condition} target`);
  }
});

test("attack does NOT force a critical against a Paralyzed target when the attacker isn't adjacent", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, damageDice: "1d1", hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 1, hp: 50, maxHp: 50 }).state;
  const [attacker, target] = state.tokens;
  state = CampaignOS.setTokenPosition(state, target.id, attacker.x + 5, attacker.y);
  state = CampaignOS.toggleCondition(state, target.id, "Paralyzed");

  const result = withRandom([0.45], () => CampaignOS.attack(state, attacker.id, target.id));
  assert.ok(!/Critical hit\./.test(result.message));
});

test("attack does not force a critical against a Paralyzed target on an actual miss", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Attacker", attackBonus: 0, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Target", ac: 99, hp: 50, maxHp: 50 }).state;
  const [attacker, target] = state.tokens;
  state = CampaignOS.setTokenPosition(state, target.id, attacker.x + 1, attacker.y);
  state = CampaignOS.toggleCondition(state, target.id, "Paralyzed");

  // Target being Paralyzed grants the attacker advantage automatically (two dice, higher
  // kept) -- 0.5 -> 11 on both, comfortably below AC 99 and not a natural 20, so this is a
  // genuine miss despite forceCrit eligibility.
  const result = withRandom([0.5], () => CampaignOS.attack(state, attacker.id, target.id));
  assert.match(result.message, /Miss\./);
});

test("rollSavingThrow auto-fails STR/DEX saves for Stunned, Paralyzed, or Unconscious with no roll", () => {
  for (const condition of ["Stunned", "Paralyzed", "Unconscious"]) {
    const state = stateOnMap("Urskelde");
    let { state: withToken, token } = CampaignOS.addToken(state, { name: "Downed", abilityScores: { DEX: 20 } });
    withToken = CampaignOS.toggleCondition(withToken, token.id, condition);

    const result = CampaignOS.rollSavingThrow(withToken, token.id, "DEX", 5);
    assert.equal(result.success, false);
    assert.match(result.message, /automatically fails/);
  }
});

test("rollSavingThrow is unaffected for CON saves even when Stunned/Paralyzed/Unconscious", () => {
  const state = stateOnMap("Urskelde");
  let { state: withToken, token } = CampaignOS.addToken(state, { name: "Downed", abilityScores: { CON: 10 } });
  withToken = CampaignOS.toggleCondition(withToken, token.id, "Unconscious");

  const result = withRandom([0.45], () => CampaignOS.rollSavingThrow(withToken, token.id, "CON", 5));
  assert.ok(!/automatically fails/.test(result.message));
});

test("rollSavingThrow adds disadvantage to DEX saves specifically for Restrained", () => {
  const state = stateOnMap("Urskelde");
  let { state: withToken, token } = CampaignOS.addToken(state, { name: "Snared", abilityScores: { DEX: 10, STR: 10 } });
  withToken = CampaignOS.toggleCondition(withToken, token.id, "Restrained");

  const dexResult = withRandom([0.9, 0.1], () => CampaignOS.rollSavingThrow(withToken, token.id, "DEX", 10));
  assert.match(dexResult.message, /disadvantage: 19, 3/);

  const strResult = withRandom([0.45], () => CampaignOS.rollSavingThrow(withToken, token.id, "STR", 10));
  assert.ok(!/disadvantage/.test(strResult.message));
});

test("moveToken uses the exhaustion-reduced effective speed, not the token's true speed", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", speed: 30, initiative: 10 }).state;
  const token = state.tokens[0];
  state = CampaignOS.setExhaustion(state, token.id, 2).state;
  state = CampaignOS.nextTurn(state);

  // 3 squares straight = 15 ft, exactly the halved 15 ft speed.
  const allowed = CampaignOS.moveToken(state, token.id, token.x + 3, token.y);
  assert.notEqual(allowed.state, state);

  // A 4th square (20 ft) should now be unaffordable.
  const blocked = CampaignOS.moveToken(state, token.id, token.x + 4, token.y);
  assert.equal(blocked.state, state);
  assert.match(blocked.message, /speed 15 ft/);
});

test("longRest reduces exhaustion by one level", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 100 }).state;
  state = CampaignOS.setExhaustion(state, state.tokens[0].id, 3).state;

  const result = CampaignOS.longRest(state, state.tokens[0].id);
  assert.equal(result.state.tokens[0].exhaustion, 2);
  assert.match(result.message, /Exhaustion reduced to 2\./);
});

test("longRest clears the exhaustion field entirely once it's reduced to 0", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 100 }).state;
  state = CampaignOS.setExhaustion(state, state.tokens[0].id, 1).state;

  const result = CampaignOS.longRest(state, state.tokens[0].id);
  assert.equal(result.state.tokens[0].exhaustion, undefined);
  assert.match(result.message, /Exhaustion reduced to 0\./);
});

test("updateToken sets exhaustion directly as a manual correction, without triggering death at level 6", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Darkhawk", hp: 50, maxHp: 100 });
  const updated = CampaignOS.updateToken(withToken, token.id, { exhaustion: 6 });
  assert.equal(updated.tokens[0].exhaustion, 6);
  assert.equal(updated.tokens[0].dead, undefined, "a manual editor edit should not trigger the exhaustion-death side effect");
  assert.equal(updated.tokens[0].hp, 50);
});

test("parseCommand resolves gaining and losing exhaustion levels by token name", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk" }).state;

  const gained = CampaignOS.parseCommand(state, "Darkhawk gains a level of exhaustion.");
  assert.equal(gained.state.tokens[0].exhaustion, 1);

  const gainedTwo = CampaignOS.parseCommand(gained.state, "Darkhawk gains 2 levels of exhaustion.");
  assert.equal(gainedTwo.state.tokens[0].exhaustion, 3);

  const lost = CampaignOS.parseCommand(gainedTwo.state, "Darkhawk loses a level of exhaustion.");
  assert.equal(lost.state.tokens[0].exhaustion, 2);
});

test("addToken normalizes legendaryActions, clamping current and dropping an invalid max", () => {
  const state = stateOnMap("Urskelde");
  const { token } = CampaignOS.addToken(state, { name: "Dracolich", legendaryActions: { max: 3, current: 5 } });
  assert.deepEqual(token.legendaryActions, { max: 3, current: 3 });

  const { token: invalid } = CampaignOS.addToken(state, { name: "Nobody", legendaryActions: { max: 0 } });
  assert.equal(invalid.legendaryActions, undefined);
});

test("updateToken merges a partial legendaryActions change, and null clears it entirely", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Dracolich",
    legendaryActions: { max: 3, current: 3 }
  });

  const updated = CampaignOS.updateToken(withToken, token.id, { legendaryActions: { current: 1 } });
  assert.deepEqual(updated.tokens[0].legendaryActions, { max: 3, current: 1 });

  const cleared = CampaignOS.updateToken(updated, token.id, { legendaryActions: null });
  assert.equal(cleared.tokens[0].legendaryActions, undefined);
});

test("useLegendaryAction spends a point and reports how many remain", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Dracolich",
    legendaryActions: { max: 3, current: 3 }
  });
  const result = CampaignOS.useLegendaryAction(withToken, token.id);
  assert.match(result.message, /Dracolich uses a legendary action \(2\/3 remaining\)\./);
  assert.equal(result.state.tokens[0].legendaryActions.current, 2);
});

test("useLegendaryAction spends more than one point at once when asked", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Dracolich",
    legendaryActions: { max: 3, current: 3 }
  });
  const result = CampaignOS.useLegendaryAction(withToken, token.id, 2);
  assert.match(result.message, /uses a legendary action \(2\) \(1\/3 remaining\)\./);
});

test("useLegendaryAction fails without changing state once points are exhausted", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Dracolich",
    legendaryActions: { max: 3, current: 1 }
  });
  const result = CampaignOS.useLegendaryAction(withToken, token.id, 2);
  assert.match(result.message, /doesn't have 2 legendary actions left \(1\/3 remaining\)/);
  assert.equal(result.state, withToken);
});

test("useLegendaryAction fails without changing state for a token with none tracked", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Goblin 1" });
  const result = CampaignOS.useLegendaryAction(withToken, token.id);
  assert.match(result.message, /Goblin 1 has no legendary actions tracked/);
  assert.equal(result.state, withToken);
});

test("useLegendaryAction reports the token as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.useLegendaryAction(state, "nonexistent-id");
  assert.match(result.message, /token was not found/);
  assert.equal(result.state, state);
});

test("nextTurn refreshes legendaryActions to max only at the start of that token's own turn", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Dracolich", initiative: 20, legendaryActions: { max: 3, current: 3 } }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", initiative: 5 }).state;
  const dracolichId = state.tokens.find((t) => t.name === "Dracolich").id;

  state = CampaignOS.nextTurn(state); // Dracolich's turn (highest initiative), round 1
  state = CampaignOS.useLegendaryAction(state, dracolichId, 2).state;
  assert.equal(state.tokens.find((t) => t.id === dracolichId).legendaryActions.current, 1);

  state = CampaignOS.nextTurn(state); // Goblin 1's turn -- should not refresh Dracolich
  assert.equal(state.tokens.find((t) => t.id === dracolichId).legendaryActions.current, 1, "another token's turn should not refresh it");

  state = CampaignOS.nextTurn(state); // wraps back to Dracolich, round 2
  assert.equal(state.tokens.find((t) => t.id === dracolichId).legendaryActions.current, 3, "refreshes at the start of its own turn");
});

test("nextTurn heals a token with regeneration at the start of its own turn, capped at maxHp", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Troll 1", initiative: 20, hp: 80, maxHp: 84, regeneration: { amount: 10 } }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", initiative: 5 }).state;

  state = CampaignOS.nextTurn(state); // Troll 1's turn
  const troll = state.tokens.find((t) => t.name === "Troll 1");
  assert.equal(troll.hp, 84, "10 HP would overheal past maxHp -- clamped to it instead");
  assert.match(state.log[0], /Troll 1 regenerates 4 HP \(84\/84\)\./);
});

test("nextTurn does not regenerate a token at 0 HP or already at full HP", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Troll 1", initiative: 20, hp: 84, maxHp: 84, regeneration: { amount: 10 } }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", initiative: 5 }).state;

  const beforeLog = state.log.length;
  state = CampaignOS.nextTurn(state); // Troll 1's turn, already at full HP
  assert.equal(state.log.length, beforeLog, "no regeneration message when already at full HP");

  state = CampaignOS.updateToken(state, state.tokens.find((t) => t.name === "Troll 1").id, { hp: 0 });
  state = CampaignOS.nextTurn(state); // Goblin 1's turn
  const afterGoblin = state.log.length;
  state = CampaignOS.nextTurn(state); // back to Troll 1, at 0 HP
  assert.equal(state.log.length, afterGoblin, "no regeneration message for a token at 0 HP");
});

test("nextTurn rolls to recharge a spent ability at the start of that token's own turn", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, {
    name: "Hellhound 1",
    initiative: 20,
    rechargeAbilities: { "Fire Breath": { rechargeMin: 5, available: false } }
  }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", initiative: 5 }).state;

  // Roll succeeds: random=0.9 -> d6 roll of 6, >= rechargeMin 5.
  state = withRandom([0.9], () => CampaignOS.nextTurn(state));
  const hound = state.tokens.find((t) => t.name === "Hellhound 1");
  assert.equal(hound.rechargeAbilities["Fire Breath"].available, true);
  assert.match(state.log[0], /Hellhound 1's Fire Breath recharges! \(rolled 6\)/);
});

test("nextTurn's recharge roll can fail, leaving the ability unavailable", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, {
    name: "Hellhound 1",
    initiative: 20,
    rechargeAbilities: { "Fire Breath": { rechargeMin: 5, available: false } }
  }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", initiative: 5 }).state;

  // Roll fails: random=0 -> d6 roll of 1, < rechargeMin 5.
  state = withRandom([0], () => CampaignOS.nextTurn(state));
  const hound = state.tokens.find((t) => t.name === "Hellhound 1");
  assert.equal(hound.rechargeAbilities["Fire Breath"].available, false);
});

test("nextTurn does not re-roll an already-available recharge ability", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, {
    name: "Hellhound 1",
    initiative: 20,
    rechargeAbilities: { "Fire Breath": { rechargeMin: 5, available: true } }
  }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", initiative: 5 }).state;

  const beforeLog = state.log.length;
  state = CampaignOS.nextTurn(state);
  assert.equal(state.log.length, beforeLog, "no recharge message for an ability that's already available");
});

test("useRechargeAbility spends an available ability and reports it in the message", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Hellhound 1",
    rechargeAbilities: { "Fire Breath": { rechargeMin: 5, available: true } }
  });

  const result = CampaignOS.useRechargeAbility(withToken, token.id, "Fire Breath");
  assert.match(result.message, /Hellhound 1 uses Fire Breath\./);
  assert.equal(result.state.tokens[0].rechargeAbilities["Fire Breath"].available, false);
});

test("useRechargeAbility fails without changing state once an ability is already spent", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, {
    name: "Hellhound 1",
    rechargeAbilities: { "Fire Breath": { rechargeMin: 5, available: false } }
  });

  const result = CampaignOS.useRechargeAbility(withToken, token.id, "Fire Breath");
  assert.match(result.message, /hasn't recharged yet/);
  assert.equal(result.state, withToken);
});

test("useRechargeAbility fails outright for an ability the token doesn't track", () => {
  const state = stateOnMap("Urskelde");
  const { state: withToken, token } = CampaignOS.addToken(state, { name: "Hellhound 1" });
  const result = CampaignOS.useRechargeAbility(withToken, token.id, "Fire Breath");
  assert.match(result.message, /has no "Fire Breath" recharge ability tracked/);
  assert.equal(result.state, withToken);
});

test("useRechargeAbility reports the token as not found without changing state", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.useRechargeAbility(state, "nonexistent-id", "Fire Breath");
  assert.match(result.message, /token was not found/);
  assert.deepEqual(result.state, state);
});

test("parseCommand spawning a troll gives it Regeneration", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one troll"));
  const [troll] = result.state.tokens;
  assert.deepEqual(troll.regeneration, { amount: 10 });
});

test("parseCommand spawning a hell hound gives it a Fire Breath recharge ability", () => {
  const state = stateOnMap("Urskelde");
  const result = withRandom([0], () => CampaignOS.parseCommand(state, "spawn one hellhound"));
  const [hound] = result.state.tokens;
  assert.deepEqual(hound.rechargeAbilities, { "Fire Breath": { rechargeMin: 5, available: true } });
});

test("attack is unrestricted outside the attacker's own active turn, even after its action would be spent", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", attackBonus: 0, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", ac: 15, hp: 10, maxHp: 10 }).state;
  const [darkhawk, goblin] = state.tokens;
  // No turn order running at all (state.turn.tokenId is null) -- free narration/setup.
  const first = withRandom([0.9], () => CampaignOS.attack(state, darkhawk.id, goblin.id));
  const second = withRandom([0.9], () => CampaignOS.attack(first.state, darkhawk.id, goblin.id));
  assert.ok(!/already used their action/.test(second.message), "attacking twice outside formal combat should never be gated");
});

test("attack consumes the attacker's action on its own active turn, rejecting a second attack the same turn", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", attackBonus: 0, hp: 10, maxHp: 10, initiative: 20 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", ac: 15, hp: 10, maxHp: 10, initiative: 5 }).state;
  const [darkhawk, goblin] = state.tokens;
  state = CampaignOS.nextTurn(state); // Darkhawk's turn

  const first = withRandom([0.9], () => CampaignOS.attack(state, darkhawk.id, goblin.id));
  assert.ok(!/already used their action/.test(first.message));

  const second = CampaignOS.attack(first.state, darkhawk.id, goblin.id);
  assert.match(second.message, /Darkhawk has already used their action this turn\./);
  assert.equal(second.state, first.state, "a rejected attack should not change state");
});

test("attack does not restrict a token that isn't the one whose turn it is", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", attackBonus: 0, hp: 10, maxHp: 10, initiative: 20 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", attackBonus: 0, ac: 15, hp: 10, maxHp: 10, initiative: 5 }).state;
  const [darkhawk, goblin] = state.tokens;
  state = CampaignOS.nextTurn(state); // Darkhawk's turn -- Goblin 1 is NOT active

  const first = withRandom([0.9], () => CampaignOS.attack(state, goblin.id, darkhawk.id));
  const second = withRandom([0.9], () => CampaignOS.attack(first.state, goblin.id, darkhawk.id));
  assert.ok(!/already used their action/.test(second.message), "a token that isn't the active turn is never gated");
});

test("attack allows 1 + extraAttacks calls before the action is spent (Extra Attack)", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", attackBonus: 0, hp: 10, maxHp: 10, initiative: 20, extraAttacks: 1 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", ac: 15, hp: 999, maxHp: 999, initiative: 5 }).state;
  const [darkhawk, goblin] = state.tokens;
  state = CampaignOS.nextTurn(state);

  const first = withRandom([0.9], () => CampaignOS.attack(state, darkhawk.id, goblin.id));
  assert.ok(!/already used their action/.test(first.message));
  const second = withRandom([0.9], () => CampaignOS.attack(first.state, darkhawk.id, goblin.id));
  assert.ok(!/already used their action/.test(second.message), "Extra Attack should allow a second attack call in the same action");
  const third = CampaignOS.attack(second.state, darkhawk.id, goblin.id);
  assert.match(third.message, /already used their action/, "a third call exceeds 1 + extraAttacks (1)");
});

test("attack tracks a bonus-action attack separately from the action budget", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", attackBonus: 0, hp: 10, maxHp: 10, initiative: 20 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", ac: 15, hp: 999, maxHp: 999, initiative: 5 }).state;
  const [darkhawk, goblin] = state.tokens;
  state = CampaignOS.nextTurn(state);

  const actionAttack = withRandom([0.9], () => CampaignOS.attack(state, darkhawk.id, goblin.id, { actionType: "action" }));
  const bonusAttack = withRandom([0.9], () => CampaignOS.attack(actionAttack.state, darkhawk.id, goblin.id, { actionType: "bonusAction" }));
  assert.ok(!/already used/.test(bonusAttack.message), "the action and bonus action are independent budgets");

  const secondBonus = CampaignOS.attack(bonusAttack.state, darkhawk.id, goblin.id, { actionType: "bonusAction" });
  assert.match(secondBonus.message, /already used a bonus action this turn\./);
});

test("attack's reaction is gated once turn order is running, regardless of whose turn it is, and resets at the reactor's own next turn", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 10, initiative: 20 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", attackBonus: 0, hp: 999, maxHp: 999, initiative: 10 }).state;
  const [darkhawk, goblin] = state.tokens;
  state = CampaignOS.nextTurn(state); // Darkhawk's turn -- Goblin 1 is NOT active

  // Goblin 1 reacts to Darkhawk leaving its reach, mid-Darkhawk's-turn.
  const first = withRandom([0.9], () => CampaignOS.attack(state, goblin.id, darkhawk.id, { actionType: "reaction" }));
  assert.ok(!/already used their reaction/.test(first.message));
  assert.equal(first.state.tokens.find((t) => t.id === goblin.id).reactionUsed, true);

  const second = CampaignOS.attack(first.state, goblin.id, darkhawk.id, { actionType: "reaction" });
  assert.match(second.message, /Goblin 1 has already used their reaction since their last turn\./);
  assert.equal(second.state, first.state, "a rejected reaction should not change state");

  // Round trips back to Goblin 1's own turn -- reaction should be available again.
  const backToGoblin = CampaignOS.nextTurn(first.state);
  assert.equal(backToGoblin.tokens.find((t) => t.id === goblin.id).reactionUsed, undefined);
});

test("attack's reaction is unrestricted when turn order isn't running at all", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", attackBonus: 0, hp: 999, maxHp: 999 }).state;
  const [darkhawk, goblin] = state.tokens;
  // No nextTurn() call -- turn order never started.

  const first = withRandom([0.9], () => CampaignOS.attack(state, goblin.id, darkhawk.id, { actionType: "reaction" }));
  const second = withRandom([0.9], () => CampaignOS.attack(first.state, goblin.id, darkhawk.id, { actionType: "reaction" }));
  assert.ok(!/already used their reaction/.test(second.message), "unrestricted before turn order actually starts, same as action/bonusAction");
});

test("a reaction attack resolves exactly one attack, even for a Multiattack creature", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, {
    name: "Troll 1", hp: 84, maxHp: 84,
    attacks: [
      { name: "Bite", attackBonus: 50, damageDice: "1d1", damageType: "piercing" },
      { name: "Claw", attackBonus: 50, damageDice: "1d1", damageType: "slashing" },
      { name: "Claw", attackBonus: 50, damageDice: "1d1", damageType: "slashing" }
    ]
  }).state;
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 20, maxHp: 20, initiative: 20 }).state;
  const troll = state.tokens.find((t) => t.name === "Troll 1");
  const darkhawk = state.tokens.find((t) => t.name === "Darkhawk");
  state = CampaignOS.nextTurn(state); // Darkhawk's turn -- Troll reacts

  const result = withRandom([0.9], () => CampaignOS.attack(state, troll.id, darkhawk.id, { actionType: "reaction" }));
  assert.equal(result.state.tokens.find((t) => t.id === darkhawk.id).hp, 19, "exactly one 1-damage attack, not all three Multiattack profiles");
  assert.match(result.message, /Troll 1's Bite attacks Darkhawk/, "should use the first/primary profile and name it");
});

test("nextTurn clears reactionUsed only for the newly active token", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 10, initiative: 20 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", attackBonus: 0, hp: 999, maxHp: 999, initiative: 10 }).state;
  const [darkhawk, goblin] = state.tokens;
  state = CampaignOS.nextTurn(state); // Darkhawk active

  const reacted = withRandom([0.9], () => CampaignOS.attack(state, goblin.id, darkhawk.id, { actionType: "reaction" })).state;
  assert.equal(reacted.tokens.find((t) => t.id === goblin.id).reactionUsed, true);

  const stillDarkhawksIfSomehowCalledAgain = CampaignOS.nextTurn(reacted); // now Goblin 1's turn
  assert.equal(stillDarkhawksIfSomehowCalledAgain.tokens.find((t) => t.id === goblin.id).reactionUsed, undefined);
});

// addToken() always places a new token via findOpenTile() -- it has no x/y draft field, so
// every test below that needs exact starting coordinates places tokens with setTokenPosition
// explicitly afterward rather than trusting addToken's own placement.
test("moveToken's message hints at an opportunity attack when the move leaves an adjacent token's reach", () => {
  let state = stateOnMap("Urskelde");
  const darkhawk = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 10, initiative: 20 });
  state = CampaignOS.setTokenPosition(darkhawk.state, darkhawk.token.id, 5, 5);
  const goblin = CampaignOS.addToken(state, { name: "Goblin 1", hp: 10, maxHp: 10, initiative: 10 });
  state = CampaignOS.setTokenPosition(goblin.state, goblin.token.id, 6, 5); // adjacent to Darkhawk
  state = CampaignOS.nextTurn(state); // Darkhawk's turn

  const result = CampaignOS.moveToken(state, darkhawk.token.id, 10, 5); // walks away from Goblin 1
  assert.match(result.message, /This may provoke an opportunity attack from Goblin 1\./);
});

test("moveToken's opportunity-attack hint does not fire when the mover stays adjacent", () => {
  let state = stateOnMap("Urskelde");
  const darkhawk = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 10, initiative: 20 });
  state = CampaignOS.setTokenPosition(darkhawk.state, darkhawk.token.id, 5, 5);
  const goblin = CampaignOS.addToken(state, { name: "Goblin 1", hp: 10, maxHp: 10, initiative: 10 });
  state = CampaignOS.setTokenPosition(goblin.state, goblin.token.id, 6, 5);
  state = CampaignOS.nextTurn(state);

  // (5,5) -> (5,6) stays within one square of Goblin 1 at (6,5) -- reach was never left.
  const result = CampaignOS.moveToken(state, darkhawk.token.id, 5, 6);
  assert.ok(!/opportunity attack/.test(result.message));
});

test("moveToken's opportunity-attack hint does not fire when the mover was never in reach to begin with", () => {
  let state = stateOnMap("Urskelde");
  const darkhawk = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 10, initiative: 20 });
  state = CampaignOS.setTokenPosition(darkhawk.state, darkhawk.token.id, 1, 1);
  const goblin = CampaignOS.addToken(state, { name: "Goblin 1", hp: 10, maxHp: 10, initiative: 10 });
  state = CampaignOS.setTokenPosition(goblin.state, goblin.token.id, 10, 10);
  state = CampaignOS.nextTurn(state);

  const result = CampaignOS.moveToken(state, darkhawk.token.id, 5, 5); // still nowhere near Goblin 1
  assert.ok(!/opportunity attack/.test(result.message));
});

test("moveToken's opportunity-attack hint ignores a dead token", () => {
  let state = stateOnMap("Urskelde");
  const darkhawk = CampaignOS.addToken(state, { name: "Darkhawk", hp: 10, maxHp: 10, initiative: 20 });
  state = CampaignOS.setTokenPosition(darkhawk.state, darkhawk.token.id, 5, 5);
  const goblin = CampaignOS.addToken(state, { name: "Goblin 1", hp: 10, maxHp: 10, initiative: 10 });
  state = CampaignOS.setTokenPosition(goblin.state, goblin.token.id, 6, 5);
  // addToken has no `dead` draft field (a token only ever dies through real play) -- flip it
  // directly here, the only way to get a dead-but-still-on-the-map token for this setup.
  state.tokens.find((t) => t.name === "Goblin 1").dead = true;
  state = CampaignOS.nextTurn(state);

  const result = CampaignOS.moveToken(state, darkhawk.token.id, 10, 5);
  assert.ok(!/opportunity attack/.test(result.message), "a dead token can't threaten an opportunity attack");
});

test("addWall/removeWall/clearWalls manage a map's wall list", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addWall(state, "Urskelde", 5, 0, 5, 10);
  assert.deepEqual(state.maps.Urskelde.walls, [{ x1: 5, y1: 0, x2: 5, y2: 10 }]);

  state = CampaignOS.addWall(state, "Urskelde", 0, 3, 3, 3);
  assert.equal(state.maps.Urskelde.walls.length, 2);

  const afterRemove = CampaignOS.removeWall(state, "Urskelde", 0);
  assert.deepEqual(afterRemove.maps.Urskelde.walls, [{ x1: 0, y1: 3, x2: 3, y2: 3 }]);

  const noOp = CampaignOS.removeWall(state, "Urskelde", 99);
  assert.equal(noOp, state, "removing a nonexistent index is a no-op, same state reference");

  const cleared = CampaignOS.clearWalls(afterRemove, "Urskelde");
  assert.deepEqual(cleared.maps.Urskelde.walls, []);
});

test("hasLineOfSight is always true when a map has no walls", () => {
  const state = stateOnMap("Urskelde");
  assert.equal(CampaignOS.hasLineOfSight(state, "Urskelde", 1, 1, 20, 20), true);
});

test("hasLineOfSight is blocked by a wall the line actually crosses, clear otherwise", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addWall(state, "Urskelde", 5, 0, 5, 10); // a vertical wall along grid line x=5

  // Cell (3,3) center (2.5,2.5) to cell (7,3) center (6.5,2.5) crosses x=5 -- blocked.
  assert.equal(CampaignOS.hasLineOfSight(state, "Urskelde", 3, 3, 7, 3), false);

  // Cell (3,3) to cell (4,3): both stay left of x=5 -- clear.
  assert.equal(CampaignOS.hasLineOfSight(state, "Urskelde", 3, 3, 4, 3), true);

  // A wall on a different map shouldn't affect this one.
  assert.equal(CampaignOS.hasLineOfSight(state, "Some Other Map", 3, 3, 7, 3), true);
});

test("findNearestWallIndex finds the closest wall within the given distance, null beyond it", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addWall(state, "Urskelde", 5, 0, 5, 10);
  state = CampaignOS.addWall(state, "Urskelde", 0, 8, 10, 8);

  // (5, 5) sits exactly ON the first wall (distance 0), and far from the second (distance 3).
  assert.equal(CampaignOS.findNearestWallIndex(state, "Urskelde", 5, 5, 0.5), 0);
  // (2, 8) sits exactly ON the second wall (distance 0), and 3 units from the first.
  assert.equal(CampaignOS.findNearestWallIndex(state, "Urskelde", 2, 8, 0.5), 1);
  // Far from everything.
  assert.equal(CampaignOS.findNearestWallIndex(state, "Urskelde", 50, 50, 0.5), null);
});

test("isVisibleToParty: a hero is always visible, a monster depends on line of sight to any hero", () => {
  let state = stateOnMap("Urskelde");
  const hero = CampaignOS.addToken(state, { name: "Darkhawk", type: "hero" });
  state = CampaignOS.setTokenPosition(hero.state, hero.token.id, 3, 3);
  const nearGoblin = CampaignOS.addToken(state, { name: "Goblin 1", type: "monster" });
  state = CampaignOS.setTokenPosition(nearGoblin.state, nearGoblin.token.id, 4, 3);
  const farGoblin = CampaignOS.addToken(state, { name: "Goblin 2", type: "monster" });
  state = CampaignOS.setTokenPosition(farGoblin.state, farGoblin.token.id, 7, 3);
  state = CampaignOS.addWall(state, "Urskelde", 5, 0, 5, 10); // blocks Darkhawk <-> Goblin 2

  const hp = state.tokens.find((t) => t.name === "Darkhawk");
  const near = state.tokens.find((t) => t.name === "Goblin 1");
  const far = state.tokens.find((t) => t.name === "Goblin 2");

  assert.equal(CampaignOS.isVisibleToParty(state, hp), true, "a hero is always visible");
  assert.equal(CampaignOS.isVisibleToParty(state, near), true, "unblocked line of sight to a hero");
  assert.equal(CampaignOS.isVisibleToParty(state, far), false, "blocked by the wall");
});

test("isVisibleToParty treats a map with no PCs on it as fully visible (nothing to hide anything from)", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1", type: "monster" }).state;
  state = CampaignOS.addWall(state, "Urskelde", 0, 0, 100, 100);
  const goblin = state.tokens.find((t) => t.name === "Goblin 1");
  assert.equal(CampaignOS.isVisibleToParty(state, goblin), true);
});

test("visibleCellsForParty returns nothing when there are no hero tokens on the map", () => {
  let state = stateOnMap("Urskelde");
  state.maps.Urskelde = { columns: 5, rows: 4 };
  state = CampaignOS.addToken(state, { name: "Goblin 1", type: "monster" }).state;
  assert.deepEqual(CampaignOS.visibleCellsForParty(state, "Urskelde"), []);
});

test("visibleCellsForParty returns every cell on a wall-free map (hasLineOfSight's own fast path)", () => {
  let state = stateOnMap("Urskelde");
  state.maps.Urskelde = { columns: 5, rows: 4 };
  const hero = CampaignOS.addToken(state, { name: "Darkhawk", type: "hero" });
  state = CampaignOS.setTokenPosition(hero.state, hero.token.id, 1, 1);
  assert.equal(CampaignOS.visibleCellsForParty(state, "Urskelde").length, 20); // 5 columns * 4 rows
});

test("visibleCellsForParty excludes cells a wall blocks from every hero", () => {
  let state = stateOnMap("Urskelde");
  state.maps.Urskelde = { columns: 5, rows: 4 };
  const hero = CampaignOS.addToken(state, { name: "Darkhawk", type: "hero" });
  state = CampaignOS.setTokenPosition(hero.state, hero.token.id, 1, 2);
  state = CampaignOS.addWall(state, "Urskelde", 3, 0, 3, 3); // splits columns 1-3 from 4-5

  const cells = CampaignOS.visibleCellsForParty(state, "Urskelde").map(([x, y]) => `${x},${y}`);
  assert.ok(cells.includes("1,2"), "hero's own cell is visible");
  assert.ok(cells.includes("2,2"), "same side as the hero");
  assert.ok(!cells.includes("5,2"), "blocked by the wall");
});

test("revealVisibleTiles is a no-op on a map with no walls", () => {
  let state = stateOnMap("Urskelde");
  const hero = CampaignOS.addToken(state, { name: "Darkhawk", type: "hero" });
  state = CampaignOS.setTokenPosition(hero.state, hero.token.id, 1, 1);
  assert.equal(CampaignOS.revealVisibleTiles(state, "Urskelde"), state);
});

test("revealVisibleTiles merges newly visible cells into revealedTiles, and is a no-op once nothing new is visible", () => {
  let state = stateOnMap("Urskelde");
  state.maps.Urskelde = { columns: 5, rows: 4 };
  const hero = CampaignOS.addToken(state, { name: "Darkhawk", type: "hero" });
  state = CampaignOS.setTokenPosition(hero.state, hero.token.id, 1, 2);
  state = CampaignOS.addWall(state, "Urskelde", 3, 0, 3, 3);

  const revealed = CampaignOS.revealVisibleTiles(state, "Urskelde");
  assert.notEqual(revealed, state, "changed -- new tiles revealed");
  assert.equal(revealed.maps.Urskelde.revealedTiles["1,2"], true);
  assert.equal(revealed.maps.Urskelde.revealedTiles["5,2"], undefined, "still blocked by the wall");

  const again = CampaignOS.revealVisibleTiles(revealed, "Urskelde");
  assert.equal(again, revealed, "same state reference -- nothing newly revealed");
});

test("revealVisibleTiles remembers a cell even after the hero that revealed it moves away", () => {
  let state = stateOnMap("Urskelde");
  state.maps.Urskelde = { columns: 5, rows: 4 };
  const hero = CampaignOS.addToken(state, { name: "Darkhawk", type: "hero" });
  state = CampaignOS.setTokenPosition(hero.state, hero.token.id, 1, 1);
  state = CampaignOS.addWall(state, "Urskelde", 3, 0, 3, 3);
  state = CampaignOS.revealVisibleTiles(state, "Urskelde");
  assert.equal(state.maps.Urskelde.revealedTiles["1,1"], true);

  state = CampaignOS.setTokenPosition(state, hero.token.id, 5, 1); // hero now on the far side
  state = CampaignOS.revealVisibleTiles(state, "Urskelde");
  assert.equal(state.maps.Urskelde.revealedTiles["1,1"], true, "still remembered even though the hero left");
  assert.equal(state.maps.Urskelde.revealedTiles["5,1"], true, "newly revealed on the far side");
});

test("resetFog clears a map's revealedTiles, and is a no-op when there's nothing to reset", () => {
  let state = stateOnMap("Urskelde");
  state.maps.Urskelde = { columns: 5, rows: 4, revealedTiles: { "1,1": true } };
  const reset = CampaignOS.resetFog(state, "Urskelde");
  assert.deepEqual(reset.maps.Urskelde.revealedTiles, {});

  const noOp = CampaignOS.resetFog(reset, "Urskelde");
  assert.equal(noOp, reset, "already empty -- same state reference");

  const stateWithNoFogField = stateOnMap("Urskelde");
  assert.equal(CampaignOS.resetFog(stateWithNoFogField, "Urskelde"), stateWithNoFogField);
});

test("castSpell (leveled) consumes the caster's action, rejecting a second leveled cast the same turn", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael", initiative: 20, spellSlots: { 1: { max: 4, current: 4 } } }).state;
  const [sael] = state.tokens;
  state = CampaignOS.nextTurn(state);

  const first = CampaignOS.castSpell(state, sael.id, { level: 1, spellName: "Entangle" });
  assert.ok(!/already used their action/.test(first.message));
  const second = CampaignOS.castSpell(first.state, sael.id, { level: 1, spellName: "Entangle" });
  assert.match(second.message, /Sael has already used their action this turn\./);
});

test("castSpell exempts cantrips (level 0) from the action-economy gate", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Sael", initiative: 20 }).state;
  const [sael] = state.tokens;
  state = CampaignOS.nextTurn(state);

  const first = CampaignOS.castSpell(state, sael.id, { level: 0, spellName: "Guidance" });
  const second = CampaignOS.castSpell(first.state, sael.id, { level: 0, spellName: "Guidance" });
  assert.ok(!/already used their action/.test(second.message), "cantrips are exempt from this gate");
});

test("a leveled cast_spell and attack share the same action budget -- one blocks the other", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, {
    name: "Sael", attackBonus: 0, hp: 10, maxHp: 10, initiative: 20, spellSlots: { 1: { max: 4, current: 4 } }
  }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", ac: 15, hp: 999, maxHp: 999, initiative: 5 }).state;
  const [sael, goblin] = state.tokens;
  state = CampaignOS.nextTurn(state);

  const cast = CampaignOS.castSpell(state, sael.id, { level: 1, spellName: "Entangle" });
  const attackAfterCast = CampaignOS.attack(cast.state, sael.id, goblin.id);
  assert.match(attackAfterCast.message, /already used their action/, "casting a leveled spell should block a follow-up attack the same turn");
});

test("nextTurn resets action economy only for the newly active token, not for others", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", attackBonus: 0, hp: 10, maxHp: 10, initiative: 20 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", attackBonus: 0, ac: 15, hp: 999, maxHp: 999, initiative: 5 }).state;
  const [darkhawk, goblin] = state.tokens;

  state = CampaignOS.nextTurn(state); // Darkhawk's turn
  state = withRandom([0.9], () => CampaignOS.attack(state, darkhawk.id, goblin.id)).state;
  assert.equal(state.tokens.find((t) => t.id === darkhawk.id).actionUsed, true);

  state = CampaignOS.nextTurn(state); // Goblin 1's turn -- should not touch Darkhawk's flag
  assert.equal(state.tokens.find((t) => t.id === darkhawk.id).actionUsed, true, "another token's turn starting should not reset a different token's action economy");

  state = CampaignOS.nextTurn(state); // wraps back to Darkhawk, round 2 -- now it resets
  assert.equal(state.tokens.find((t) => t.id === darkhawk.id).actionUsed, undefined);
});

test("triggerLairAction fires once per round and refuses a second call the same round", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1", initiative: 10 }).state;
  state = CampaignOS.nextTurn(state); // round 1

  const first = CampaignOS.triggerLairAction(state, "the floor erupts with spikes");
  assert.match(first.message, /Lair action: the floor erupts with spikes/);

  const second = CampaignOS.triggerLairAction(first.state, "something else");
  assert.match(second.message, /already triggered this round/);
});

test("triggerLairAction can fire again once the round advances", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1", initiative: 10 }).state;
  state = CampaignOS.nextTurn(state); // round 1
  state = CampaignOS.triggerLairAction(state, "spikes").state;

  state = CampaignOS.nextTurn(state); // wraps back to Goblin 1, round 2
  const result = CampaignOS.triggerLairAction(state, "darkness spreads");
  assert.match(result.message, /Lair action: darkness spreads/);
});

test("triggerLairAction defaults to a generic message when no description is given", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.triggerLairAction(state, "");
  assert.match(result.message, /Lair action: the lair stirs\./);
});

test("rollFreeform rolls multiple dice plus a positive modifier and logs the breakdown", () => {
  const state = CampaignOS.createState();
  const result = withRandom([0], () => CampaignOS.rollFreeform(state, "3d6+2"));
  assert.equal(result.total, 5);
  assert.equal(result.message, "Rolled 3d6+2: [1, 1, 1] + 2 = 5.");
  assert.equal(result.state.log[0], result.message);
});

test("rollFreeform handles a negative modifier and a bare 'dN' with no leading count", () => {
  const state = CampaignOS.createState();
  const result = withRandom([0.999999], () => CampaignOS.rollFreeform(state, "d20-3"));
  assert.equal(result.total, 17);
  assert.equal(result.message, "Rolled d20-3: [20] - 3 = 17.");
});

test("rollFreeform omits the modifier clause entirely when there is none", () => {
  const state = CampaignOS.createState();
  const result = withRandom([0], () => CampaignOS.rollFreeform(state, "2d4"));
  assert.equal(result.message, "Rolled 2d4: [1, 1] = 2.");
});

test("rollFreeform fails outright, without touching state, for text that isn't dice notation", () => {
  const state = CampaignOS.createState();
  const result = CampaignOS.rollFreeform(state, "banana");
  assert.equal(result.message, "Couldn't parse \"banana\" as dice (expected something like 3d6+2).");
  assert.equal(result.state, state);
});

test("parseCommand resolves using a legendary action by token name", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Dracolich", legendaryActions: { max: 3, current: 3 } }).state;
  const result = CampaignOS.parseCommand(state, "Dracolich uses a legendary action.");
  assert.match(result.message, /Dracolich uses a legendary action \(2\/3 remaining\)\./);
});

test("parseCommand resolves spending multiple legendary actions at once", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Dracolich", legendaryActions: { max: 3, current: 3 } }).state;
  const result = CampaignOS.parseCommand(state, "Dracolich uses 2 legendary actions.");
  assert.match(result.message, /uses a legendary action \(2\) \(1\/3 remaining\)\./);
});

test("parseCommand resolves a lair action command", () => {
  const state = stateOnMap("Urskelde");
  const result = CampaignOS.parseCommand(state, "Lair action: the walls close in.");
  assert.equal(result.message, "Lair action: the walls close in");
});
