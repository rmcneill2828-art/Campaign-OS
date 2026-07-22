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
- Fog tiles
- Save and load encounter state in the browser
- Simple command input, including `spawn three goblins`

Week 3 attack command:

```text
Goblin 1 attacks Darkhawk.
```

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
