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

const MONSTER_LIST = ["goblin", "orc", "troll", "bandit", "wolf"];
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
  '{"type": "spawn_monster", "monster": "goblin|orc|troll|bandit|wolf", "count": <integer>}',
  '{"type": "attack", "attacker": "<exact token name>", "target": "<exact token name>", "advantage": <optional true>, "disadvantage": <optional true>}',
  '{"type": "apply_damage", "target": "<exact token name>", "amount": <integer>}',
  '{"type": "apply_healing", "target": "<exact token name>", "amount": <integer>}',
  `{"type": "toggle_condition", "target": "<exact token name>", "condition": "${CONDITION_LIST.join("|")}"}`,
  '{"type": "move_token", "target": "<exact token name>", "x": <integer>, "y": <integer>}',
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
  "You may also receive campaign context (a prior session's recap, an NPC's notes) before the",
  "current state. Use it to keep names, places, and plot details consistent with the real campaign --",
  "but it never overrides the actual token state above, which is always the current truth."
].join("\n");

fs.writeFileSync(systemPromptPath, SYSTEM_PROMPT, "utf8");

let lastProcessedId = null;

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
  lines.push(
    `Current map: ${state.mapName || "(none)"}`,
    `Grid size: ${grid.columns || 12} columns x ${grid.rows || 8} rows (1-based, top-left is 1,1).`,
    "Tokens on the map:"
  );
  if (tokens.length === 0) {
    lines.push("(none)");
  } else {
    tokens.forEach((t) => {
      const conditions = Array.isArray(t.conditions) && t.conditions.length
        ? `, conditions: ${t.conditions.join(", ")}`
        : "";
      lines.push(`- ${t.name} (${t.type}) at (${t.x}, ${t.y}): ${t.hp}/${t.maxHp} HP, AC ${t.ac}${conditions}`);
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

let lastProcessedEndSessionId = null;

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
let lastProcessedCreateCharacterId = null;

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
