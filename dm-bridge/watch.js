#!/usr/bin/env node
// Campaign OS "Claude DM" bridge.
//
// The app (ui/app.js) can't call the Anthropic API directly from the browser --
// api.anthropic.com's CORS policy rejects arbitrary origins (confirmed against the
// live API, not assumed). Instead, the browser writes a request file here via the
// File System Access API, this script picks it up and asks the local `claude` CLI
// (already authenticated on this machine) what should happen, and writes the answer
// back as a response file the browser polls for.
//
// Run from the Campaign-OS project root: node dm-bridge/watch.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const bridgeDir = __dirname;
const requestPath = path.join(bridgeDir, "request.json");
const responsePath = path.join(bridgeDir, "response.json");
const endSessionRequestPath = path.join(bridgeDir, "end-session-request.json");
const endSessionResponsePath = path.join(bridgeDir, "end-session-response.json");

// The system prompt is written to the OS temp dir (not this project folder) because
// the project path contains a space ("Campaign OS"), and on Windows the `claude` CLI
// is a .cmd shim that can only be launched via a shell -- child_process's shell mode
// concatenates array args with a plain space rather than shell-quoting them, so any
// argv value containing a space (or worse, untrusted user text) would either break or
// be a command-injection risk. Keeping every argv value space-free sidesteps that
// entirely; the one piece of untrusted, variable-length content (the DM's command +
// state) goes over stdin instead, which never touches shell parsing at all.
const systemPromptPath = path.join(os.tmpdir(), "campaign-os-dm-bridge-system-prompt.txt");

const MONSTER_LIST = ["goblin", "orc", "troll", "bandit", "wolf", "hellhound"];
const CONDITION_LIST = [
  "Blinded", "Charmed", "Frightened", "Grappled", "Poisoned",
  "Prone", "Restrained", "Stunned", "Unconscious"
];

const SYSTEM_PROMPT = [
  "You are the DM assistant for a D&D 5e virtual tabletop called Campaign OS.",
  "You receive the current encounter state and a line of DM narration or a command,",
  "and decide what mechanical actions (if any) should happen, plus a short narrative line.",
  "",
  "Respond with ONLY a single JSON object -- no markdown code fences, no commentary before or after --",
  "matching exactly this shape:",
  '{"message": "<one or two sentences of narration>", "actions": [ <zero or more actions> ]}',
  "",
  "Each action is one of:",
  '{"type": "spawn_monster", "monster": "goblin|orc|troll|bandit|wolf|hellhound", "count": <integer>}',
  '{"type": "attack", "attacker": "<exact token name>", "target": "<exact token name>", "advantage": <optional true>, "disadvantage": <optional true>}',
  '{"type": "apply_damage", "target": "<exact token name>", "amount": <integer>}',
  '{"type": "apply_healing", "target": "<exact token name>", "amount": <integer>}',
  `{"type": "toggle_condition", "target": "<exact token name>", "condition": "${CONDITION_LIST.join("|")}"}`,
  '{"type": "move_token", "target": "<exact token name>", "x": <integer>, "y": <integer>}',
  '{"type": "next_turn"}',
  '{"type": "switch_map", "map": "<exact name from \'Maps available to switch to\' below>"}',
  '{"type": "saving_throw", "target": "<exact token name>", "ability": "STR|DEX|CON|INT|WIS|CHA", "dc": <integer>}',
  '{"type": "cast_spell", "caster": "<exact token name>", "spell": "<spell name>", "level": <0 for a cantrip, else 1-9>, "target": "<optional exact token name>", "damageDice": "<optional dice like 4d6>", "concentration": <optional true, only for a spell that requires concentration>, "advantage": <optional true>, "disadvantage": <optional true>}',
  '{"type": "use_resource", "target": "<exact token name>", "resource": "<exact resource name from that token\'s list below>", "amount": <optional integer, default 1>}',
  '{"type": "drop_concentration", "target": "<exact token name>"}',
  '{"type": "roll_death_save", "target": "<exact token name>"}',
  '{"type": "long_rest", "target": "<exact token name>"}',
  '{"type": "short_rest", "target": "<exact token name>"}',
  '{"type": "add_exhaustion", "target": "<exact token name>", "amount": <optional integer, default 1; negative to remove levels>}',
  '{"type": "use_legendary_action", "target": "<exact token name>", "cost": <optional integer, default 1>}',
  '{"type": "trigger_lair_action", "description": "<what the lair does this round>"}',
  "",
  "Only reference token names that appear in the provided state. If the command is pure narration",
  "with no mechanical effect (e.g. flavor text, a question, an out-of-combat description), return",
  'an empty "actions" array. Never invent a monster type outside the listed set -- narrate it instead.',
  "",
  "Use move_token when narration implies a token repositions on the grid -- closing to melee range,",
  "retreating, circling around -- using the grid size and each token's current (x, y) given below to",
  "pick a destination that's actually plausible, and stay within the grid bounds.",
  "",
  "Set advantage/disadvantage on an attack when 5e rules-as-written call for it -- Reckless Attack,",
  "Pack Tactics with an ally adjacent to the target, attacking a prone/blinded/restrained target in",
  "melee, the attacker being blinded or the target hidden, etc. Don't set both; RAW they cancel out,",
  "so just omit both flags instead. A single attack action already resolves a monster's full",
  "Multiattack (e.g. a troll's Bite + two Claws) automatically -- issue one attack action per turn,",
  "not one per individual attack in its stat block.",
  "",
  "Call next_turn whenever narration signals moving on to the next creature's turn or a new round",
  "in formal combat (the DM says \"next turn\"/\"moving on\", or you've fully resolved one token's",
  "actions for its turn). move_token only enforces a token's speed once turn order is running AND",
  "it's that specific token's active turn -- before turn order starts, or for any other token,",
  "movement is unrestricted, so don't worry about distance for narration outside formal combat.",
  "Each token's line below shows its speed and how much movement it has left this turn.",
  "",
  "Use switch_map when narration moves the scene to a different prepared map -- e.g. \"the party",
  "leaves the cellar and heads outside.\" The map name must exactly match one of the names listed",
  "in \"Maps available to switch to\" below. If the destination isn't listed, it hasn't been",
  "prepared yet -- narrate the transition in prose instead and let the DM load that map first,",
  "rather than inventing a switch_map action for a map that doesn't exist.",
  "",
  "Use saving_throw when narration calls for a save -- a trap, a spell effect, a fear aura, a",
  "poison. You only decide the ability and DC; the engine rolls the die and adds the target's",
  "real ability modifier (or a stated save bonus from their sheet, which can include feats/",
  "multiclass bumps a flat formula wouldn't capture) automatically -- each token's line below",
  "shows its ability scores when known. Important: you do NOT see the die roll's outcome before",
  "deciding the rest of THIS response's actions -- saving_throw only resolves and logs pass/fail,",
  "it never applies a follow-up effect itself. For \"half damage on a success, full on a failure\"",
  "-style effects, issue the saving_throw action alone this turn and let the DM's next command",
  "(after seeing the logged result) tell you the actual damage/condition to apply.",
  "",
  "Use cast_spell whenever a token casts a spell. Set level to 0 for a cantrip -- it never",
  "consumes a slot; otherwise use the spell's real level, which consumes one of that caster's",
  "slots at that level automatically (each token's line below shows its slots when known). If",
  "it has none left at that level, the cast simply fails and nothing else happens -- check the",
  "slots shown before choosing a level higher than what's actually available. Only set",
  "target/damageDice for a spell that makes an attack roll (Fire Bolt, Guiding Bolt, etc.) --",
  "the engine rolls to hit using the caster's own stated spell attack bonus, shown below when",
  "known, same as saving_throw uses the target's own stated modifier. A spell that instead",
  "calls for a saving throw (Fireball, Hold Person) has no target/damageDice here -- issue",
  "cast_spell alone to spend the slot, then a separate saving_throw action per target this",
  "same response using the caster's stated spell save DC (also shown below). A spell with",
  "neither an attack roll nor a save (buffs, utility) just needs cast_spell by itself.",
  "",
  "Use use_resource whenever a token spends a limited class resource -- Rage, Wild Shape, Ki",
  "Points, Superiority Dice, Channel Divinity, Bardic Inspiration, etc. -- shown in that",
  "token's own \"resources\" list below; match the name exactly as listed there. It only spends",
  "the charge and logs how many are left, the same composable way cast_spell only spends a",
  "slot -- any actual effect (an attack, a saving throw, healing) still needs its own separate",
  "action in this same response. If a token has no resources listed at all, or doesn't list the",
  "one narration calls for, don't invent one -- narrate around it instead rather than guessing",
  "at a name or count that isn't actually shown.",
  "",
  "Set concentration: true on cast_spell only for a spell that actually requires concentration",
  "(you know which spells do from 5e rules -- most buffs/debuffs and many ongoing-damage spells",
  "do, most instant-effect spells don't). Casting another concentration spell automatically",
  "ends whatever that caster was already concentrating on -- the engine handles this, you don't",
  "need a separate drop_concentration for it. You also don't need to manage concentration",
  "checks yourself: any damage a concentrating token takes automatically rolls a CON save (or",
  "ends outright with no save if it drops to 0 HP) as part of apply_damage/attack/cast_spell's",
  "own resolution, and the result is logged for you to react to on a later command -- the same",
  "one-shot-batch reason saving_throw's outcome isn't visible to you yet either. Each token's",
  "line below shows \"concentrating on <spell>\" when applicable. Use drop_concentration only",
  "when a caster voluntarily stops on purpose (not as a reaction to a failed save -- the engine",
  "already handles that case).",
  "",
  "Death saves are also mostly automatic. A token dropping from above 0 to exactly 0 HP (from",
  "attack, apply_damage, or cast_spell) starts them on its own -- you don't set anything up.",
  "Further damage to a token already at 0 HP is an automatic failed death save (two if it was a",
  "critical hit), not a roll, and is also handled for you as part of whatever action dealt that",
  "damage. What you DO need to do: call roll_death_save for a token that is down (its line below",
  "says \"dying\") once its turn comes up, unless it's already \"stable\" -- that's the one place",
  "this needs an explicit action, since the engine has no way to know whose turn it is on its",
  "own. A natural 20 revives it at 1 HP, three successes stabilizes it (no more rolls needed",
  "until it takes damage again), three failures kills it -- react to whichever happened using",
  "the result logged, the same as any other roll you don't see the outcome of in advance.",
  "",
  "Use long_rest/short_rest when narration says a token (or the whole party -- issue one",
  "action per token) rests. long_rest fully heals HP and restores every spell slot and every",
  "resource to max, but skips the HP/revival part for a token already flagged \"dead\" (that",
  "needs an actual revival, not a rest). short_rest restores only resources tagged as",
  "short-rest recovery (shown per-resource below, e.g. \"Second Wind 0/1 (short)\") -- it never",
  "touches HP or spell slots (Hit Dice spending isn't modeled, and almost nothing but Warlock",
  "Pact Magic recovers slots on a short rest, which isn't specially handled either). Don't",
  "invent a rest for a token that isn't part of the current scene. long_rest also removes one",
  "level of exhaustion automatically -- you don't need a separate add_exhaustion for that.",
  "",
  "Use add_exhaustion when narration causes a token to gain exhaustion (a forced march, extreme",
  "cold/heat without protection, certain spells/effects) or lose it (Greater Restoration) --",
  "amount defaults to 1, use a negative number to remove levels. Each token's line below shows",
  "its exhaustion level when above 0. The engine automatically applies disadvantage on attack",
  "rolls and saving throws at level 3+, and halves (level 2+) or zeroes (level 5+) movement",
  "speed -- you don't need to set advantage/disadvantage yourself for that, it happens as part",
  "of attack/saving_throw/move_token's own resolution. Level 6 kills the token outright, no",
  "save. Disadvantage on ability checks (level 1) and a halved HP maximum (level 4) are NOT",
  "modeled -- this engine has no ability-check mechanic at all, and halving/restoring maxHp",
  "isn't automated; call those out narratively or handle them as a DM ruling instead of",
  "expecting an action for either.",
  "",
  "Use use_legendary_action for a legendary monster (its line below shows \"legendary actions",
  "N/M\" when it has any) spending one at the end of another creature's turn -- cost defaults",
  "to 1, set it higher only for an action that RAW costs more (e.g. 2 or 3). Like",
  "use_resource, you don't need a target to have any listed at all if it doesn't -- don't",
  "invent legendary actions for a token that has none. Legendary actions regain to full",
  "automatically at the start of that token's own turn (via next_turn), so you never need to",
  "restore them yourself. This engine has no notion of whose turn just ended beyond next_turn's",
  "own result, so the timing judgment (\"is this actually the end of someone else's turn?\") is",
  "yours to make from the narration/next_turn sequence, the same as roll_death_save's timing.",
  "",
  "Use trigger_lair_action when the scene is in a legendary creature's lair and narration",
  "reaches initiative count 20 for the round (typically right after the highest-initiative",
  "creature's turn, before anyone else acts) -- describe what the lair does this round in",
  "`description`. It only fires once per round; a second call the same round is refused, so",
  "don't retry it if that happens -- wait for next_turn to actually advance the round. Any real",
  "effect the lair action causes (damage, a saving throw, a condition) still needs its own",
  "separate action in the same response, same compose-only pattern as cast_spell/use_resource.",
  "",
  "You may also receive campaign context (a prior session's recap, an NPC's notes) before the",
  "current state. Use it to keep names, places, and plot details consistent with the real campaign --",
  "but it never overrides the actual token state above, which is always the current truth."
].join("\n");

fs.writeFileSync(systemPromptPath, SYSTEM_PROMPT, "utf8");

// A request file left over from a previous run of the watcher (the app crashed, the DM
// closed the terminal mid-command, a stray click before DND_REPO_PATH was set) would
// otherwise get reprocessed on every restart, since lastProcessedId resets to null and
// the file's `id` looks "new" to a fresh process. That's surprising at best (an old combat
// command replaying against however the encounter looks now) and wasteful at worst (a real
// Claude Code call for End Session/Create Character, potentially writing to the campaign
// repo, firing again with stale/insufficient data). Reading whatever's already on disk at
// startup and treating its id as already-handled closes that gap -- only a genuinely new
// write (a fresh id) after the watcher is up will ever be processed.
function primeLastProcessedId(filePath) {
  try {
    const request = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return request.id || null;
  } catch {
    return null;
  }
}

let lastProcessedId = primeLastProcessedId(requestPath);

function isValidAction(action) {
  if (!action || typeof action !== "object") return false;
  switch (action.type) {
    case "spawn_monster":
      return MONSTER_LIST.includes(String(action.monster || "").toLowerCase())
        && Number.isFinite(action.count) && action.count > 0;
    case "attack":
      return typeof action.attacker === "string" && typeof action.target === "string"
        && (action.advantage === undefined || typeof action.advantage === "boolean")
        && (action.disadvantage === undefined || typeof action.disadvantage === "boolean");
    case "apply_damage":
    case "apply_healing":
      return typeof action.target === "string" && Number.isFinite(action.amount);
    case "toggle_condition":
      return typeof action.target === "string" && CONDITION_LIST.includes(action.condition);
    case "move_token":
      return typeof action.target === "string" && Number.isFinite(action.x) && Number.isFinite(action.y);
    case "next_turn":
      return true;
    case "switch_map":
      return typeof action.map === "string" && action.map.trim().length > 0;
    case "saving_throw":
      return typeof action.target === "string" && typeof action.ability === "string" && Number.isFinite(action.dc);
    case "cast_spell":
      return typeof action.caster === "string" && typeof action.spell === "string"
        && Number.isFinite(action.level) && action.level >= 0 && action.level <= 9
        && (action.target === undefined || typeof action.target === "string")
        && (action.damageDice === undefined || typeof action.damageDice === "string")
        && (action.concentration === undefined || typeof action.concentration === "boolean")
        && (action.advantage === undefined || typeof action.advantage === "boolean")
        && (action.disadvantage === undefined || typeof action.disadvantage === "boolean");
    case "use_resource":
      return typeof action.target === "string" && typeof action.resource === "string"
        && (action.amount === undefined || (Number.isFinite(action.amount) && action.amount > 0));
    case "drop_concentration":
    case "roll_death_save":
    case "long_rest":
    case "short_rest":
      return typeof action.target === "string";
    case "add_exhaustion":
      return typeof action.target === "string" && (action.amount === undefined || Number.isFinite(action.amount));
    case "use_legendary_action":
      return typeof action.target === "string" && (action.cost === undefined || (Number.isFinite(action.cost) && action.cost > 0));
    case "trigger_lair_action":
      return typeof action.description === "string" && action.description.trim().length > 0;
    default:
      return false;
  }
}

function extractJson(text) {
  if (typeof text !== "string") return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return null;
  }
}

function buildPrompt(request) {
  const state = request.state || {};
  const tokens = Array.isArray(state.tokens) ? state.tokens : [];
  const lines = [];

  if (request.context && request.context.text) {
    lines.push(
      `Relevant campaign context ("${request.context.title}"):`,
      request.context.text,
      ""
    );
  }

  const grid = state.grid || {};
  const availableMaps = Array.isArray(state.availableMaps) ? state.availableMaps : [];
  lines.push(
    `Current map: ${state.mapName || "(none)"}`,
    `Grid size: ${grid.columns || 12} columns x ${grid.rows || 8} rows (1-based, top-left is 1,1).`,
    state.activeToken
      ? `Turn order: running -- round ${state.round || 1}, ${state.activeToken}'s turn.`
      : "Turn order: not running -- use next_turn to start it once formal combat begins.",
    state.lairActionUsedThisRound
      ? "This round's lair action has already triggered -- wait for next_turn to advance the round before another."
      : "This round's lair action has not triggered yet.",
    availableMaps.length
      ? `Maps available to switch to: ${availableMaps.join(", ")}.`
      : "No other prepared maps to switch to right now.",
    "Tokens on the map:"
  );
  if (tokens.length === 0) {
    lines.push("(none)");
  } else {
    tokens.forEach((t) => {
      const conditions = Array.isArray(t.conditions) && t.conditions.length
        ? `, conditions: ${t.conditions.join(", ")}`
        : "";
      const speed = Number.isFinite(t.speed) ? t.speed : 30;
      const movementLeft = Number.isFinite(t.movementLeft) ? t.movementLeft : speed;
      const scores = t.abilityScores || {};
      const knownAbilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"].filter((key) => Number.isFinite(scores[key]));
      const abilities = knownAbilities.length
        ? `, abilities ${knownAbilities.map((key) => `${key} ${scores[key]}`).join(" ")}`
        : "";
      const spellcasting = t.spellcasting || {};
      const spellcastingParts = [];
      if (Number.isFinite(spellcasting.saveDC)) spellcastingParts.push(`DC ${spellcasting.saveDC}`);
      if (Number.isFinite(spellcasting.attackBonus)) spellcastingParts.push(`atk +${spellcasting.attackBonus}`);
      const spellcastingText = spellcastingParts.length ? `, spellcasting ${spellcastingParts.join(" ")}` : "";
      const slots = t.spellSlots || {};
      const slotLevels = Object.keys(slots)
        .map(Number)
        .filter((level) => slots[level] && Number.isFinite(slots[level].current) && Number.isFinite(slots[level].max))
        .sort((a, b) => a - b);
      const slotsText = slotLevels.length
        ? `, slots ${slotLevels.map((level) => `${slots[level].current}/${slots[level].max} L${level}`).join(" ")}`
        : "";
      const resources = t.resources || {};
      const resourceNames = Object.keys(resources)
        .filter((name) => resources[name] && Number.isFinite(resources[name].current) && Number.isFinite(resources[name].max));
      const resourcesText = resourceNames.length
        ? `, resources ${resourceNames.map((name) => `${name} ${resources[name].current}/${resources[name].max} (${resources[name].recovery === "short" ? "short" : "long"})`).join(", ")}`
        : "";
      const concentrationText = t.concentratingOn?.spell ? `, concentrating on ${t.concentratingOn.spell}` : "";
      const exhaustionText = Number.isFinite(t.exhaustion) && t.exhaustion > 0 ? `, exhaustion ${t.exhaustion}` : "";
      let deathStatusText = "";
      if (t.dead) deathStatusText = ", dead";
      else if (t.dying?.stable) deathStatusText = ", stable at 0 HP";
      else if (t.dying) deathStatusText = `, dying (${t.dying.successes} successes, ${t.dying.failures} failures)`;
      const legendaryActionsText = t.legendaryActions && Number.isFinite(t.legendaryActions.current) && Number.isFinite(t.legendaryActions.max)
        ? `, legendary actions ${t.legendaryActions.current}/${t.legendaryActions.max}`
        : "";
      lines.push(`- ${t.name} (${t.type}) at (${t.x}, ${t.y}): ${t.hp}/${t.maxHp} HP, AC ${t.ac}, speed ${speed} ft (${movementLeft} ft left this turn)${conditions}${abilities}${spellcastingText}${slotsText}${resourcesText}${concentrationText}${deathStatusText}${exhaustionText}${legendaryActionsText}`);
    });
  }
  lines.push("", `DM narration/command: "${request.command}"`);
  return lines.join("\n");
}

function writeResponse(id, payload) {
  const response = { id, respondedAt: new Date().toISOString(), ...payload };
  fs.writeFile(responsePath, JSON.stringify(response, null, 2), (err) => {
    if (err) console.error("[dm-bridge] failed to write response.json:", err.message);
    else console.log(`[dm-bridge] responded to ${id}: ${payload.message}`);
  });
}

// Every argv element here is fixed and space-free (flag names, "json", "haiku", a
// comma-joined tool list, and the temp-dir system-prompt path) -- required because
// child_process's Windows shell mode does not escape array args, only concatenates
// them (see the comment on systemPromptPath above). The one piece of untrusted,
// variable-length input -- the DM's command and current encounter state -- is written
// to the child's stdin instead, never appearing on the command line at all.
function runClaude(prompt, onDone) {
  const model = process.env.DM_BRIDGE_MODEL || "haiku";
  const args = [
    "-p",
    "--output-format", "json",
    "--system-prompt-file", systemPromptPath,
    "--model", model,
    "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebSearch,WebFetch,NotebookEdit,Agent,Task",
    "--max-budget-usd", "0.50"
  ];

  const child = spawn("claude", args, {
    shell: process.platform === "win32",
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (err) => onDone(err, "", ""));
  child.on("close", () => onDone(null, stdout, stderr));

  child.stdin.write(prompt);
  child.stdin.end();
}

function handleRequest(request) {
  console.log(`[dm-bridge] processing ${request.id}: "${request.command}"`);
  const prompt = buildPrompt(request);

  runClaude(prompt, (err, stdout, stderr) => {
    if (err) {
      console.error("[dm-bridge] claude invocation failed:", stderr || err.message);
      writeResponse(request.id, { message: "The DM assistant hit an error and couldn't respond.", actions: [] });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      console.error("[dm-bridge] could not parse claude CLI output as JSON:", stdout.slice(0, 300));
      writeResponse(request.id, { message: "The DM assistant's response wasn't valid JSON.", actions: [] });
      return;
    }

    if (parsed.is_error) {
      writeResponse(request.id, { message: `The DM assistant reported an error: ${parsed.result}`, actions: [] });
      return;
    }

    const inner = extractJson(parsed.result);
    if (!inner) {
      writeResponse(request.id, { message: String(parsed.result || "").slice(0, 500) || "No response.", actions: [] });
      return;
    }

    writeResponse(request.id, {
      message: typeof inner.message === "string" ? inner.message : "",
      actions: Array.isArray(inner.actions) ? inner.actions.filter(isValidAction) : []
    });
  });
}

function poll() {
  fs.readFile(requestPath, "utf8", (err, data) => {
    if (!err) {
      try {
        const request = JSON.parse(data);
        if (request.id && request.id !== lastProcessedId) {
          lastProcessedId = request.id;
          handleRequest(request);
        }
      } catch {
        // partial write mid-poll -- try again next tick
      }
    }
    setTimeout(poll, 1500);
  });
}

// --- End Session write-back -------------------------------------------------------
//
// Unlike the combat-narration flow above (which deliberately disallows every tool and
// demands a single strict JSON reply), this is a real, multi-step Claude Code call
// with actual Read/Write/Edit access to the DnD campaign repo -- it reads the current
// session-log.md and world-state.md, drafts an update in the campaign's existing
// narrative style, and writes it directly. It never runs Bash and is never given a
// reason to touch git: nothing is committed or pushed here, on purpose. The DM
// reviews the resulting diff in the campaign repo and commits it themselves, same as
// any other edit to that repo.

const END_SESSION_SYSTEM_PROMPT = [
  "You are helping a Dungeon Master fold the results of a combat/roleplay session run in a",
  "virtual tabletop app (Campaign OS) back into their campaign's markdown records.",
  "",
  "Your working directory is the root of the campaign repository. Steps:",
  "1. Read active.md to find the active campaign's slug and folder (campaigns/<slug>/).",
  "2. Read that campaign's session-log.md. Find the highest existing \"## Session N\" heading",
  "   and determine the next session number.",
  "3. Using the provided transcript and final token states, write a new \"## Session N -- <date>\"",
  "   section at the END of session-log.md, in the SAME narrative prose style as the existing",
  "   entries -- named beats, character voice, thematic callbacks, not a mechanical log dump.",
  "   Use today's date if no better date is implied by the transcript.",
  "4. Read that campaign's world-state.md. Update only what actually changed: party",
  "   location/HP/conditions, the quest log, NPC statuses, location statuses. Leave unrelated",
  "   sections untouched. world-state.md is a living tracker of ACTIVE threads only --",
  "   full blow-by-blow history belongs in session-log.md, not here.",
  "5. Do not modify character sheet files unless the transcript clearly implies a permanent",
  "   change (e.g. a level-up, a name/identity reveal) -- ordinary HP loss during the session",
  "   is not permanent once the party rests, so do not update character HP fields for that alone.",
  "6. Do not run git commands and do not attempt to commit or push anything -- file edits only.",
  "",
  "When finished, reply with a short plain-text summary (2-4 sentences) of exactly which files",
  "you changed and what you added -- this is shown directly to the DM, not parsed as JSON."
].join("\n");

const endSessionSystemPromptPath = path.join(os.tmpdir(), "campaign-os-dm-bridge-end-session-system-prompt.txt");
fs.writeFileSync(endSessionSystemPromptPath, END_SESSION_SYSTEM_PROMPT, "utf8");

let lastProcessedEndSessionId = primeLastProcessedId(endSessionRequestPath);

function buildEndSessionPrompt(request) {
  const state = request.finalState || {};
  const tokens = Array.isArray(state.tokens) ? state.tokens : [];
  const lines = [
    "Session transcript (chronological):",
    ...((request.transcript || []).map((line) => `- ${line}`)),
    "",
    `Final map: ${state.mapName || "(none)"}`,
    "Final token states:"
  ];
  if (tokens.length === 0) {
    lines.push("(none)");
  } else {
    tokens.forEach((t) => {
      const conditions = Array.isArray(t.conditions) && t.conditions.length ? `, conditions: ${t.conditions.join(", ")}` : "";
      lines.push(`- ${t.name} (${t.type}, on ${t.mapName || "unknown map"}): ${t.hp}/${t.maxHp} HP, AC ${t.ac}${conditions}`);
    });
  }
  if (request.contextTitle) {
    lines.push("", `DM had "${request.contextTitle}" attached as context during this session.`);
  }
  return lines.join("\n");
}

function writeEndSessionResponse(id, ok, message) {
  const response = { id, ok, message, respondedAt: new Date().toISOString() };
  fs.writeFile(endSessionResponsePath, JSON.stringify(response, null, 2), (err) => {
    if (err) console.error("[dm-bridge] failed to write end-session-response.json:", err.message);
    else console.log(`[dm-bridge] end-session ${id} ${ok ? "succeeded" : "failed"}: ${message}`);
  });
}

function handleEndSessionRequest(request) {
  console.log(`[dm-bridge] processing end-session ${request.id}`);
  const dndRepoPath = process.env.DND_REPO_PATH;
  if (!dndRepoPath) {
    writeEndSessionResponse(request.id, false,
      "DND_REPO_PATH isn't set. Stop the watcher, set it to your campaign repo's path (e.g. " +
      "DND_REPO_PATH=/path/to/DND/Campaign node dm-bridge/watch.js), and try again.");
    return;
  }
  if (!fs.existsSync(dndRepoPath)) {
    writeEndSessionResponse(request.id, false, `DND_REPO_PATH is set to "${dndRepoPath}", but that path doesn't exist.`);
    return;
  }

  const prompt = buildEndSessionPrompt(request);
  const model = process.env.DM_BRIDGE_MODEL || "haiku";
  const args = [
    "-p",
    "--output-format", "json",
    "--system-prompt-file", endSessionSystemPromptPath,
    "--model", model,
    "--allowedTools", "Read,Write,Edit",
    "--permission-mode", "acceptEdits",
    "--max-budget-usd", "2.00"
  ];

  const child = spawn("claude", args, {
    cwd: dndRepoPath,
    shell: process.platform === "win32",
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (err) => {
    writeEndSessionResponse(request.id, false, `Couldn't start claude: ${err.message}`);
  });
  child.on("close", () => {
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      console.error("[dm-bridge] could not parse end-session claude output as JSON:", stdout.slice(0, 300));
      writeEndSessionResponse(request.id, false, "Claude's response wasn't valid JSON -- check the watcher's console output.");
      return;
    }
    if (parsed.is_error) {
      writeEndSessionResponse(request.id, false, `Claude reported an error: ${parsed.result}`);
      return;
    }
    writeEndSessionResponse(request.id, true, String(parsed.result || "Done, but Claude didn't summarize what changed."));
  });

  child.stdin.write(prompt);
  child.stdin.end();
}

function pollEndSession() {
  fs.readFile(endSessionRequestPath, "utf8", (err, data) => {
    if (!err) {
      try {
        const request = JSON.parse(data);
        if (request.id && request.id !== lastProcessedEndSessionId) {
          lastProcessedEndSessionId = request.id;
          handleEndSessionRequest(request);
        }
      } catch {
        // partial write mid-poll -- try again next tick
      }
    }
    setTimeout(pollEndSession, 1500);
  });
}

// --- Create Character write-back ----------------------------------------------------
//
// Deterministic, not an LLM call: the browser (ui/app.js, via engine/characterCreator.js)
// already computed the full sheet markdown and just needs it written into the campaign
// repo's characters/ folder. No Claude subprocess, no cost, near-instant. Still gated by
// DND_REPO_PATH like End Session, and never overwrites an existing file -- if the name
// collides, the DM picks a different one rather than silently clobbering a real sheet.
// The requested file name is run through path.basename() before use so a malformed or
// malicious fileName value can't escape the characters/ directory.

const createCharacterRequestPath = path.join(bridgeDir, "create-character-request.json");
const createCharacterResponsePath = path.join(bridgeDir, "create-character-response.json");
let lastProcessedCreateCharacterId = primeLastProcessedId(createCharacterRequestPath);

function writeCreateCharacterResponse(id, ok, message) {
  const response = { id, ok, message, respondedAt: new Date().toISOString() };
  fs.writeFile(createCharacterResponsePath, JSON.stringify(response, null, 2), (err) => {
    if (err) console.error("[dm-bridge] failed to write create-character-response.json:", err.message);
    else console.log(`[dm-bridge] create-character ${id} ${ok ? "succeeded" : "failed"}: ${message}`);
  });
}

function handleCreateCharacterRequest(request) {
  console.log(`[dm-bridge] processing create-character ${request.id}`);
  const dndRepoPath = process.env.DND_REPO_PATH;
  if (!dndRepoPath) {
    writeCreateCharacterResponse(request.id, false,
      "DND_REPO_PATH isn't set. Stop the watcher, set it to your campaign repo's path (e.g. " +
      "DND_REPO_PATH=/path/to/DND/Campaign node dm-bridge/watch.js), and try again.");
    return;
  }
  if (!fs.existsSync(dndRepoPath)) {
    writeCreateCharacterResponse(request.id, false, `DND_REPO_PATH is set to "${dndRepoPath}", but that path doesn't exist.`);
    return;
  }

  const fileName = path.basename(String(request.fileName || "").trim()) || "Character.md";
  if (!fileName.toLowerCase().endsWith(".md")) {
    writeCreateCharacterResponse(request.id, false, "Character file name must end in .md.");
    return;
  }

  const charactersDir = path.join(dndRepoPath, "characters");
  fs.mkdirSync(charactersDir, { recursive: true });
  const targetPath = path.join(charactersDir, fileName);

  if (fs.existsSync(targetPath)) {
    writeCreateCharacterResponse(request.id, false,
      `A character file named "${fileName}" already exists -- pick a different name.`);
    return;
  }

  try {
    fs.writeFileSync(targetPath, String(request.markdown || ""), "utf8");
  } catch (err) {
    writeCreateCharacterResponse(request.id, false, `Couldn't write the character file: ${err.message}`);
    return;
  }

  writeCreateCharacterResponse(request.id, true, `Created characters/${fileName} in the campaign repo.`);
}

function pollCreateCharacter() {
  fs.readFile(createCharacterRequestPath, "utf8", (err, data) => {
    if (!err) {
      try {
        const request = JSON.parse(data);
        if (request.id && request.id !== lastProcessedCreateCharacterId) {
          lastProcessedCreateCharacterId = request.id;
          handleCreateCharacterRequest(request);
        }
      } catch {
        // partial write mid-poll -- try again next tick
      }
    }
    setTimeout(pollCreateCharacter, 1500);
  });
}

console.log(`[dm-bridge] watching ${requestPath}`);
console.log(`[dm-bridge] model: ${process.env.DM_BRIDGE_MODEL || "haiku"} (override with DM_BRIDGE_MODEL env var)`);
console.log(`[dm-bridge] watching ${endSessionRequestPath}`);
console.log(`[dm-bridge] watching ${createCharacterRequestPath}`);
console.log(`[dm-bridge] DND_REPO_PATH: ${process.env.DND_REPO_PATH || "(not set -- End Session and Create Character will fail until this is set)"}`);
poll();
pollEndSession();
pollCreateCharacter();
