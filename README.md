# Campaign OS

Campaign OS is an AI-native tabletop campaign workspace. The current goal is simple:

> If it makes the game more fun, it is the right feature.

This repository is the software layer. Campaign notes, lore, session logs, and adventure Markdown should stay in the campaign repository and be imported later.

## Week 1 Prototype

Open `index.html` in a browser to try the first battle-map prototype.

Current features:

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

Week 3 attack command:

```text
Goblin 1 attacks Darkhawk.
```

## Claude DM bridge

The "Claude DM" panel works two ways:

- **Not connected (default):** a small local regex parser handles `spawn N <monster>` and
  `X attacks Y` phrasing. No network calls, no setup.
- **Connected:** commands are handled by a real Claude Code call, which can narrate freely
  and decide on structured actions (spawn, attack, damage, heal, toggle a condition),
  referencing tokens by name and reasoning about the current encounter state.

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

## Planned Shape

```text
Campaign OS
|-- app/          Application shell
|-- engine/       Encounter, dice, rules, and state logic
|-- ui/           Browser UI components
|-- ai/           Dungeon Master tool contracts
|-- data/         Local app database and import outputs
|-- assets/       Maps, portraits, tokens, ambience
|-- importers/    Campaign repository and PDF importers
`-- docs/         Lightweight notes and decisions
```

## Next Milestones

- Week 2: richer token sheet with damage, healing, and condition controls
- Week 3: dice-backed attacks and automatic damage
- Week 4: campaign import from the existing D&D repository

Week 4 import flow:

1. Open `index.html`.
2. Use the Campaign file picker to choose a campaign folder.
3. Campaign OS imports Markdown files into a local browser-side index.
4. Click a location to make it the active map context.
