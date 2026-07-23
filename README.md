# Campaign OS

Campaign OS is an AI-native tabletop campaign workspace. The current goal is simple:

> If it makes the game more fun, it is the right feature.

This repository is the software layer. Campaign notes, lore, session logs, and adventure Markdown should stay in the campaign repository and be imported later.

## Getting Started

Open `index.html` directly in a browser (Chrome or Edge recommended -- some features use the
File System Access API, which Firefox and Safari don't support yet). No build step, no
dependencies to install for the app itself. See Tests, below, for running the test suite.

## Current Features

- Live encounter board
- Draggable tokens
- Initiative tracker
- Editable token sheet
- Flexible damage and healing
- Expanded condition tracking
- Remove defeated or accidental tokens
- Dice-backed attacks
- Combat log
- Campaign Markdown import
- Campaign browser for characters, locations, sessions, and notes
- Campaign search and category filtering
- Template files hidden by default
- Selected campaign item detail panel
- Add imported characters to the encounter board
- Open imported character sheets in a separate page
- Open imported locations as the active map context
- Named locations are parsed individually out of `world-state.md`'s table, and each
  session is parsed individually out of `session-log.md`'s `## Session N` headings --
  both browsable and searchable on their own, not just as one giant source file
- Use sessions and notes as quick DM context
- Add persistent image portraits to tokens
- Import persistent map images behind the encounter grid
- Tune map grids per imported map with draggable handles
- Calibrate each map with grid visibility, grid opacity, image fit, and token size
- Keep token placement scoped to the active map
- Automatic encounter persistence across reloads
- Remembered campaign search, filters, and selection
- Fog tiles
- Save and load encounter state in the browser
- Simple command input, including `spawn three goblins`
- Optional Claude DM bridge for real narration and tool-calling (see below)
- Token library: save art by name once, and it's attached automatically to any
  matching token from then on -- manual spawns, imported characters, and Claude DM
  bridge actions alike

Local command examples (works with or without the Claude DM bridge connected):

```text
Three goblins emerge from the trees.
Goblin 1 attacks Darkhawk.
```

## Claude DM bridge

The "Claude DM" panel works two ways:

- **Not connected (default):** a small local regex parser handles `spawn N <monster>` and
  `X attacks Y` phrasing. No network calls, no setup.
- **Connected:** commands are handled by a real Claude Code call, which can narrate freely
  and decide on structured actions (spawn, attack, damage, heal, toggle a condition, move a
  token on the grid), referencing tokens by name and reasoning about the current encounter
  state -- including where everything currently stands on the grid.

There's no built-in way to call the Anthropic API directly from a browser -- `api.anthropic.com`'s
CORS policy rejects requests from arbitrary origins, confirmed against the live API rather than
assumed. Instead, the connected mode uses a local file-based bridge to the `claude` CLI you
already have installed and authenticated on this machine:

1. In a terminal, from the project root, run:
   ```text
   node dm-bridge/watch.js
   ```
   Leave it running. It watches `dm-bridge/request.json` and calls `claude -p` (defaulting to
   Haiku; override with `DM_BRIDGE_MODEL=sonnet` etc.) whenever a new command comes in.
2. In the app, click **Connect to Claude Code** in the Claude DM panel and pick the project's
   `dm-bridge/` folder. This uses the browser's File System Access API (Chrome or Edge only --
   there's no Firefox/Safari support for it yet), so the browser can write/read files directly
   with no server of its own.
3. Type a command and hit Run as usual. The app writes `dm-bridge/request.json`; the watcher
   script asks Claude what should happen and writes `dm-bridge/response.json`; the app polls for
   it and applies the result.

Costs are billed to whatever the `claude` CLI on your machine is authenticated with (API key or
subscription) -- there's no separate key stored in the browser. The first call in a while is the
most expensive (Claude Code's own tool/system scaffolding has to populate the prompt cache);
repeated calls within the cache window are much cheaper.

### Attaching campaign context

By default, Claude only sees the live encounter state (map name, tokens, HP/AC/conditions) --
it has no idea about the Warden's bargain or who Sael is unless you attach something. Select a
session or note in the campaign browser and click **Use Context**; it stays attached (shown in a
row above the command box, with a **Clear** button) across as many commands as you like, so
narration stays grounded in the real story rather than just token stats. Cheaper models (Haiku,
the default) occasionally under-use attached context on oddly-phrased or self-referential
commands -- if narration seems to ignore it, try rephrasing, or set `DM_BRIDGE_MODEL=sonnet` for
more consistent context use.

### Writing session results back to the campaign repo

Campaign-OS only *imports* from your DnD campaign repo -- combat and narration run here don't
change anything in that repo on their own, so without a way to feed results back, the repo's
`world-state.md` and `session-log.md` would silently drift out of sync with what actually
happened. The **End Session** button (below the command box) closes that loop:

1. Set `DND_REPO_PATH` to your local checkout of the campaign repo before starting the watcher:
   ```text
   DND_REPO_PATH=/path/to/DND/Campaign node dm-bridge/watch.js
   ```
2. Play the session as normal (local commands or the Claude DM bridge, either records to the
   session transcript). When you're done, click **End Session**.
3. The watcher hands the *entire* session's transcript and final token states to a real Claude
   Code call with actual Read/Write/Edit access scoped to `DND_REPO_PATH` -- not the constrained,
   JSON-only call combat narration uses. It reads `active.md` to find the active campaign, reads
   the current `session-log.md` and `world-state.md`, and drafts an update in the campaign's
   existing narrative style (the same kind of prose you'd get writing it by hand with Claude Code)
   rather than dumping a raw combat log.

**This only ever edits files -- it never runs git, never commits, never pushes.** Review the
diff in the campaign repo afterward the same way you would any other edit, and commit it
yourself when you're happy with it. If `DND_REPO_PATH` isn't set (or doesn't exist), End Session
fails with a message telling you so rather than guessing at a path or writing anywhere unexpected.

The full session transcript persists across page reloads (separately from the 12-entry Combat Log
shown in the UI, which is just a rolling display) until a successful End Session clears it, so
losing your browser tab mid-session doesn't lose the record.

## Token library

The "Token Library" panel lets you save a portrait once and have it show up automatically from
then on, without re-uploading it per token:

- Add an entry with a name and an image. Matching is by name, case-insensitive, with a spawned
  monster's trailing instance number stripped -- an entry named `goblin` matches "Goblin 1",
  "Goblin 2", etc.; an entry named `Darkhawk` matches a token literally named "Darkhawk".
- Whenever a token is created without its own image -- a manual `spawn` command, adding an
  imported character, or a Claude DM bridge action -- the library is checked automatically and
  the art attaches if there's a match.
- Entries are stored in IndexedDB (not localStorage), since portrait images are exactly the kind
  of content that would otherwise blow past localStorage's origin quota.

## Project Structure

```text
Campaign OS
|-- index.html      Main app shell (battle map, campaign browser, token sheet, Claude DM)
|-- character.html  Standalone character sheet viewer, opened from an imported character
|-- engine/         Pure, unit-tested logic: encounter state, campaign import/parsing, the
|                   dm-bridge action dispatcher -- no DOM, runnable under Node
|-- ui/             Browser UI glue: rendering, event wiring, and the IndexedDB-backed token
|                   library / image store / dm-bridge folder-handle store
|-- dm-bridge/      watch.js -- the Node script that bridges the browser to the local
|                   `claude` CLI, both for live combat narration and for the End
|                   Session write-back into the DnD campaign repo (see above)
`-- tests/          node:test suite for engine/ and the IndexedDB name-matching logic in
                    ui/tokenLibrary.js
```

To import a campaign: open `index.html`, use the Campaign file picker to choose a campaign
folder (matching the structure documented in the DnD repo this app pairs with -- `active.md`,
`campaigns/<slug>/{overview,world-state,session-log}.md`, `characters/*.md`), and Campaign OS
parses it into a searchable local index. Click a location to make it the active map context.

## Possible Next Steps

Nothing here is committed to -- just the open threads worth knowing about:

- Character/token art currently gets copied into the shared image store per-token; several
  monsters spawned from the same library entry each get their own copy of the same bytes rather
  than sharing one. Fine at IndexedDB's storage scale, but worth revisiting if it matters.
- Fog-of-war tiles exist but haven't been exercised as heavily as the rest of the map tooling.

## Tests

```text
npm test
```

Zero dependencies -- Node's built-in `node:test` runner against `tests/*.test.js`, covering
`engine/encounter.js`, `engine/campaign.js`, `engine/dmBridge.js`, and the name-matching logic in
`ui/tokenLibrary.js`. Runs automatically on push/PR to `main` via
`.github/workflows/test.yml`.
