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
  '{"type": "attack", "attacker": "<exact token name>", "target": "<exact token name>"}',
  '{"type": "apply_damage", "target": "<exact token name>", "amount": <integer>}',
  '{"type": "apply_healing", "target": "<exact token name>", "amount": <integer>}',
  `{"type": "toggle_condition", "target": "<exact token name>", "condition": "${CONDITION_LIST.join("|")}"}`,
  "",
  "Only reference token names that appear in the provided state. If the command is pure narration",
  "with no mechanical effect (e.g. flavor text, a question, an out-of-combat description), return",
  'an empty "actions" array. Never invent a monster type outside the listed set -- narrate it instead.',
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
      return typeof action.attacker === "string" && typeof action.target === "string";
    case "apply_damage":
    case "apply_healing":
      return typeof action.target === "string" && Number.isFinite(action.amount);
    case "toggle_condition":
      return typeof action.target === "string" && CONDITION_LIST.includes(action.condition);
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

  lines.push(
    `Current map: ${state.mapName || "(none)"}`,
    "Tokens on the map:"
  );
  if (tokens.length === 0) {
    lines.push("(none)");
  } else {
    tokens.forEach((t) => {
      const conditions = Array.isArray(t.conditions) && t.conditions.length
        ? `, conditions: ${t.conditions.join(", ")}`
        : "";
      lines.push(`- ${t.name} (${t.type}): ${t.hp}/${t.maxHp} HP, AC ${t.ac}${conditions}`);
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

console.log(`[dm-bridge] watching ${requestPath}`);
console.log(`[dm-bridge] model: ${process.env.DM_BRIDGE_MODEL || "haiku"} (override with DM_BRIDGE_MODEL env var)`);
poll();
