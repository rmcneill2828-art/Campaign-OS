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
- Conditions with real mechanical effects: Blinded, Restrained, Prone, and Poisoned impose
  disadvantage on that token's own attack rolls; Invisible grants it advantage instead. Attacking
  a Blinded, Restrained, Prone, Stunned, Paralyzed, or Unconscious target is automatically at
  advantage (Blinded is bidirectional under RAW -- both a penalty on its own attacks and a bonus
  to whoever attacks it); attacking an Invisible target is automatically at disadvantage -- these combine with an
  explicit advantage/disadvantage flag and exhaustion's own disadvantage using the same RAW
  cancel-out rule. A hit against a Paralyzed or Unconscious target from an adjacent attacker is
  automatically a critical hit. Stunned, Paralyzed, and Unconscious auto-fail any STR/DEX saving
  throw with no roll; Restrained adds disadvantage to DEX saves specifically. Grappled and
  Restrained both zero a token's speed. Charmed and Frightened remain tag-only (no automated
  effect) -- their real RAW consequences need a tracked "source" token this engine doesn't model,
  so handle those by hand the same way as Troll's Regeneration.
- Remove defeated or accidental tokens
- Dice-backed attacks, rules-as-written: SRD-accurate stat blocks for the 16 monsters
  `spawn` recognizes (goblin, orc, wolf, bandit, troll, hellhound, skeleton, zombie, ghoul,
  ogre, owlbear, worg, giant spider, cultist, guard, priest), a critical hit that
  doubles only the damage dice (not a flat modifier), advantage/disadvantage on any attack
  (manual attack-control dropdown, `attacks Y with advantage`/`at disadvantage` phrasing, or
  the Claude DM bridge's `advantage`/`disadvantage` action flags), and automatic Multiattack
  for monsters that have one (a troll's Bite + two Claws resolve as one attack action,
  each roll shown individually). Troll's Regeneration now heals it automatically at the
  start of its own turn (see Start-of-turn recharge/regeneration below). Damage types are now
  tracked (see below) and every SRD monster's attacks carry their real weapon type, with one
  documented exception: a hell hound's Bite is RAW two damage types in one hit (piercing plus
  fire) rolled as a single combined damageDice notation approximating the same average total,
  so tagging the roll with either type alone would misrepresent it for a creature
  resistant/immune to only one of the two -- it's deliberately left untyped, same as a Giant
  Spider's similarly-blended piercing-plus-poison Bite. The hell hound's recharge-based Fire
  Breath has a real path end to end: it recharges automatically (see below), and the actual
  15 ft cone/6d6-fire-half-on-DEX-save effect is resolved via `cast_area_spell` (with
  `damageType: fire`) once you decide which tokens are caught in it (this engine has no
  cone/blast geometry of its own to figure that out for you). A few riders still aren't
  automated, for reasons unrelated to damage type: a Ghoul's Claws can paralyze, a Giant
  Spider's Bite can poison, and a Zombie's Undead Fortitude can keep it up at 1 HP -- none of
  these have a per-attack-rider mechanic to hook into yet, so apply them by hand.
- Damage types and resistance/vulnerability/immunity: any token can carry a list of damage
  types it resists, is vulnerable to, or is immune to (editable on the token sheet as
  comma-separated text, e.g. "fire, cold" -- matched case-insensitively). An attack's damage
  type comes from its own weapon/spell automatically where known (every SRD monster's stat
  block, an imported character sheet's Attacks table when the Damage cell states one, e.g.
  "1d8+3 slashing", or the Character Creator's new Damage type field); apply_damage/cast_spell/
  cast_area_spell can also set one explicitly (the Claude DM bridge does this when a source has
  a real, single, well-defined type). Immunity zeroes the damage outright, resistance halves it
  (rounded down), vulnerability doubles it -- a token listed as both resistant and vulnerable
  to the exact same type cancels out to the raw amount. The adjustment (and the reasoning
  behind it, e.g. "Skeleton 1 is vulnerable to bludgeoning -- damage increased to 12.") is
  folded into the same combined message every other damage source already produces, so there's
  nothing extra to read. Damage with no stated type (a flat DM-narrated amount, the HP panel's
  manual Damage button) always applies in full, ignoring resistances entirely, same as before
  this existed.
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
- Action economy: once the turn tracker is actually running and it's a token's own active
  turn, an attack or a leveled spell cast (cantrips are exempt) consumes that token's action
  for the turn -- a second one fails outright, the same "only restricted on your own turn"
  rule Speed above already follows (repositioning another token, or acting before turn order
  starts, is never restricted). An **Extra Attacks** field on the token sheet (RAW Extra
  Attack) lets an attack be made that many additional times before the action is spent -- issue
  one attack per swing, not one call covering all of them, for a Fighter/Barbarian with it. Set
  `actionType: "bonusAction"` (the Claude DM bridge's `attack`/`cast_spell` actions) for a
  genuine bonus-action use (an off-hand attack, Misty Step, Healing Word) -- it has its own
  separate one-per-turn budget, independent of the action. Reactions (opportunity attacks) are
  supported via `actionType: "reaction"` on the Claude DM bridge's `attack` action, but not
  auto-detected -- this engine has no way to track a token's exact path between two squares, so
  it can't tell on its own when a move actually leaves someone's reach. Instead, whenever a
  move ends adjacent tokens becoming non-adjacent, the move's own result message says so (e.g.
  "This may provoke an opportunity attack from Goblin 1.") so you can decide whether to issue
  the reaction attack -- it always resolves as one attack (never a full Multiattack, even for a
  monster that has one), and each token gets one reaction back at the start of its own next
  turn, same as a real table.
- Ability scores and saving throws: every token can carry real STR/DEX/CON/INT/WIS/CHA
  scores -- editable on the token sheet, filled in automatically for the six `spawn`ed
  monsters (real SRD ability scores, not guesses) and for any imported character/NPC sheet
  with an `## Ability Scores` table. A **Roll Save** control on the token sheet (or
  `<name> rolls a <ability> saving throw against DC <n>`, or the Claude DM bridge's
  `saving_throw` action) rolls a d20 + the token's real ability modifier against a DC --
  or a sheet's literal stated bonus instead, when there is one (`**Saving throws:**
  Strength +10, Constitution +7...`), since a real high-level sheet's save bonuses often
  include feats/multiclassing a flat formula can't reproduce. A saving throw only resolves
  and reports pass/fail; it doesn't apply a follow-up effect (e.g. half damage on success)
  automatically -- decide that from the reported result the same way Troll's Regeneration
  above is handled by hand.
- Ability/skill checks: any of the 18 named 5e skills (Perception, Stealth, Persuasion, etc.)
  or a bare ability (for an unnamed check, like forcing a door) can be rolled with a **Roll
  Check** control on the token sheet (or `<name> rolls a <skill> check against DC <n>`, or the
  Claude DM bridge's `ability_check` action) -- a d20 + the token's real ability modifier, or a
  sheet's literal stated skill bonus instead when there is one (`**Skills:** Perception +9,
  Stealth +6...`, imported the same trust-the-sheet-value way saving throws are). Exhaustion
  imposes disadvantage starting at level 1 here (a lower threshold than attack rolls/saves'
  level 3+), and Poisoned imposes it too, same as it does on attacks. Like a saving throw, this
  only resolves and reports pass/fail -- decide any follow-up (the door budges, the guard
  believes the lie) from the result yourself.
- Spellcasting: every token can carry a spell save DC, spell attack bonus, and per-level
  (1st-9th) spell slots -- editable on the token sheet, filled in automatically for any
  imported character sheet with a `**Spellcasting:**` bullet (DC/attack bonus/max slots) and,
  when present, a `## Current Status` `Spell slots:` line for the actual current/max count. A
  **Cast** control on the token sheet (or `<name> casts <spell> [at <target>] (cantrip|Nth
  level) [for <damage dice>]`, or the Claude DM bridge's `cast_spell` action) consumes one of
  the caster's slots at that level (a cantrip, level 0, never consumes one) and fails outright
  with no other effect if none are left. Giving it a target and damage dice also rolls a spell
  attack against that target using the caster's stated spell attack bonus -- for a save-based
  spell with no damage of its own (Hold Person) instead, cast it alone to spend the slot, then
  issue a separate `Roll Save`/`saving_throw` per target using the caster's stated spell save
  DC, once the attack roll or narration decides who's affected. For a spell that deals the
  SAME damage to multiple targets with a save for half (Fireball, Burning Hands), use
  `<caster> casts <spell> on <target1>, <target2>, ... (Nth level, <ability> save DC <n>) for
  <damage dice>` or the Claude DM bridge's `cast_area_spell` action instead -- it resolves the
  whole thing in one shot: one damage roll for the area, one save per target, full damage on a
  failure or half (rounded down) on a success, each self-contained with no manual follow-up
  needed.
- Class resources: any token can track named limited-use resources (Rage, Wild Shape, Ki
  Points, Superiority Dice, Channel Divinity, Bardic Inspiration, etc.), each with a current
  and max count and a **recovery type** (Long rest, or Short/long rest -- whichever kind of
  rest actually restores it in 5e). Add one from the token sheet's **Resources** section (name
  + max + recovery, starts full); a **Use** button (or the Claude DM bridge's `use_resource`
  action -- there's no local command-line phrasing for this one yet, unlike attacks/saves/
  spells) spends a charge and fails outright once none are left, and **Restore** tops one back
  up by hand (defaults to full) for a one-off recovery outside a full rest. Unlike ability
  scores/saving throws/spellcasting, these are **not** auto-imported from character sheets --
  class resources vary too much in name and phrasing across classes to extract reliably from
  freeform prose, so add them by hand once per character (a one-time setup, same as any other
  manually-entered field before its own extractor existed).
- Concentration: casting a spell with the **Concentration** box checked (on the token sheet's
  Cast control, or the Claude DM bridge's `cast_spell` action with `concentration: true`)
  starts concentrating on it, automatically ending whatever that caster was already
  concentrating on. From then on, any damage that token takes rolls a CON save automatically
  (DC = max(10, half the damage taken, rounded down)) to maintain it -- shown in the token
  sheet as **Concentrating on: `<spell>`** with a **Drop** button, and folded into the same
  combined message/log line as the attack or damage that triggered it (no separate roll to
  track down). Dropping to 0 HP ends concentration outright with no save, same as an
  unconscious creature really can't concentrate. Drop it voluntarily anytime with the **Drop**
  button (or `<name> stops concentrating`, or `drop_concentration`).
- Death saves: a token that drops from above 0 HP to exactly 0 automatically starts making
  death saves -- shown on its sheet as **Dying -- N successes, N failures** with a **Roll
  Death Save** button (or `<name> rolls a death save`, or the Claude DM bridge's
  `roll_death_save` action). A flat d20, no modifiers: 10+ succeeds, anything else fails (a
  natural 1 counts as two failures at once), a natural 20 instead springs the token back to 1
  HP immediately. Three successes **stabilizes** it (still down, but no more rolling required
  until it takes damage again); three failures and it **dies**. Any damage taken while already
  at 0 HP is an automatic failed save -- two on a critical hit -- not something you roll for;
  this applies whether the hit comes from a weapon attack, a spell attack, or a flat
  DM-narrated amount. Healing back above 0 HP (or a manual HP edit) clears the tracker --
  including a dead flag, if the DM/Claude chooses to heal a dead token as a deliberate
  revival (Revivify, Raise Dead, a ruling). The initiative list also shows a small DYING/
  STABLE/DEAD badge next to a token's name for at-a-glance status. This is a deliberate
  simplification of the real 5e monster-vs-PC distinction -- RAW reserves death saves for
  PCs and leaves monsters to the DM's judgment at 0 HP, but this engine applies the same
  tracker to every token type; a monster the DM just wants to consider dead at 0 HP can
  simply be left alone or edited directly.
- Hit Dice: characters get a Hit Dice pool per die size on import (a **Class & Level** line
  like "Barbarian 11 / Fighter 4" becomes 11 d12 + 4 d10 -- same-size dice from different
  classes pool together, matching RAW), editable and addable on the token sheet's **Hit
  Dice** section. A **Spend 1** button per die type (or `<name> spends a/N hit die(s)`, or the
  Claude DM bridge's `spend_hit_die` action) rolls that many dice plus the token's CON
  modifier each (minimum 1 healing per die) and heals the total, failing outright once none
  of that type are left. Spawned monsters don't get a Hit Dice pool -- only characters
  actually spend them during play.
- Rest automation: **Long Rest** and **Short Rest** buttons on the token sheet (or `<name>
  takes a long/short rest`, or the Claude DM bridge's `long_rest`/`short_rest` actions -- one
  per token; issue several to rest the whole party at once). Long Rest fully heals HP,
  restores every spell slot and every resource to max regardless of its recovery type,
  restores half (rounded down, minimum one) of every Hit Dice pool, and removes one level of exhaustion, but
  skips the HP/revival part for a token already flagged dead (that needs an actual revival,
  not a rest). Short Rest only restores resources tagged **Short/long rest** -- it never
  touches HP, spell slots, or Hit Dice directly (RAW lets a character spend Hit Dice during a
  short rest, but how many is a choice each time, not an automatic refill -- use the Spend
  Hit Die control/`spend_hit_die` action for that), almost nothing but Warlock Pact Magic
  recovers slots on a short rest (also not specially handled), and only a long rest reduces
  exhaustion under RAW.
- Exhaustion: a 0-6 level tracked per token (shown on its sheet as **Exhaustion: N/6**, with
  **+1**/**-1** buttons, or `<name> gains/loses a level of exhaustion`, or the Claude DM
  bridge's `add_exhaustion` action -- default amount 1, negative to remove levels). The engine
  automatically applies the RAW effects it can hook into cleanly: level 3+ forces disadvantage
  on attack rolls and saving throws (folded into the same roll, shown as "exhaustion
  disadvantage" -- cancels out against an explicit advantage the normal RAW way rather than
  silently overriding it), level 2+ halves and level 5+ zeroes movement speed (the Speed field
  stays the token's true, unpenalized value; `moveToken` and the DM bridge's movement info use
  the reduced effective speed), and level 6 kills the token outright, no save. Disadvantage on
  ability checks (level 1) isn't modeled -- this engine has no ability-check mechanic at all --
  and a halved HP maximum (level 4) isn't automated either; halve `maxHp` by hand on the token
  editor if actual play reaches that point. Editing the level directly via the token editor is
  treated as a correction (like editing HP), so it does **not** trigger the level-6 death the
  way a real narrative gain via the buttons/command/DM-bridge action does.
- Legendary actions: any token can track a legendary-action pool (max + current, shown on its
  sheet as **Legendary Actions N/M** with a **Use** button and a **Max** field -- set Max to 0
  to stop tracking). Spending one (or `<name> uses a/N legendary action(s)`, or the Claude DM
  bridge's `use_legendary_action` action, cost defaults to 1) fails outright once none are
  left. They regain to full automatically at the start of that token's own turn (no rest or
  manual reset needed) -- RAW reserves them for use "at the end of another creature's turn,"
  which is a narrative judgment call for the DM/Claude to make, the same way `roll_death_save`'s
  "at the start of its turn" trigger isn't enforced by the engine either.
- Start-of-turn recharge/regeneration: any token can carry a **Regeneration** amount (heals
  automatically at the start of its own turn, capped at max HP -- a troll's 10 HP/turn is set
  automatically on spawn) and/or named **Recharge Abilities** (a d6 roll at the start of its
  own turn, becoming available again at or above a stated threshold -- a hell hound's Fire
  Breath, recharge 5-6, is set automatically on spawn), both editable/addable on the token
  sheet and shown in `next_turn`'s own log entry when they trigger. A **Use** button per
  recharge ability (or the Claude DM bridge's `use_recharge_ability` action) spends it, failing
  outright if it hasn't recharged yet -- like resources/legendary actions, this only spends the
  ability; the actual effect (Fire Breath's damage and save) still needs its own action, with
  `cast_area_spell` the natural fit for an area breath weapon once you've decided which tokens
  are caught in it.
- Lair actions: a **Lair Action** control in the Initiative panel (or `Lair action: <what
  happens>`, or the Claude DM bridge's `trigger_lair_action` action) fires the current
  encounter's once-per-round lair action (RAW: initiative count 20) and logs whatever you
  describe -- a second attempt in the same round is refused until `next_turn` actually
  advances the round. Any real effect it causes (damage, a saving throw, a condition) still
  needs its own separate action/control, the same compose-only pattern spells/resources use.
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
- Player window: a read-only, player-facing view of the board (map, tokens, initiative,
  combat log) in a second browser tab or window -- a second monitor or TV a table can look at
  -- kept in sync automatically while the DM's tab is open (see below)

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
  token on the grid, advance to the next turn, switch to a different prepared map, roll a
  saving throw, roll an ability/skill check, cast a spell (single-target or, for a
  save-for-half area effect, a one-shot multi-target cast), spend a class resource, spend Hit
  Dice, start or drop concentration, roll a death save, take a long or short rest, add/remove
  exhaustion, spend a legendary action, spend a recharge ability, trigger a lair action),
  referencing tokens by name and reasoning about the current encounter, including a basic
  action economy once turn order is actually running (see below)
  state -- including where everything stands on the grid, whose turn it is, how much movement
  each token has left this turn (already reduced by exhaustion, if any), each token's ability
  scores, spellcasting (save DC, attack bonus, remaining slots per level), named resources
  (Rage, Wild Shape, Ki Points, etc., each with its recovery type), what it's currently
  concentrating on, its death-save status (dying/stable/dead), its exhaustion level, its
  legendary-action pool, and whether this round's lair action has already fired, when known.
  `next_turn` and
  `move_token` are what actually let Claude run the turn tracker and RAW speed-limited
  movement described above -- without calling `next_turn`, turn order never starts and
  movement stays unconstrained (which is also the correct default for narration outside
  formal combat). `switch_map` only works for maps that already have real art or a campaign
  location behind them; Claude is told exactly which map names are valid rather than allowed
  to invent one. `saving_throw` only decides the ability and DC -- the engine rolls the die
  and applies the target's real modifier -- and only reports pass/fail; since Claude decides
  a whole response's actions before seeing any of their results, it can't conditionally apply
  a follow-up effect (e.g. half damage on a success) in that same response, so that has to be
  a separate command once the result is visible in the log. `ability_check` works the same way
  for a non-save roll -- Perception, Stealth, Persuasion, or a bare ability for an unnamed
  check -- resolving against a named skill's stated bonus (or the governing ability's modifier)
  and only reporting pass/fail, same one-shot-batch limitation as `saving_throw`. `cast_spell` consumes the caster's
  slot at the given level (0 for a cantrip) and, only when a target is given, rolls a spell
  attack against it -- a save-based spell with no damage of its own instead needs a separate
  `saving_throw` per target in the same response, using the caster's own stated spell save DC,
  for the same one-shot-batch reason `saving_throw` can't chain into a follow-up effect on its
  own. `cast_area_spell` is the exception that actually solves this rather than working around
  it: for a spell that deals the SAME damage to every target with a save for half (Fireball,
  Burning Hands), it resolves the whole thing in one action -- one damage roll for the area,
  one save per target, full damage on a failure or half (rounded down, or none at all if
  `halfOnSave: false`) on a success -- computed inside the engine itself, so Claude never needs
  to see an intermediate roll before deciding the outcome. `apply_damage`, `cast_spell`, and
  `cast_area_spell` all accept an optional `damageType` -- Claude sets it when a damage source
  has one real, well-defined type (a fireball is fire, a mace is bludgeoning), and the engine
  applies the target's resistance/vulnerability/immunity automatically and reports the
  adjustment in the result message; `attack`'s own damage type is read off the attacker's stat
  block automatically, not something Claude ever sets. Each token's line in the state Claude
  sees lists its resistances/vulnerabilities/immunities when it has any.
  `use_resource` spends a charge of a named resource shown in that token's own list and fails
  outright if none are left or the name doesn't match one it actually has -- like the other
  compose-only actions above, it never bundles the resource's actual effect (an attack,
  healing, a saving throw), which still needs its own action in the same response.
  `cast_spell`'s `concentration: true` flag starts concentration (auto-ending any prior spell
  the same caster was concentrating on); from then on, `apply_damage`/`attack`/`cast_spell`
  dealing damage to that token automatically rolls the CON save (or ends it outright at 0 HP)
  and folds the result into that same action's message -- Claude never has to manage the
  check itself. `drop_concentration` only covers a caster stopping on purpose. Death saves
  work the same way for damage: a token dropping to 0 HP starts them, and further damage
  taken while already down is an automatic failure folded into that same action's message --
  Claude only has to explicitly call `roll_death_save` when a dying token's turn comes up
  (per `next_turn`), since the engine has no notion of turn order on its own. `long_rest`
  fully heals HP and restores every spell slot/resource to max and removes a level of
  exhaustion (skipping the HP/revival part for a token already flagged dead); `short_rest`
  only restores resources tagged as short-rest recovery, leaving HP, spell slots, and
  exhaustion untouched. `add_exhaustion` adds (or, with a negative amount, removes) exhaustion
  levels -- the engine automatically applies disadvantage on attacks/saves at level 3+ and the
  speed penalty at level 2+/5+ as part of `attack`/`saving_throw`/`move_token`'s own
  resolution, and level 6 kills outright, so Claude never has to set advantage/disadvantage
  itself for that or compute the reduced speed by hand. `use_legendary_action` spends a point
  (cost defaults to 1) from a token's own legendary-action pool and fails outright if none are
  left -- these refill automatically at the start of that token's own turn, so Claude never
  restores them itself, but deciding *when* it's actually "the end of another creature's turn"
  is a judgment call Claude makes from the narration/`next_turn` sequence, the same as
  `roll_death_save`'s timing. `trigger_lair_action` fires the current round's lair action
  (refusing a second one the same round) and logs whatever `description` says happens -- any
  real effect still needs its own separate action in the same response, same compose-only
  pattern as `cast_spell`/`use_resource`.

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

### Live Claude Code control (no subprocess)

The request/response flow above is one Claude Code call *per command*, cold-started every time.
If you're already working in this repo with Claude Code (an editor session, not the
`dm-bridge/watch.js` subprocess), it can control the board directly instead -- reading the current
state and pushing moves/attacks/whatever with no `claude -p` round trip and no narrow JSON-only
system prompt, just its normal Read/Write tools and full reasoning.

Once you've clicked **Connect to Claude Code** (same folder picker, same permission as above --
no separate connect step needed), the app automatically:

- Writes `dm-bridge/live-state.json` -- the full current board (map, tokens, HP, conditions,
  spellcasting, concentration, exhaustion, everything) -- every time anything changes.
- Polls `dm-bridge/live-actions.json` every 2 seconds for a new batch to apply -- same
  `{"message": "...", "actions": [...]}` shape as `response.json`, using the same action
  vocabulary documented in `dm-bridge/watch.js`'s system prompt (`attack`, `move_token`,
  `cast_spell`, `use_resource`, `roll_death_save`, and so on).

To actually drive the board this way, tell Claude Code (in your editor session) what you want to
happen -- it reads `dm-bridge/live-state.json` for the current truth and writes
`dm-bridge/live-actions.json` with a fresh `id` each time. See `CLAUDE.md` for the exact contract
if you're the one writing that code path.

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

## Player window

Click **Open Player Window** in the topbar to open `player.html` -- a read-only mirror of the
board (map, tokens, initiative order, combat log) with no editing controls, no Setup tab, no
campaign browser, and no Claude DM panel. Point it at a second monitor or a TV for the table to
follow along, while you keep editing on the main tab.

It stays in sync automatically: the player window polls the same browser storage the main app
saves to, once a second, and re-renders whenever it changes -- there's no server, no extra setup,
and no button to click to "push" an update. This works whether you open `index.html` directly as
a file (the normal way to run this app) or serve it over `http://`; a same-origin push mechanism
like `BroadcastChannel` was tried first but doesn't actually fire between two tabs both opened
from a `file://` path in Chrome (verified directly, not assumed), even though both report the
same nominal origin -- polling is the one approach that's reliably reachable either way, and it's
already how every other cross-context channel in this app works (the `dm-bridge/watch.js`
request/response files, the live-actions channel).

A few things worth knowing:

- Each token shows a rough health bar (colored by how bloodied it is) instead of the DM's exact
  HP numbers -- a middle ground between showing players nothing and showing them everything.
- A token can be hidden from the player window entirely -- a secret monster, an ambush not yet
  sprung, an NPC the party hasn't met yet. The token sheet shows **Visible to players** or
  **Hidden from players** with a toggle button (or the Claude DM bridge's `set_visibility`
  action); a hidden token is left out of the player window's map and initiative list
  completely, not just visually obscured. This does **not** retroactively (or prospectively)
  scrub the token's name out of combat log text -- avoid naming it in narration if the point
  is to keep it a surprise.
- It's a separate browser tab/window, not a new device -- for now this only helps a table sharing
  one physical screen setup (a laptop plus a second monitor/TV), not players joining remotely
  from their own devices. That would need real multiplayer (a server or sync service), a much
  bigger change; see the project roadmap if you're curious about that tradeoff.
- Clicking **Open Player Window** again focuses the already-open window instead of opening a
  second copy.

## Project Structure

```text
Campaign OS
|-- index.html      Main app shell (battle map, campaign browser, token sheet, Claude DM)
|-- player.html     Read-only player-facing board view (map, tokens, initiative, combat log,
|                   no editing) -- opened from index.html's "Open Player Window" button, kept
|                   in sync by polling localStorage once a second (see ui/playerView.js)
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
