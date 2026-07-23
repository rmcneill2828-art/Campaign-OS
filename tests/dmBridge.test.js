const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScriptsInto } = require("./load-script");

const sharedWindow = loadScriptsInto({}, ["engine/encounter.js", "engine/dmBridge.js"]);
const CampaignOS = sharedWindow.CampaignOS;
const CampaignOSDMBridge = sharedWindow.CampaignOSDMBridge;

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

test("applyActions spawns monsters then resolves attacks against the just-spawned names", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", hp: 117, maxHp: 117, ac: 17 }).state;

  const actions = [
    { type: "spawn_monster", monster: "goblin", count: 2 },
    { type: "attack", attacker: "Goblin 1", target: "Darkhawk" },
    { type: "attack", attacker: "Goblin 2", target: "Darkhawk" }
  ];

  const { state: next, messages } = withRandom([0.3], () => CampaignOSDMBridge.applyActions(state, actions));

  const names = next.tokens.map((t) => t.name);
  assert.ok(names.includes("Goblin 1") && names.includes("Goblin 2"), "both goblins should have spawned");
  // Two attack log lines plus the spawn line, most recent first.
  assert.equal(next.log.length, 3);
  assert.match(next.log[0], /Goblin 2 attacks Darkhawk/);
  assert.match(next.log[1], /Goblin 1 attacks Darkhawk/);
  assert.match(next.log[2], /joined the encounter/);
  // messages returns every action's description in order (for the session transcript),
  // regardless of whether it's also sitting in state.log.
  assert.equal(messages.length, 3);
  assert.match(messages[0], /joined the encounter/);
  assert.match(messages[1], /Goblin 1 attacks Darkhawk/);
  assert.match(messages[2], /Goblin 2 attacks Darkhawk/);
});

test("applyActions passes an attack action's advantage/disadvantage flags through to CampaignOS.attack", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1", attackBonus: 0, hp: 10, maxHp: 10 }).state;
  state = CampaignOS.addToken(state, { name: "Darkhawk", ac: 15, hp: 10, maxHp: 10 }).state;

  const { messages } = withRandom([0.2, 0.85], () => CampaignOSDMBridge.applyActions(state, [
    { type: "attack", attacker: "Goblin 1", target: "Darkhawk", advantage: true }
  ]));

  assert.match(messages[0], /advantage: 5, 18/);
});

test("applyActions applies damage, healing, and condition toggles by token name", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Mara Fenn", hp: 50, maxHp: 86 }).state;

  const { state: next, messages } = CampaignOSDMBridge.applyActions(state, [
    { type: "apply_damage", target: "Mara Fenn", amount: 10 },
    { type: "apply_healing", target: "Mara Fenn", amount: 4 },
    { type: "toggle_condition", target: "Mara Fenn", condition: "Prone" }
  ]);

  const mara = next.tokens.find((t) => t.name === "Mara Fenn");
  assert.equal(mara.hp, 44); // 50 - 10 + 4
  assert.deepEqual(mara.conditions, ["Prone"]);
  assert.equal(next.log.length, 3);
  assert.equal(messages.length, 3);
});

test("applyActions logs an unresolved-name message instead of throwing when a target doesn't exist", () => {
  const state = stateOnMap("Urskelde");
  const { state: next, messages } = CampaignOSDMBridge.applyActions(state, [
    { type: "apply_damage", target: "Nonexistent Goblin", amount: 5 }
  ]);
  assert.equal(next.tokens.length, 0);
  assert.match(next.log[0], /could not find "Nonexistent Goblin"/);
  assert.match(messages[0], /could not find "Nonexistent Goblin"/);
});

test("applyActions ignores an unknown action type without throwing", () => {
  const state = stateOnMap("Urskelde");
  const { state: next, messages } = CampaignOSDMBridge.applyActions(state, [{ type: "cast_fireball", target: "everyone" }]);
  assert.deepEqual(next, state);
  assert.deepEqual(messages, []);
});

test("applyActions handles next_turn, naming the newly active token and round", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk", initiative: 20 }).state;
  state = CampaignOS.addToken(state, { name: "Goblin 1", initiative: 5 }).state;

  const { state: next, messages } = CampaignOSDMBridge.applyActions(state, [{ type: "next_turn" }]);
  assert.match(messages[0], /Round 1 -- Darkhawk's turn\./);
  assert.equal(next.turn.tokenId, next.tokens.find((t) => t.name === "Darkhawk").id);
});

test("applyActions handles switch_map for an already-prepared map and rejects an unprepared one", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.setMapImage(state, "The Standing Ring", "image-key-789");

  const ok = CampaignOSDMBridge.applyActions(state, [{ type: "switch_map", map: "The Standing Ring" }]);
  assert.equal(ok.state.mapName, "The Standing Ring");
  assert.match(ok.messages[0], /scene shifts to The Standing Ring/);

  const rejected = CampaignOSDMBridge.applyActions(state, [{ type: "switch_map", map: "Nowhere Prepared" }]);
  assert.equal(rejected.state.mapName, "Urskelde", "an unprepared map should not change the active map");
  assert.match(rejected.messages[0], /could not find a prepared map/);
});

test("applyActions moves a token to the requested grid position", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1" }).state; // lands at (4, 4)

  const { state: next, messages } = CampaignOSDMBridge.applyActions(state, [
    { type: "move_token", target: "Goblin 1", x: 7, y: 3 }
  ]);

  const goblin = next.tokens.find((t) => t.name === "Goblin 1");
  assert.equal(goblin.x, 7);
  assert.equal(goblin.y, 3);
  assert.match(messages[0], /Goblin 1 moves to \(7, 3\)/);
});

test("applyActions rejects a move_token action that exceeds the active turn's remaining speed", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1", speed: 10, initiative: 10 }).state; // 2 squares at 5 ft/square
  state = CampaignOS.nextTurn(state); // Goblin 1 becomes the active turn

  const goblin = state.tokens[0];
  const { state: next, messages } = CampaignOSDMBridge.applyActions(state, [
    { type: "move_token", target: "Goblin 1", x: goblin.x + 3, y: goblin.y }
  ]);

  assert.match(messages[0], /can't reach/);
  assert.equal(next.tokens[0].x, goblin.x, "the token should not have moved");
});

test("applyActions clamps move_token coordinates to the current map's grid bounds", () => {
  let state = stateOnMap("Urskelde"); // default grid is 12 columns x 8 rows
  state = CampaignOS.addToken(state, { name: "Goblin 1" }).state;

  const { state: next } = CampaignOSDMBridge.applyActions(state, [
    { type: "move_token", target: "Goblin 1", x: 999, y: -5 }
  ]);

  const goblin = next.tokens.find((t) => t.name === "Goblin 1");
  assert.equal(goblin.x, 12);
  assert.equal(goblin.y, 1);
});

test("applyActions reports a blocked move instead of moving onto an occupied tile", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Goblin 1" }).state; // (4, 4)
  state = CampaignOS.addToken(state, { name: "Goblin 2" }).state; // (5, 4)

  const { state: next, messages } = CampaignOSDMBridge.applyActions(state, [
    { type: "move_token", target: "Goblin 1", x: 5, y: 4 }
  ]);

  const goblin1 = next.tokens.find((t) => t.name === "Goblin 1");
  assert.equal(goblin1.x, 4);
  assert.equal(goblin1.y, 4);
  assert.match(messages[0], /could not move to \(5, 4\) -- tile occupied/);
});

test("applyActions logs an unresolved-name message for move_token targeting an unknown token", () => {
  const state = stateOnMap("Urskelde");
  const { messages } = CampaignOSDMBridge.applyActions(state, [
    { type: "move_token", target: "Nonexistent Goblin", x: 5, y: 5 }
  ]);
  assert.match(messages[0], /could not find "Nonexistent Goblin" to move/);
});

test("findTokenByName matches case-insensitively on the current map only", () => {
  let state = stateOnMap("Urskelde");
  state = CampaignOS.addToken(state, { name: "Darkhawk" }).state;
  const found = CampaignOSDMBridge.findTokenByName(state, "darkhawk");
  assert.ok(found);
  assert.equal(found.name, "Darkhawk");
  assert.equal(CampaignOSDMBridge.findTokenByName(state, "Nobody"), undefined);
});
