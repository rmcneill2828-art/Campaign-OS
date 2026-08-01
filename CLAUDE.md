# Campaign OS

AI-native tabletop VTT companion to the DnD campaign repo at
https://github.com/rmcneill2828-art/DnD (locally, commonly checked out alongside this repo).
Campaign-OS imports campaign Markdown for characters, locations, and sessions; the DnD repo
remains the narrative source of truth. As of 2026-07-31 this isn't used for live play yet --
see that repo's own CLAUDE.md for why (short version: ability scores, saves, spellcasting/spell
slots, named class resources -- Ki, Rage, Superiority Dice, etc. -- concentration, death saves,
rest automation, exhaustion, and legendary/lair actions are all modeled now).

See README.md for the full feature list and usage. Notes specific to working on this code:

## Architecture
- `engine/` -- pure, DOM-free logic: `encounter.js` (state, tokens, combat, movement, turn
  order, saving throws, spellcasting/spell slots, named class resources, concentration, death
  saves, rest automation, exhaustion, legendary/lair actions), `campaign.js` (markdown
  import/parsing), `dmBridge.js` (translates the Claude DM bridge's actions into engine calls),
  `characterCreator.js` (5e math + markdown generation for new character sheets). Runnable and
  unit-tested under Node (`npm test`). Keep it that way: no `document`/`window` DOM access, no
  async IndexedDB/File System Access calls here -- those belong in `ui/`.
- `ui/` -- browser glue: `app.js` (rendering, event wiring), the IndexedDB-backed stores
  (`imageStore.js`, `tokenLibrary.js`, `mapLibrary.js`, `dmBridgeStore.js`), and the File System
  Access folder-reference layer (`assetFolders.js` persists picked directory handles,
  `folderAssets.js` indexes/reads them -- this is what the Tokens Folder/Maps Folder
  connections use to browse a large art pack without bulk-copying it into IndexedDB).
- `dm-bridge/watch.js` -- a Node script, run separately (`node dm-bridge/watch.js`), that
  bridges the browser to the local `claude` CLI. Three independent request/response file
  pairs: `request.json`/`response.json` for live combat narration (tools disabled, strict JSON
  reply), `end-session-request.json`/`end-session-response.json` for the session write-back
  into the DnD repo (real Read/Write/Edit access, scoped via `DND_REPO_PATH`, never git), and
  `create-character-request.json`/`create-character-response.json` for writing a new character
  sheet (no Claude call at all -- the browser already computed the markdown, so this is a plain
  file write with an overwrite guard and filename sanitization via `path.basename()`).
- `dm-bridge/live-state.json` / `dm-bridge/live-actions.json` -- a *fourth*, separate channel in
  the same connected folder, but `watch.js` never touches these two and no subprocess is
  involved at all. They exist for a live Claude Code session already working in this repo (an
  editor session -- not a `claude -p` cold-start per command) to control the board directly.
  See the "Live-session control contract" constraint below for the exact shape.

## Constraints that aren't obvious from reading the code
- `api.anthropic.com` rejects CORS from arbitrary origins (verified against the live API) --
  there is no way to call the Anthropic API directly from this browser app. All AI features go
  through `dm-bridge/watch.js` shelling out to the local `claude` CLI instead.
- On Windows, `claude` is a `.cmd` shim that can only be launched via a shell, but
  `child_process`'s Windows shell mode does not escape array args -- it just concatenates them.
  Every argv value passed to `claude` in `watch.js` must therefore be fixed and space-free (flag
  names, model aliases, temp-file paths); all untrusted/variable content (prompts, transcripts)
  goes over stdin instead. Don't reintroduce a space-containing or user-controlled argv value
  without re-reading the comments in `dm-bridge/watch.js`.
- The write-backs (End Session, Create Character) never run git and never commit/push to the
  DnD repo, on purpose -- they only edit/create files. Don't add auto-commit behavior without
  the user asking for it.
- The Claude DM bridge is a one-shot batch call, not a multi-turn tool loop: Claude decides an
  entire response's `actions` array up front and never sees any action's result before deciding
  the next one in that same response. This is why `saving_throw` can only resolve and log
  pass/fail -- it can't itself decide a follow-up `apply_damage`/`toggle_condition` based on the
  outcome; that has to be a separate later command once the DM (or Claude, prompted again) has
  seen the logged result. `cast_spell` has the same limitation for save-based spells (Fireball,
  Hold Person): it only spends the slot, it never bundles a `saving_throw` for you -- Claude has
  to issue those as separate actions in the same response instead. `use_resource` is the same
  again -- it only spends a charge of a named resource and never bundles whatever that
  resource actually does (an attack, healing, a saving throw). Concentration checks and
  starting/continuing death saves are the exceptions to "Claude has to do it in a later
  command": `applyDamage()` resolves the CON save (or the auto-loss at 0 HP), and starts
  death-save tracking or applies an automatic failed death save, synchronously in the same
  call that deals the damage, folding the result into that call's own message -- see the next
  two bullets. The one death-save piece Claude DOES have to trigger explicitly is
  `roll_death_save` for a dying token's own turn, since turn order is something only Claude
  (via the DM's narration/`next_turn`) tracks, not the engine. Don't write system-prompt
  guidance that implies otherwise for the actions that genuinely can't chain.
- A token's `abilityScores` object is intentionally sparse (only the abilities actually known
  are present) and `savingThrows` is a sparse *override* map, not a computed value --
  `engine/campaign.js`'s `extractSavingThrows` reads a real sheet's stated bonus (e.g.
  "Wisdom +6 (Resilient, lvl Fighter 4)") literally rather than recomputing modifier +
  proficiency, since real sheets accumulate feats/multiclass bumps a flat formula can't
  reproduce. `engine/encounter.js`'s `savingThrowBonus()` prefers the stated override, falling
  back to the raw ability modifier, falling back to 0. `spellcasting` (`saveDC`/`attackBonus`)
  follows the same trust-the-stated-sheet-value approach, read by `campaign.js`'s
  `extractSpellcasting` from a sheet's freeform `**Spellcasting:**` bullet (not a table, unlike
  Ability Scores/Attacks). `spellSlots` is sparse per level (1-9), each `{max, current}` --
  `extractSpellcasting` also reads a `## Current Status` `Spell slots: full (4/4 1st, ...)` (or
  partially-spent, non-"full") line when present and lets it overlay the Features bullet's
  max-only numbers, since Current Status is the more frequently updated source for what a
  caster actually has left. `castSpell()` mutates a slot's `current` directly and fails outright
  (no state change) with none left at that level; level 0 is a cantrip and never touches slots.
- A token's `resources` object is a sparse map keyed by free-text resource name (Rage, Wild
  Shape, Ki Points, Superiority Dice, Channel Divinity, ...), each `{max, current, recovery}`
  where `recovery` is `"short"` (restored by both a short and long rest) or `"long"` (only a
  long rest), defaulting to `"long"` when unspecified -- same shape as a spell slot level plus
  the recovery tag. Unlike ability scores/saving throws/spellcasting, there is **no** markdown
  auto-extraction for these -- the Features & Traits prose that describes them is far more
  heterogeneous per class than the one canonical `**Spellcasting:**` bullet spellcasting reads
  from, so reliably parsing name/count/recovery-cadence out of arbitrary text was judged too
  fragile to risk silently mis-tracking a resource during real play. They're entered by hand on
  the token sheet instead (see `ui/app.js`'s Resources section) -- a deliberate, known gap,
  documented alongside Troll's Regeneration above. `useResource()`/`restoreResource()` look the
  resource name up case-insensitively (`findResourceKey()`) so narration/Claude saying "rage"
  still matches a stored "Rage" key, and return/mutate using the sheet's own stored casing.
  Because `updateToken()`'s `resources` merge replaces a resource's *whole* entry per name (not
  a deep per-field merge), any caller that edits just `current`/`max` (like the token editor's
  combined field) must re-send the existing `recovery` alongside it, or `normalizeResources()`
  will silently reset it back to `"long"` -- `ui/app.js`'s resource-row current/max handler and
  its recovery `<select>` both do this correctly; follow that pattern for any new editor.
- Concentration: a token's `concentratingOn` field is either absent or `{spell: "<name>"}`.
  Only `castSpell({concentration: true})` sets it (auto-ending any different spell the same
  caster was already concentrating on) and `dropConcentration()` clears it voluntarily.
  **`applyDamage()`'s return shape changed from a bare `state` to `{state, message}`** (and it
  now takes an optional third `options` argument, `{critical}`) to carry the concentration
  check (a CON save, DC = max(10, half the damage, rounded down), or an automatic loss with no
  save if the damage drops the token to 0 HP) and death-save bookkeeping -- `message` is
  `null` when neither applies, so most callers are unaffected either way. Unlike
  `rollSavingThrow()`/`useResource()`/`rollDeathSave()`, `applyDamage()` deliberately does
  **not** self-log via `addLogEntry` -- damage is applied from too many different contexts (a
  weapon attack, a spell attack, a flat DM-narrated amount, the HP panel's manual Damage
  button) that each already build their own single combined message/log line, so every call
  site folds `result.message` into its own text instead of getting a second, separately-logged
  entry for free. If you add a new call site, follow `attack()`/`castSpell()`/`dmBridge.js`'s
  `apply_damage` case/`ui/app.js`'s Damage button as the four examples of how to do this
  correctly -- don't reintroduce the old `applyDamage(...).tokens` shape.
- Death saves: a token's `dying` field is either absent or `{successes, failures, stable}`; a
  separate `dead` boolean flag is set once it dies. `applyDamage()` starts `dying` the instant
  a token's hp goes from above 0 to exactly 0 (also ending any concentration, no save), and
  treats further damage to an already-0-HP token as an automatic failed death save -- two on a
  critical hit (pass `{critical: true}` -- `attack()`/`castSpell()` already do, from
  `resolveOneAttack()`'s own `isCritical`) -- rather than a roll, killing it outright at 3
  failures. `rollDeathSave()` is the actual d20 roll (10+ succeeds, a natural 1 is two
  failures at once, a natural 20 revives at 1 HP outright), self-logging like
  `rollSavingThrow()`/`useResource()` since it's its own atomic event; a no-op if the token
  isn't currently making death saves (not down, already stable, or already dead) rather than
  an error. `applyHealing()` and `updateToken()`'s `hp` change both clear `dying`/`dead` once
  hp is above 0 again -- healing a `dead` token is treated as a deliberate revival (Revivify,
  Raise Dead, a DM ruling), not blocked. `attack()`'s Multiattack loop was changed to allow
  attacking a target that's already at 0 HP (a real, meaningful hit -- an automatic failed
  save) while still stopping further sub-attacks once *this* action's own hits bring the
  target to/keep it at 0, so re-read that loop's comment before touching it again. This
  applies uniformly to every token type -- a deliberate simplification of RAW, which reserves
  death saves for PCs and leaves monsters to the DM's discretion at 0 HP.
- Rest automation: `longRest()` sets `hp = maxHp` and every `spellSlots[level].current`/
  `resources[name].current` to their max and reduces `exhaustion` by 1. Only the HP/`dying`
  branch is skipped for a token flagged `dead` (a long rest isn't a substitute for a real
  revival) -- slot/resource refresh and the exhaustion reduction still apply regardless, since
  neither needs consciousness to "have happened" during the rest. `shortRest()` restores only
  resources whose `recovery` is `"short"`, and deliberately
  never touches HP, spell slots, or exhaustion -- Hit Dice spending/recovery isn't modeled at
  all (same known gap as Troll's Regeneration), the one common class that recovers slots on a
  short rest (Warlock Pact Magic) isn't special-cased either, and only a long rest reduces
  exhaustion under RAW. Both self-log like `rollDeathSave()`/`useResource()`, and both operate
  on one token at a time -- resting "the whole party" means the DM/Claude issues one
  `long_rest`/`short_rest` action per token, there's no single "rest everyone" primitive.
- Exhaustion: `token.exhaustion` is an integer 0-6, absent when 0 (same sparse convention as
  everything else). `setExhaustion()`/`addExhaustion()` are the real, narrative-event entry
  points -- reaching level 6 through either kills the token outright (`hp = 0`, `dead = true`,
  no save, clearing any `dying`), the same instant-death `rollDeathSave()`'s three-failures
  branch produces. `updateToken()`'s `exhaustion` change is a direct correction (like its `hp`
  branch) and deliberately does **not** trigger that level-6 death check -- only a real gain
  via `addExhaustion()`/the token sheet's +1 button/`add_exhaustion` does. Of the automatic RAW
  effects, this engine only wires up the two that hook cleanly into existing mechanics:
  `attack()`/`rollSavingThrow()` force disadvantage at level 3+ (derived from the token's own
  state, not a caller-passed flag -- `attack()` correctly cancels it against an explicit
  `options.advantage` per RAW rather than exhaustion silently winning), and `effectiveSpeed()`
  halves speed at level 2+ and zeroes it at level 5+ (`token.speed` itself is never mutated, so
  the penalty can't outlive the exhaustion that caused it). **Anywhere UI/dmBridge code reads a
  token's speed for movement purposes must call `effectiveSpeed()`, not `token.speed` directly**
  -- `ui/app.js`'s DM-bridge payload, initiative-list movement note, and the token editor's
  "Moved" field all do this; a raw `token.speed ?? 30` read there would silently show Claude or
  the DM more movement than the token can actually use. Disadvantage on ability checks (level 1,
  no ability-check mechanic exists at all here) and a halved HP maximum (level 4) are
  deliberately NOT modeled -- same known-gap spirit as Troll's Regeneration/Hit Dice.
- Legendary/lair actions: `token.legendaryActions` is a single `{max, current}` tracker (same
  shape as one named resource, but a lone object, not a per-name map) -- sparse, absent when
  the token has none. Unlike resources (which only refill on a rest), `nextTurn()` resets
  `legendaryActions.current` back to `max` the instant that specific token becomes the active
  turn, matching RAW ("regains all expended legendary actions at the start of its turn") --
  this is the one place `nextTurn()` mutates something beyond `movementUsed`/
  `diagonalStepsThisTurn`, so re-check that block if you touch turn advancement.
  `useLegendaryAction()` spends `cost` (default 1) points, failing outright (same `state`
  reference, no clone leaking through) if none are tracked or not enough remain -- watch this
  specifically if you touch it, since an earlier draft of this function accidentally returned
  the already-cloned `nextState` instead of the original `state` in both failure branches,
  breaking the "same reference when nothing changed" convention every other primitive in this
  file follows. RAW's "at the end of another creature's turn" trigger condition is, like
  `rollDeathSave()`'s "at the start of its turn," a narrative judgment call left entirely to
  the DM/Claude -- the engine has no notion of whose turn just ended beyond `next_turn`'s own
  result, so don't try to auto-detect or enforce that timing here.
  `triggerLairAction(state, description)` is a lighter-weight primitive: it just enforces the
  RAW "once per round" constraint (`state.lairActionRound === state.turn.round` refuses a
  second call) and logs whatever freeform `description` the DM/Claude gives it -- there's no
  per-effect catalog, no HP/condition bookkeeping, and no synthetic "lair" pseudo-token in the
  initiative order (this engine's turn order is real tokens only); any actual mechanical
  effect the lair action causes still goes through separate existing actions (apply_damage,
  saving_throw, etc.) in the same response. `lairActionRound` lives on the whole encounter
  state, not per-map -- a deliberate simplification, since modeling a synthetic initiative-20
  slot per map would be a much bigger turn-order restructuring than this feature's scope
  warranted.
- Live-session control contract: if you (a live Claude Code session working in this repo, not
  the `dm-bridge/watch.js` subprocess) are asked to control the board directly, this is the
  channel -- no `claude -p` call, no editing `watch.js`.
  - **Read `dm-bridge/live-state.json`** for the current truth: `{state: {mapName, grid, round,
    activeToken, lairActionUsedThisRound, availableMaps, tokens: [...]}, log, updatedAt}`. The
    app (`ui/app.js`'s `buildBridgeStateSnapshot()`) rewrites this file on every state change
    while the DM bridge folder is connected -- it's always current, no request needed first.
    Each token already has `speed`/`movementLeft` as the exhaustion-adjusted *effective* value
    (see `effectiveSpeed()`), not the raw stored speed.
  - **Write `dm-bridge/live-actions.json`** to act: `{"id": "<unique per write>", "message":
    "<narration>", "actions": [ ... ]}`. The action vocabulary/shapes are exactly the ones
    `dm-bridge/watch.js`'s `SYSTEM_PROMPT` constant documents (`attack`, `move_token`,
    `cast_spell`, `use_resource`, `roll_death_save`, `use_legendary_action`,
    `trigger_lair_action`, etc.) -- read that constant as the single source of truth for shapes
    rather than guessing or duplicating it here, since it's kept in sync with `isValidAction`.
    A fresh, never-before-seen `id` is required -- `ui/app.js`'s `checkLiveActions()` polls this
    file every 2s and applies a batch exactly once (tracked via `lastLiveActionId`, primed on
    connect so a stale leftover file from a previous session isn't replayed); the same `id`
    written twice is silently ignored the second time.
  - This only works once the app has a DM bridge folder connected (**Connect to Claude Code**
    button) -- same folder/permission `watch.js` uses, but this channel is independent of it;
    `watch.js` never reads or writes these two files.
  - Verified via Playwright using an OPFS directory as a same-interface stand-in for a picked
    folder (override `window.showDirectoryPicker` to resolve to
    `(await navigator.storage.getDirectory()).getDirectoryHandle(...)`), the same technique the
    Testing section below describes -- there's no automated suite entry for this (UI/File
    System Access glue, same as the existing request/response flow), just a one-off dev-time
    verification.

## Testing
`npm test` (zero dependencies, Node's built-in `node:test`) covers `engine/*.js` and the pure
(non-IndexedDB, non-File-System-Access) logic in `ui/tokenLibrary.js`, `ui/mapLibrary.js`, and
`ui/folderAssets.js`. Runs in CI on push/PR to `main`. UI-only behavior (File System Access API,
IndexedDB round trips, DOM rendering) is verified with Playwright during development rather
than as part of the committed suite -- there's no headless picker API, so these use OPFS as a
same-interface stand-in for a picked folder.
