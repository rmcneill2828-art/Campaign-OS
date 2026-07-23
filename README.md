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
- Dice-backed attacks, rules-as-written: SRD-accurate stat blocks for the five monsters
  `spawn` recognizes (goblin, orc, wolf, bandit, troll), a critical hit that doubles only
  the damage dice (not a flat modifier), advantage/disadvantage on any attack (manual
  attack-control dropdown, `attacks Y with advantage`/`at disadvantage` phrasing, or the
  Claude DM bridge's `advantage`/`disadvantage` action flags), and automatic Multiattack
  for monsters that have one (a troll's Bite + two Claws resolve as one attack action,
  each roll shown individually). Troll's Regeneration is a known, intentional gap -- there's
  no start-of-turn hook in the engine to key it off, so apply it by hand.
- Turn tracker: a "Next Turn" control in the Initiative panel steps through the current
  map's initiative order, shows the round number and whose turn it is, and resets that
  token's movement budget. Speed limits only apply to whichever token the tracker currently
  points at -- repositioning any other token (or moving at all before a turn order is
  running) stays free, matching how a real table only cares about your speed on your own
  turn. A token's Speed (ft) is editable on its sheet, defaults to 30 ft, and is read
  automatically from an imported character/NPC sheet's `**Speed:**` field or a spawned
  monster's real stat block. Movement cost uses the map's feet-per-square scale (Map
  Settings, defaults to 5 ft) and the RAW alternating diagonal rule (5/10/5/10 ft, not a
  flat cost per diagonal square), with the alternation carrying across separate moves within
  the same turn. Click-to-move, the Claude DM bridge's `move_token` action, and the manual
  grid all go through the same speed check.
- Combat log
- Campaign Markdown import
- Campaign browser for characters, locations, sessions, and notes
- Campaign search and category filtering
- Template files hidden by default
- Selected campaign item detail panel
- Add imported characters to the encounter board -- an `npcs/` sheet (as opposed to
  `characters/`) imports as a "monster"-styled token, and if its `### Attacks` table lists
  more than one attack row, every row folds into a real Multiattack the token fires as one
  action (e.g. a devil's two Claws + one Sting), the same way a built-in `spawn`ed troll
  does. `characters/` sheets keep the original "first row only" behavior, since PCs use
  that table shape to list weapon options, not a Multiattack.
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
- Map library: upload battle maps once (Setup tab), then click "Use" on a saved entry to
  load it as the active map -- creates a map with that name if it doesn't exist yet, or
  replaces an existing map's art. Unlike the token library, there's no automatic name
  matching (maps are explicitly picked, not auto-attached to something being spawned), and
  names aren't stripped of trailing numbers the way "Goblin 3" collapses to "goblin" --
  a map called "Level 2" stays "Level 2".
- Tokens Folder / Maps Folder (Setup tab): for a whole art pack -- hundreds or thousands
  of files -- connect the folder directly (File System Access API, same picker the Claude
  DM bridge uses) instead of uploading everything into the app. Nothing is bulk-copied:
  connecting only reads file *names* to build a searchable index; actual bytes are read
  one file at a time, only for something that's actually being used (a token about to
  spawn, a map you pick), and even then downscaled the same as any other upload before
  being cached. Subfolders are searched too, so an asset pack's own category folders
  (`Adventurers/`, `Creatures/`, etc.) don't need flattening first. This is what a large
  asset pack should use -- copying thousands of full-resolution images into IndexedDB via
  the libraries above is exactly what crashed the tab with "Aw, Snap" (Out of Memory)
  during development; see git history around the image-downscaling and library-render
  fixes if curious. Permission is per-browser-session (re-click Connect to re-grant after
  reopening the app, same as the DM bridge folder). Tokens attach automatically by name
  when a token spawns (same matching as the Token Library above), but most packs won't
  auto-match most of their contents that way -- both folders also have a search box so you
  can browse and manually pick an entry: Maps' "Use" loads it as the active map, Tokens'
  "Use" attaches it to whichever token is currently selected on the board.
- Character creator: build a new 5e character sheet (computed ability modifiers,
  proficiency bonus, HP, AC, saves, skills, one attack) and write it straight into
  the campaign repo's `characters/` folder (see below)

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
  token on the grid, advance to the next turn, switch to a different prepared map),
  referencing tokens by name and reasoning about the current encounter state -- including
  where everything stands on the grid, whose turn it is, and how much movement each token
  has left this turn. `next_turn` and `move_token` are what actually let Claude run the
  turn tracker and RAW speed-limited movement described above -- without calling
  `next_turn`, turn order never starts and movement stays unconstrained (which is also the
  correct default for narration outside formal combat). `switch_map` only works for maps
  that already have real art or a campaign location behind them; Claude is told exactly
  which map names are valid rather than allowed to invent one.

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

## Character creator

The **Create Character** panel (Setup tab) builds a new level-1+ 5e character sheet without
leaving the app: race, class, level, background, ability scores (fill in manually, or use
**Standard Array** or **Roll Scores**), proficient skills, one attack, spellcasting if
applicable, and personality/backstory. It computes the real numbers for you -- proficiency
bonus, ability modifiers, HP (max hit die + CON at level 1, average roll per level after),
AC (10 + DEX unless you override it), saving throws and skills (from the class's actual save
proficiencies and whichever skills you check), and writes a `characters/<name>.md` file
matching the campaign repo's existing template.

This is meant for starting a *new* character, not reproducing years of an existing one's
accumulated story -- real character files in this campaign grow far beyond the template through
actual play, and this tool only generates the clean starting point.

Writing the file reuses the same DM bridge connection and `DND_REPO_PATH` as End Session (see
above) -- it's a plain file write handled directly by `dm-bridge/watch.js`, not a Claude call,
since the sheet is already fully computed by the time it's sent. It refuses to overwrite an
existing file with the same name, and like everything else that touches the campaign repo, it
only ever writes a file -- no git commands, no commits, no pushes. Re-import the campaign folder
afterward to see the new character in the browser.

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
|                   dm-bridge action dispatcher, and the character creator's 5e math/markdown
|                   generation -- no DOM, runnable under Node
|-- ui/             Browser UI glue: rendering, event wiring, the IndexedDB-backed token
|                   library / map library / image store / dm-bridge folder-handle store,
|                   and the File System Access API folder-reference layer (assetFolders.js
|                   persists picked directory handles, folderAssets.js indexes/reads them)
|-- dm-bridge/      watch.js -- the Node script that bridges the browser to the local
|                   `claude` CLI for live combat narration and the End Session write-back,
|                   plus a plain (Claude-free) file write for Create Character -- both
|                   write into the DnD campaign repo (see above)
`-- tests/          node:test suite for engine/ and the pure (non-IndexedDB, non-File-System-
                    Access) logic in ui/tokenLibrary.js, ui/mapLibrary.js, ui/folderAssets.js
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
`engine/encounter.js`, `engine/campaign.js`, `engine/dmBridge.js`, `engine/characterCreator.js`,
and the name-matching logic in `ui/tokenLibrary.js`. Runs automatically on push/PR to `main` via
`.github/workflows/test.yml`.
