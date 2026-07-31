# Campaign OS

AI-native tabletop VTT companion to the DnD campaign repo at
https://github.com/rmcneill2828-art/DnD (locally, commonly checked out alongside this repo).
Campaign-OS imports campaign Markdown for characters, locations, and sessions; the DnD repo
remains the narrative source of truth. As of 2026-07-31 this isn't used for live play yet --
see that repo's own CLAUDE.md for why (short version: ability scores, saves, spellcasting/spell
slots, named class resources -- Ki, Rage, Superiority Dice, etc. -- and concentration are all
modeled now).

See README.md for the full feature list and usage. Notes specific to working on this code:

## Architecture
- `engine/` -- pure, DOM-free logic: `encounter.js` (state, tokens, combat, movement, turn
  order, saving throws, spellcasting/spell slots, named class resources, concentration),
  `campaign.js` (markdown import/parsing), `dmBridge.js` (translates the Claude DM bridge's
  actions into engine calls), `characterCreator.js` (5e math + markdown generation for new
  character sheets). Runnable and unit-tested under Node (`npm test`). Keep it that way: no
  `document`/`window` DOM access, no async IndexedDB/File System Access calls here -- those
  belong in `ui/`.
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
  resource actually does (an attack, healing, a saving throw). Concentration checks are the
  one exception to "Claude has to do it in a later command": `applyDamage()` resolves the CON
  save (or the auto-loss at 0 HP) synchronously, in the same call that deals the damage, and
  folds the result into that call's own message -- see the next bullet. Don't write
  system-prompt guidance that implies otherwise for the actions that genuinely can't chain.
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
  Shape, Ki Points, Superiority Dice, Channel Divinity, ...), each `{max, current}`, same shape
  as a spell slot level. Unlike ability scores/saving throws/spellcasting, there is **no**
  markdown auto-extraction for these -- the Features & Traits prose that describes them is far
  more heterogeneous per class than the one canonical `**Spellcasting:**` bullet spellcasting
  reads from, so reliably parsing name/count/recovery-cadence out of arbitrary text was judged
  too fragile to risk silently mis-tracking a resource during real play. They're entered by hand
  on the token sheet instead (see `ui/app.js`'s Resources section) -- a deliberate, known gap,
  documented alongside Troll's Regeneration above. `useResource()`/`restoreResource()` look the
  resource name up case-insensitively (`findResourceKey()`) so narration/Claude saying "rage"
  still matches a stored "Rage" key, and return/mutate using the sheet's own stored casing.
- Concentration: a token's `concentratingOn` field is either absent or `{spell: "<name>"}`.
  Only `castSpell({concentration: true})` sets it (auto-ending any different spell the same
  caster was already concentrating on) and `dropConcentration()` clears it voluntarily.
  **`applyDamage()`'s return shape changed from a bare `state` to `{state, message}`** to carry
  the concentration-check result (a CON save, DC = max(10, half the damage, rounded down), or
  an automatic loss with no save if the damage drops the token to 0 HP) -- `message` is `null`
  when the target isn't concentrating, so most callers are unaffected either way. Unlike
  `rollSavingThrow()`/`useResource()`, `applyDamage()` deliberately does **not** self-log via
  `addLogEntry` -- damage is applied from too many different contexts (a weapon attack, a
  spell attack, a flat DM-narrated amount, the HP panel's manual Damage button) that each
  already build their own single combined message/log line, so every call site folds
  `result.message` into its own text instead of getting a second, separately-logged entry for
  free. If you add a new call site, follow `attack()`/`castSpell()`/`dmBridge.js`'s
  `apply_damage` case/`ui/app.js`'s Damage button as the four examples of how to do this
  correctly -- don't reintroduce the old `applyDamage(...).tokens` shape.

## Testing
`npm test` (zero dependencies, Node's built-in `node:test`) covers `engine/*.js` and the pure
(non-IndexedDB, non-File-System-Access) logic in `ui/tokenLibrary.js`, `ui/mapLibrary.js`, and
`ui/folderAssets.js`. Runs in CI on push/PR to `main`. UI-only behavior (File System Access API,
IndexedDB round trips, DOM rendering) is verified with Playwright during development rather
than as part of the committed suite -- there's no headless picker API, so these use OPFS as a
same-interface stand-in for a picked folder.
