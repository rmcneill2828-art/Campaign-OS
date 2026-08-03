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
  (`imageStore.js`, `tokenLibrary.js`, `mapLibrary.js`, `dmBridgeStore.js`), the File System
  Access folder-reference layer (`assetFolders.js` persists picked directory handles,
  `folderAssets.js` indexes/reads them -- this is what the Tokens Folder/Maps Folder
  connections use to browse a large art pack without bulk-copying it into IndexedDB), and
  `playerView.js` -- `player.html`'s own script, a much smaller read-only renderer for the
  player-facing board (see the "Player window" constraint below), independent of `app.js`.
- `player.html` -- the player-facing counterpart to `index.html`, opened via its "Open Player
  Window" button. Loads only `engine/encounter.js`, `ui/imageStore.js`, and `ui/playerView.js`
  -- none of `app.js`'s DM-only machinery (stores, folder connections, the DM bridge, the
  campaign browser) is loaded here at all.
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
  seen the logged result. `cast_spell` has the same limitation for a save-based spell with no
  damage of its own (Hold Person): it only spends the slot, it never bundles a `saving_throw`
  for you -- Claude has to issue those as separate actions in the same response instead. A
  save-for-half damage spell that hits multiple targets with the SAME damage (Fireball,
  Burning Hands) is the one place this got a real fix instead of a workaround: `castAreaSpell()`
  (the `cast_area_spell` action) resolves the whole thing atomically -- one damage roll, one
  save per target, full/half damage decided by the engine itself -- specifically because that
  decision doesn't require Claude to see an intermediate result the way a follow-up
  `apply_damage`/`toggle_condition` would. See the castAreaSpell bullet below for the shape.
  `use_resource` is the same
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
- `castAreaSpell(state, casterId, options)` -- `cast_area_spell` -- is the multi-target
  counterpart to `castSpell()`: `options.targetIds` is an array, not a single id, and
  `options.saveAbility`/`saveDC`/`damageDice` (plus `halfOnSave`, default `true`) describe one
  save-for-half effect applied to every target. `spendSpellSlot()` was factored out of
  `castSpell()` so both share identical slot-spend/failure behavior. The damage die is rolled
  **once** for the whole area (RAW: one roll applies to everyone caught in it), then each
  target's save is rolled individually via `rollSavingThrow()` (which self-logs, same as it
  always has) and `applyDamage()`'d for the full amount on a failure or `Math.floor(total / 2)`
  on a success (`0` instead if `halfOnSave: false`) -- each target's own concentration/
  death-save bookkeeping still resolves per-call, the same way `attack()`'s Multiattack loop
  resolves each sub-attack against one target in turn. Because each save self-logs and the
  function's own final `addLogEntry` folds everything into one more combined entry, one
  `cast_area_spell` action produces `targetIds.length + 1` log entries, not 1 -- more granular
  than `castSpell`'s single entry, and intentionally so (each roll stays individually visible).
  A save-based spell with no damage of its own (Hold Person) is NOT what this is for -- that
  still goes through plain `castSpell` + separate `saving_throw`/`toggle_condition` actions.
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
- Rest automation: `longRest()` sets `hp = maxHp`, every `spellSlots[level].current`/
  `resources[name].current` to their max, restores `Math.max(1, Math.floor(pool.total / 2))`
  (clamped to `pool.total`) to every `hitDice[dieType].current` -- PHB: "half... (minimum of
  one die)," rounded DOWN not up, since the "minimum of one" clause is only meaningful under
  round-down math (round-up already guarantees at least one for any total >= 1) -- and reduces
  `exhaustion` by 1. Only the
  HP/`dying` branch is skipped for a token flagged `dead` (a long rest isn't a substitute for a
  real revival) -- slot/resource/Hit-Dice refresh and the exhaustion reduction still apply
  regardless, since neither needs consciousness to "have happened" during the rest.
  `shortRest()` restores only resources whose `recovery` is `"short"`, and deliberately never
  touches HP, spell slots, exhaustion, or Hit Dice directly -- RAW lets a creature spend Hit
  Dice during a short rest, but how many (if any) is a per-rest choice, so that's
  `spendHitDie()` called explicitly (see the Hit Dice bullet below) rather than shortRest doing
  it automatically; the one common class that recovers slots on a short rest (Warlock Pact
  Magic) isn't special-cased either, and only a long rest reduces exhaustion under RAW. All
  three self-log like `rollDeathSave()`/`useResource()`, and all operate on one token at a
  time -- resting "the whole party" means the DM/Claude issues one `long_rest`/`short_rest`/
  `spend_hit_die` action per token, there's no single "rest everyone" primitive.
- Hit Dice: `token.hitDice` is a sparse map keyed by die type (`"d12"`, `"d10"`, ...) rather
  than a single `{die, total, current}` -- a real high-level sheet is routinely multiclassed
  (this campaign's own PCs: Darkhawk is Barbarian 11 / Fighter 4, i.e. 11d12 + 4d10), and 5e
  RAW pools same-size dice from different classes together rather than tracking them per-class,
  so `campaign.js`'s `extractHitDice` does that pooling at import time. It scans a sheet's raw
  text directly for the `**Class & Level:**` line rather than going through `extractFields`'s
  shared `fields` map, since that map's label pattern (`[A-Za-z ]+`) can't match a label
  containing `&` -- same reason `extractAbilityScores` also scans raw text instead of using
  `fields`. `spendHitDie(state, tokenId, dieType, count)` rolls `count` dice of that size plus
  the token's CON modifier each (minimum 1 healing per die, even at a very negative CON
  modifier) and heals the total via `applyHealing()`, decrementing `current` -- fails outright
  (same convention as `useResource`) with no state change if fewer remain than requested or the
  token tracks no dice of that type. Spawned monsters (`spawnMonster`) don't get a `hitDice`
  pool -- 5e monsters don't spend Hit Dice the way PCs do, so it's only populated by character
  import or by hand on the token sheet.
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
  the DM more movement than the token can actually use. Disadvantage on ability checks (level 1)
  is now modeled by `rollAbilityCheck()` (see the Conditions/ability-checks bullet below) -- a
  halved HP maximum (level 4) remains deliberately NOT modeled, same known-gap spirit as Troll's
  Regeneration/Hit Dice.
- Conditions: `conditionList` now has 11 entries (Paralyzed and Invisible were added alongside
  this mechanical wiring) and a subset carry real RAW effects, the same "derived from the
  token's own state, not a caller-passed flag" pattern exhaustion uses -- `ownAttackConditionPenalty()`/
  `ownAttackConditionBonus()` (attacker's own Blinded/Restrained/Prone/Poisoned = disadvantage,
  Invisible = advantage) and `targetGrantsAttackAdvantage()`/`targetGrantsAttackDisadvantage()`
  (target's own Blinded/Restrained/Prone/Stunned/Paralyzed/Unconscious = advantage to the
  attacker -- Blinded is RAW-bidirectional, on both this list and the self-penalty list above,
  verified against the SRD's Conditions appendix -- Invisible = disadvantage to the attacker)
  feed into `attack()`'s and `castSpell()`'s mode
  computation alongside exhaustion and an explicit `options.advantage`/`disadvantage`, using the
  same cancel-out-if-both logic. `forcesAutoCrit()` + `isAdjacent()` upgrade a hit (not a miss)
  against a Paralyzed or Unconscious target into an automatic critical when the attacker is
  within one square -- `isAdjacent` is a melee-range *proxy*, since attack profiles have no
  melee/ranged flag, so a ranged hit from an adjacent square is treated the same as a melee one;
  a documented simplification. `rollSavingThrow()` auto-fails (no roll at all) any STR/DEX save
  for a Stunned, Paralyzed, or Unconscious token, and adds disadvantage to DEX saves specifically
  for Restrained (not saves generally, matching RAW). `effectiveSpeed()` zeroes speed outright
  for Grappled or Restrained, checked before the exhaustion branches. Charmed and Frightened are
  deliberately left tag-only, no automated effect -- both need a tracked "source" token and line
  of sight this engine has no notion of, same documented-gap spirit as Troll's Regeneration.
- Ability/skill checks: `rollAbilityCheck(state, tokenId, skillOrAbility, dc)` is the
  ability-check equivalent of `rollSavingThrow` -- same structure, same only-reports-pass/fail
  contract, added alongside conditions above. `skillOrAbility` is either one of the 18 named 5e
  skills (`SKILL_LIST`) or a bare ability key (STR/DEX/CON/INT/WIS/CHA) for an unnamed check
  (forcing a door, a raw show of strength); `abilityCheckBonus()` resolves a named skill through
  a token's sparse `skills` override map (same trust-the-stated-sheet-value pattern as
  `savingThrows`/`spellcasting`, populated from a sheet's `**Skills:**` bullet via
  `campaign.js`'s `extractSkills`, matched by name so multi-word skills like "Animal Handling"/
  "Sleight of Hand" aren't position-dependent) falling back to the ability modifier, or returns
  `null` for a name that's neither a known skill nor a valid ability (distinguishing "no bonus
  known" (0) from "not a real skill/ability at all"). RAW: exhaustion level 1+ forces
  disadvantage here -- a lower, separate threshold from attack rolls/saves' level 3+ -- and
  Poisoned forces it too, the same way it does attack rolls; Blinded's "auto-fails a check that
  requires sight" is deliberately NOT modeled, since whether a given check is sight-dependent is
  a DM judgment call this engine can't make (same "leave it to narration" treatment Charmed/
  Frightened get above). `SKILL_LIST`/the skills-extraction pattern is duplicated across
  `engine/encounter.js`, `engine/campaign.js`, and `dm-bridge/watch.js` rather than shared --
  same convention as `CONDITION_LIST`/`MONSTER_LIST` already being duplicated between the
  browser engine and the Node watcher script (no bundler/shared-module mechanism between them).
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
- Start-of-turn recharge/regeneration: `token.regeneration` is a single sparse `{amount}`
  (Troll's Regeneration -- 10 HP/turn -- and the old "no start-of-turn hook to key it off"
  known gap it was documented against are both resolved by this); `token.rechargeAbilities`
  is a sparse map keyed by ability name, each `{rechargeMin, available}` (a hell hound's Fire
  Breath -- recharge 5-6 -- is the other resolved known gap). Both are read and mutated by
  `nextTurn()` itself, right alongside its existing `legendaryActions`/`movementUsed` reset for
  the newly active token: it heals `regeneration.amount` (clamped to `maxHp - hp`, skipped
  entirely at 0 HP or already full) and, for every `rechargeAbilities` entry with
  `available: false`, rolls 1d6 and flips it to `available: true` on a roll `>= rechargeMin`.
  Both messages fold into **one** combined `addLogEntry` call (only if something actually
  happened) rather than two separate ones -- calling `addLogEntry` more than once inside
  `nextTurn()` would silently orphan any mutation made to `activeToken` after the first call,
  since `addLogEntry` clones its input and returns a new object, and `activeToken` is a
  reference into the pre-clone one. Critically, **`nextTurn()`'s own return shape is
  unchanged** (still a bare state, not `{state, message}`) despite this new self-logging --
  there are ~20 existing call sites across `dmBridge.js`/`ui/app.js`/the test suite that treat
  its return value as a plain state; don't "fix" this into `{state, message}` without auditing
  every one of them first. The acid/fire exception to Troll's Regeneration, and Pack
  Tactics/damage-type nuances generally, remain unmodeled (damage types aren't tracked at
  all). `useRechargeAbility(state, tokenId, name)` only flips `available` to `false` -- the
  same compose-only pattern `useResource`/`useLegendaryAction` already use -- the actual effect
  (Fire Breath's damage/save) still needs its own separate action; `cast_area_spell` (see
  above) is the natural fit for resolving an area breath weapon once the affected tokens are
  known, since this engine has no cone/blast-shape geometry against the grid to figure that
  out on its own. `spawnMonster()` copies `regeneration`/`rechargeAbilities` off a monster's
  `STAT_BLOCKS` entry the same way it already copies `attacks` -- currently only the troll and
  hell hound have either.
- Action economy: `attack()` and `castSpell()` (leveled spells only -- a cantrip, level 0, is
  exempt) enforce a minimal action economy, but **only when it's the actor's own active turn**
  (`state.turn.tokenId === actorId`) -- the identical carve-out `moveToken()` already uses for
  speed, so narration/setup outside formal combat, or acting on a token that isn't the active
  turn, stays completely unrestricted. `options.actionType` (`"action"`, the default, or
  `"bonusAction"`) picks which of two independent per-token budgets a call consumes --
  `token.actionUsed`/`token.bonusActionUsed`, both sparse booleans reset (deleted) by
  `nextTurn()` alongside `movementUsed` for the newly active token only. `attack()` additionally
  tracks `token.attacksUsedThisTurn` (a count, not a boolean) against `1 + (token.extraAttacks ||
  0)` before setting `actionUsed` -- this is RAW Extra Attack: "more attacks as part of the same
  Attack action," not a second action, so `attack()` is the one action-consumer that can
  legitimately be called more than once before the action is spent. A leveled `castSpell()` and
  an action-type `attack()` share the same `actionUsed` flag, so casting a spell blocks a
  follow-up attack the same turn and vice versa; `attacksUsedThisTurn > 0` alone (even below the
  Extra Attack cap) is enough to block a leveled cast, since starting to attack already commits
  the turn's action to attacking. Reactions (opportunity attacks) are modeled as a third
  `options.actionType` value, `"reaction"` -- see the dedicated bullet below for the full
  shape; it's deliberately NOT gated the same way action/bonusAction are (own-active-turn-only)
  since a reaction is by definition taken on someone else's turn. **`attack()`'s and
  `castSpell()`'s own return shapes are unchanged** by any of this
  (still `{state, message}`); only the gate check (an early return) and the flag-set-on-success
  logic are new. `castAreaSpell()` is deliberately **not** gated by this -- scoped out to limit
  this phase's blast radius, since it's a newer, less common action; revisit if that gap causes
  a real problem at the table. Given how many existing behaviors this phase touches, treat it as
  the most likely to need a follow-up adjustment once it's actually exercised in play.
- Damage types / resistance / vulnerability / immunity: `token.damageResistances`/
  `damageVulnerabilities`/`damageImmunities` are plain arrays of lowercase type strings (not a
  sparse map like `resources`/`hitDice` -- there's no per-entry `{max,current}`, a type is
  either listed or it isn't), normalized by `normalizeDamageTypeList()` from either a real
  array or the token sheet's own comma-separated text-input shape, deduplicated
  case-insensitively. `DAMAGE_TYPE_LIST` (the 13 SRD types) is a reference list for UI
  dropdowns only, **not** a validation gate on the engine side -- `damageTypeModifier(token,
  damageType)` matches whatever string it's given case-insensitively against those three lists,
  so a homebrew type typed directly still works, it just won't be pre-listed in a dropdown.
  Precedence: immunity wins outright (zeroes the damage); a token listed as **both** resistant
  and vulnerable to the exact same type cancels out to the raw amount (checked before either
  single-direction branch, not left to fall through by list-ordering accident) -- the commonly
  accepted ruling for that RAW edge case; otherwise resistance halves (rounded down) or
  vulnerability doubles. `applyDamage(state, tokenId, amount, options)` gained an optional
  `options.damageType` -- **its return shape is still exactly `{state, message}`**, unchanged
  from the concentration/death-save bullet above; the adjustment is computed internally and
  folded into the same message a modifier-free call already produces (or becomes the *entire*
  message, e.g. `"Golem is immune to poison -- no damage taken."`, when nothing else about the
  hit was notable) rather than becoming a second field or a separately-logged entry. Every
  downstream calculation that used to read the caller's raw `amount` (the HP subtraction, the
  concentration DC's `half the damage taken`) now reads the post-modifier adjusted amount
  instead, since that's what actually happened to the token -- re-read `applyDamage()` before
  adding a new call site that assumes otherwise. A `damageType`-free call (every call site that
  existed before this feature, and still the deliberate choice for the HP panel's manual
  Damage button and a flat DM-narrated amount with no stated type) skips the whole check --
  full amount applies, identical to pre-feature behavior, so nothing changed without opting in.
  `attack()` reads `damageType` off the attacker's own attack profile automatically (`token.
  damageType` for a single-attack token, `token.attacks[].damageType` per Multiattack row) --
  Claude/the DM never sets it for `attack`, only for `apply_damage`/`cast_spell`/
  `cast_area_spell`, where it has to be told what a narrated/spell source's type actually is.
  `STAT_BLOCKS` carries a real SRD weapon type per attack for every monster except two
  deliberately-untyped combined-roll Bites (hell hound: piercing+fire; giant spider:
  piercing+poison) -- tagging either as a single type would misrepresent it for a creature
  resistant/immune to only one of the blended two, so both stay untyped on purpose, not as an
  oversight. Skeleton is the one monster with a real `damageVulnerabilities: ["bludgeoning"]`
  entry (SRD-documented); no other monster below got resistances/immunities invented for it --
  only what's already confirmed elsewhere in this file's own comments made it in, to avoid
  silently mis-modeling a monster's real stat block. `engine/campaign.js`'s
  `extractAttackRows` reads a real sheet's Damage cell the same way `characterCreator.js`
  writes one back (`computeAttack`'s generated cell + table row) -- dice notation followed by
  the type word, e.g. `"1d8+3 slashing"` -- via a plain word-list regex matched against the
  whole cell, not just text after the dice, so a rider mentioned later in the same cell (a
  Sting's `"2d8+4 piercing plus 5d6 poison"`) still resolves to the weapon's own type
  (piercing), not the rider's. `dm-bridge/watch.js` duplicates `DAMAGE_TYPE_LIST` under its own
  name (same MONSTER_LIST/CONDITION_LIST/SKILL_LIST convention -- no bundler between the Node
  script and the browser engine) and validates an incoming `damageType` against it in
  `isValidAction`; `buildPrompt()`'s per-token line surfaces `resist:`/`vulnerable:`/`immune:`
  segments the same way it already surfaces conditions/exhaustion/etc. The live-session channel
  (`buildBridgeStateSnapshot()` in `ui/app.js`) sends the same three fields per token in
  `live-state.json` for the same reason. The token sheet editor's `damageType` select only
  edits the token's own single/primary attack (like `attackBonus`/`damageDice` already do) --
  a Multiattack profile's per-row type isn't editable there, same limitation as those two
  fields; the three list fields are plain comma-separated text inputs submitted as strings,
  which `normalizeDamageTypeList` accepts directly (no pre-parsing needed in `ui/app.js`).
- Reactions / opportunity attacks: `attack()`'s `options.actionType` gained a third value,
  `"reaction"`, alongside `"action"`/`"bonusAction"`. **Deliberately NOT auto-detected** --
  this engine has no square-by-square path tracking between two grid coordinates
  (`gridMoveCost`/`moveToken` only compute a distance/cost total, never a real path), so it
  cannot know whether a token passed through and back out of another's reach mid-move, or
  which exact square "leaving reach" happened on. Rather than build real path-stepping
  (a much bigger feature) or silently do nothing, `moveToken()` gained a cheap, honest
  *approximation*: `tokensLeavingReach(beforeState, afterState, moverId)` (start-vs-end
  `isAdjacent()` only) and its message-building wrapper `reachHint()`, folded into both of
  `moveToken()`'s own return messages (the free-movement branch and the speed-gated branch)
  as a trailing `" This may provoke an opportunity attack from <names>."` clause -- purely
  informational, never blocks the move or spends anyone's reaction itself. Calling
  `attack(reactorId, moverId, {actionType: "reaction"})` off the back of that hint is a
  narrative judgment call left to the DM/Claude, the exact same "no engine-side timing
  detection" precedent `roll_death_save`'s "at the start of its turn" and legendary actions'
  "at the end of another creature's turn" already use -- don't try to make the hint
  auto-trigger the action. Gating is the OPPOSITE of action/bonusAction's "only restricted on
  the actor's own active turn": a reaction is by definition taken on someone ELSE's turn, so
  it's instead gated whenever `state.turn.round > 0` (turn order running at all) regardless of
  whose turn it currently is, tracked via a new sparse `token.reactionUsed` boolean cleared by
  `nextTurn()` for the newly active token alongside `actionUsed`/`bonusActionUsed`/
  `attacksUsedThisTurn` -- matching RAW's actual rule ("you regain your spent reaction at the
  start of each of your turns," not at the start of the round). A reaction ALWAYS resolves as
  exactly one attack, even for a Multiattack creature -- `attack()` slices `attacker.attacks`
  down to just its first entry (or the usual single-profile fallback) when
  `actionType === "reaction"`, since RAW opportunity attacks are never a full Multiattack
  action; `useLabel` (whether to prefix the message with the attack's name, e.g. "Bite") was
  changed from `profiles.length > 1` to `profiles.length > 1 || Boolean(profiles[0]?.name)` so
  a named single-profile reaction still shows which attack was used. `dmBridge.js`'s `attack`
  case and `dm-bridge/watch.js`'s `isValidAction`/`SYSTEM_PROMPT` accept `actionType:
  "reaction"` the same way they already accept `"bonusAction"` -- there is deliberately no
  dedicated UI button for it (same as `bonusAction`, which has never had one either); it's
  reachable through the DM bridge action field and, for a live Claude Code session, the
  live-actions channel.
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
- AoE templates (Circle/Cone/Line): entirely a `ui/app.js`-local UI concern, same as when
  Circle shipped alone -- `templateShape`/`templateOrigin`/`templateAngleDeg` never touch
  `state`, never persist. The shape MATH, though, lives in `engine/encounter.js`
  (`pointInCircle`/`pointInCone`/`pointInLine`), pure and unit-tested, for the same reason
  `segmentsIntersect`/`distanceToSegment` do -- `ui/app.js` calls them both to render the
  overlay and to auto-detect which tokens the shape currently covers (the roadmap's
  "auto-target-detection" item: the label lists covered token names, e.g. `"20 ft cone —
  Goblin 1, Goblin 2"`, so the DM doesn't have to eyeball which cells are covered before typing
  a `cast_area_spell` command -- it does NOT call `castAreaSpell` itself; the DM/Claude still
  issues that separately). **`pointInCone` had a real bug caught by its own unit tests before
  shipping**: the RAW SRD text ("the cone's width at a given point along its length is equal to
  that point's distance from the point of origin") describes a TRUE TRIANGLE, but the first
  implementation tested `distance-from-apex <= length AND angle-from-centerline <=
  atan(0.5)` -- a circular SECTOR ("pie slice"), a genuinely different, wider shape than a
  triangle for any point off the centerline. The fix uses the same rotated-frame technique
  `pointInLine` already uses (rotate the point into the shape's own reference frame, apex/
  origin at (0,0), axis along +x): a cone point is in-shape when its along-axis position
  (`localX`) is within `[0, length]` and its perpendicular offset (`localY`) satisfies
  `abs(localY) <= localX / 2` -- literally encoding "half-width at this point equals half this
  point's distance along the axis," i.e. width = distance, with no separate angle constant
  needed at all. If you touch this again, re-derive from the RAW text directly rather than
  reasoning informally about "a cone shape" -- it is more specific (narrower) than the word
  usually implies. All three shapes' geometry is computed in a **cell-unit coordinate space**
  (a cell's center sits at `index - 0.5`, the same convention wall vertices already use) so
  `vertexPercent()` (built for walls) converts template vertices to render percentages too, no
  separate conversion function needed. **Only Circle is placed with a plain click** (unchanged
  since it shipped alone); **Cone and Line need a click-drag** instead, since a direction has
  to come from somewhere -- `startTemplateDrag()`/`dragTemplateAim()`/`endTemplateDrag()` mirror
  the Ruler/Walls drag lifecycle, computing the aim angle straight from raw screen-pixel deltas
  (`Math.atan2(dy, dx)`, no unit conversion) -- valid specifically because a calibrated
  square-cell grid means pixel-space angles and real angles already agree, the same assumption
  every other angled/circular overlay in this file leans on. Switching the shape dropdown
  clears any current placement (`templateOrigin = null`) rather than trying to reinterpret a
  stale circle center as a cone apex or vice versa. **Starting a Cone/Line drag on a token's own
  cell is excluded** (`event.target.closest(".token")`), the same convention Circle's click and
  the Ruler tool already use -- a caster aiming a cone from their own square has to start the
  drag from just beside themselves, a known, consistent (not new) limitation.
  `handleMapClick()` picked up a real, previously-shipped bug while this work was in progress
  and got fixed alongside it: it was missing a `wallsModeOn` guard, so clicking near a wall to
  delete it (Walls tool) would ALSO fall through to `moveSelectedToken()` afterward if a token
  happened to be selected -- the browser's native mousedown-then-click sequence fires a real
  `click` event after `endWallDrag()` runs, and nothing had been suppressing it. Now guarded
  the same way `rulerModeOn` already was.
- Line of sight / walls: `state.maps[mapName].walls` is a plain array of `{x1,y1,x2,y2}`
  segments in **grid VERTEX space** -- integer coordinates `0..columns`/`0..rows`, the corners
  *between* cells -- not the `1..columns` cell-INDEX space token `x`/`y` use. Absent/empty
  (the default for every map that's never had a wall drawn on it) means **no line-of-sight
  restriction at all**, checked as the very first thing in `hasLineOfSight()` -- a deliberate
  fast path, not just an optimization: it's what makes this feature a no-op for every
  pre-existing map/encounter that never gets a wall, rather than something that changes
  behavior everywhere the moment it shipped. `hasLineOfSight(state, mapName, ax, ay, bx, by)`
  takes CELL coordinates (matching every other coordinate in this file) and internally converts
  both to their **cell-center** point in vertex space (`index - 0.5`, always a half-integer)
  before running `segmentsIntersect()` (the textbook orientation-based test) against every
  wall -- centers landing exactly on an integer wall vertex is therefore *impossible*, which
  sidesteps the "does a ray touching a wall's endpoint count as blocked" ambiguity for the
  common case entirely rather than needing to resolve it. `hasLineOfSight` itself is a
  **straight-line check only** -- no dim-light gradation, no distance limit of its own; a
  wall-based obstruction is either in the way or it isn't. `cellVisibleToHero(state, mapName,
  hero, x, y)` is the layer that adds a per-hero **vision radius**: `hero.visionRange` (feet,
  sparse -- absent means unlimited) is checked via `gridMoveCost(..., 0)` (a one-off static
  distance measurement, not a real move -- the same feet-per-square + alternating-diagonal
  measure the Ruler tool already shows the DM, so "how far away" means the same thing
  everywhere in this app). **Critically, `cellVisibleToHero` re-checks "does this map have any
  walls at all" itself, before even calling `hasLineOfSight`**, rather than trusting
  `hasLineOfSight`'s own internal fast path to cover it -- without that explicit early return, a
  DM who fills in a hero's Vision Range on a map that has never had a wall drawn would find
  monsters silently disappearing from the player window with no wall involved at all, breaking
  the "no walls = zero restriction, full stop" invariant this whole feature set is built around.
  If you add a third gate here later, it needs the same explicit early return, not just a
  dependency on `hasLineOfSight`'s fast path. This is not a lighting model -- no per-cell
  bright/dim/dark state, no light sources, just a flat maximum sight distance.
  `isVisibleToParty(state, token)` is the actual consumer-facing check: a `hero`-type token is
  always visible (a PC always sees itself), otherwise it's visible if `cellVisibleToHero`
  succeeds against **any** hero-type token on the same map (union over the whole party, "if any
  one of you can see it, the table sees it") -- and if there are no hero tokens on the map at
  all, it returns `true` unconditionally (nothing to hide anything *from*), rather than hiding
  everything by default. `ui/playerView.js` applies this as a second filter, independent of and
  layered on top of `hiddenFromPlayers` -- a token can be both in line of sight AND manually
  hidden, and the manual flag still wins (both filters just `.filter()` in sequence, whichever
  order; there's no precedence logic to get wrong since they can only ever narrow the set
  further). `findNearestWallIndex`/`distanceToSegment` are UI hit-testing helpers (perpendicular
  point-to-segment distance), not part of the line-of-sight check itself -- they exist only so
  `ui/app.js` can answer "did the DM click near an existing wall" for deletion.
  `addWall`/`removeWall`/`clearWalls` mutate `state.maps[mapName].walls` directly, same
  `clone()`-then-assign convention as `setMapGrid`/`setMapView`; `removeWall` with an
  out-of-range index returns the **same** `state` reference unchanged (the standard "rejected,
  nothing to log" convention this file uses throughout), not a clone or a thrown error.
  `ui/app.js`'s Walls tool: `gridVertexFromEvent()` (a NEW helper, distinct from the existing
  `gridCellFromEvent()` the ruler/template/click-to-move already share) snaps a click to the
  nearest grid-LINE intersection via `Math.round`, not the nearest cell via `Math.floor` --
  necessary because wall endpoints live in vertex space, not cell space. A click-drag between
  two different vertices draws a new wall on release; a click that starts and ends on the SAME
  vertex (no genuine drag happened) instead searches for and removes the nearest wall within
  0.35 grid units, via `findNearestWallIndex`. Unlike the ruler/template overlays (transient,
  UI-only, never persisted), walls are real map data, so they render on the DM's own map
  **unconditionally** -- `renderWallsOverlay()` doesn't check whether Walls mode is currently
  toggled on, the same "the grid itself always shows" precedent Map Settings already follows;
  only drawing/deleting requires the toggle. `add_wall`/`remove_wall_near` are the DM-bridge
  equivalents (`engine/dmBridge.js`, mirroring `set_visibility`'s pattern) -- `add_wall` takes
  the same `{x1,y1,x2,y2}` vertex-space coordinates `addWall()` does; `remove_wall_near` takes a
  single point and deletes whichever wall `findNearestWallIndex` finds closest, using a wider
  0.75-grid-unit threshold than the UI's own 0.35 (Claude is estimating a coordinate from
  narration, not clicking a pixel, so it needs more slack to land near the wall it actually
  means). `SYSTEM_PROMPT` is explicit that these are for a real narrated geometry change (a
  wall collapsing, a secret door), not something to reach for casually, and that Claude
  shouldn't add a wall just to "turn on" line of sight/fog of war for a map that doesn't
  actually call for an obstruction -- the per-map wall count shown in the prompt (`Walls on
  this map: N`, from a new `wallCount` field in `buildBridgeStateSnapshot()`/`buildPrompt()`)
  is there so Claude can check before deciding, the same way `hiddenFromPlayers` status is
  shown per-token before `set_visibility` is used.
- Fog of war: **replaced, not layered onto, the previous "fog" feature** -- `state.fogEnabled`,
  the `#toggleFog` button, and `ui/styles.css`'s `body[data-fog="on"] .map-tile:nth-child(...)`
  rules (a purely decorative pattern completely disconnected from grid position or vision) were
  all deleted outright rather than kept alongside the real system, since a fake "Toggle Fog"
  button surviving next to genuine fog of war would be actively misleading, not harmless dead
  weight. `state.maps[mapName].revealedTiles` is a sparse `{"x,y": true}` map (same key format
  as walls' own vertex/cell coordinates, just cell-index this time, not vertex space) --
  presence means "the party has ever seen this cell," absence means never explored; there is
  **no fourth state and no decay** -- once revealed, a cell stays revealed forever until an
  explicit `resetFog()`. `visibleCellsForParty(state, mapName)` is the live computation (every
  cell any hero currently has line of sight to, via `hasLineOfSight` -- an O(cells x heroes)
  scan, cheap for realistic map/party sizes and not worth optimizing preemptively); no heroes on
  the map returns an **empty** array, the opposite default from `isVisibleToParty`'s own "no
  heroes = show everything" -- there being no party to compute visibility for is genuinely
  "nothing explored yet," not "nothing to hide." `revealVisibleTiles(state, mapName)` merges
  that live computation into the persisted `revealedTiles` memory and is called from
  **`ui/app.js`'s `saveEncounter()`**, not from any individual action (`moveToken`, a DM-bridge
  move, spawning a monster, anything) -- the same "hook the one choke point every mutation
  already flows through" reasoning the Undo bullet above documents, chosen specifically so no
  future movement path can forget to trigger a reveal. Both `revealVisibleTiles` and
  `resetFog` short-circuit to the **same state reference** (no clone) when there's nothing to
  do -- no walls on the map at all (the fast path that makes fog a no-op for every map that's
  never had one, i.e. almost all of them), nothing newly visible this call, or nothing to reset
  -- matching every other no-op-means-no-clone primitive in this file.
  `ui/playerView.js`'s three-tile-state rendering (`map-tile-unexplored` fully opaque,
  `map-tile-dimmed` translucent, neither class = currently visible) reads `revealedTiles` for
  the "ever explored" half and calls `visibleCellsForParty` itself for the "currently visible"
  half, gated behind the identical `fogActive = wall array non-empty` check the token-hiding
  filter already uses -- a wall-free map renders with **zero** fog classes applied, not "every
  tile unexplored," the same "absence of walls means absence of the whole mechanism" precedent
  as everywhere else walls are consumed. This composes for free with the existing token
  visibility filter rather than needing new logic to coordinate them: every currently-visible
  cell was, by construction, just merged into `revealedTiles` in the same `saveEncounter()`
  call that computed it, so "unexplored" implies "not currently visible" implies any token
  there is already hidden by `isVisibleToParty` on its own. Only the player window ever
  renders fog -- `index.html`'s own map is untouched by any of this, same "DM sees everything"
  convention as exact HP and hidden tokens. **Reset Fog** (`ui/app.js`, next to Clear Walls)
  clears one map's `revealedTiles` via `resetFog()`, behind the same `window.confirm(...)`
  pattern `clearWallsButton`/the token/map library "Clear All" buttons already use.
- Token image dedup: `ui/imageStore.js`'s `saveImageDeduped(dataUrl)` is **content-addressed**
  -- the key is `"sha256-" + SHA-256(dataUrl)` (via `crypto.subtle.digest`, confirmed working
  under a plain `file://` origin, not just `https://`/`localhost` -- verified directly with
  Playwright before relying on it, not assumed), not a per-call `generateKey()` random ID. Used
  by `applyLibraryImages` (auto-attach at spawn -- e.g. three goblins matching the same Token
  Library entry) and `useTokenFolderEntry` (manually attaching the same Tokens Folder file to
  more than one token) -- both previously gave every token spawned/attached from the same
  source its own full copy of the same bytes; now they share one IndexedDB record. Falls back
  to a plain `generateKey()`-based save if `crypto.subtle` is ever unavailable -- dedup is a
  nice-to-have, never something that should block a token from getting its portrait.
  **A key from `saveImageDeduped` may be referenced by more than one token, so it must never be
  passed to `deleteImage()` directly** -- every place a token's image can be replaced or
  cleared (the token sheet's own file-upload `change` handler, the **Clear Image** button,
  `useTokenFolderEntry`'s own replace-on-reattach) now calls `ui/app.js`'s
  `deleteTokenImageIfUnshared(key)` instead, which recognizes and skips any `"sha256-"`-prefixed
  key, only ever deleting a key guaranteed unique to one caller (the `generateKey()`-based
  `"token-<timestamp>-<random>"` shape a direct, one-off file upload still uses and is never
  deduped). If you add a new place a token's image can be replaced/cleared, use this helper,
  not `CampaignOSImageStore.deleteImage()` -- verified both directions with Playwright: clearing
  one of three tokens sharing a deduped image leaves the other two resolving correctly and the
  underlying record still present (not deleted out from under them), while clearing a
  genuinely unique, non-deduped image still actually removes it from IndexedDB. Map images and
  a token sheet's own direct file upload are deliberately **not** deduped -- maps are rarely
  identical to each other, and an ad-hoc upload has no known "source" to dedupe against in the
  first place; scope stayed on the two auto/library-sourced attach paths the roadmap's "token
  art dedup" item was actually about.
- Player window: `player.html` + `ui/playerView.js` sync with the DM's `index.html` tab by
  **polling `localStorage.getItem("campaign-os-encounter-state")` once a second and diffing
  the raw JSON string** against the last-seen value -- not `BroadcastChannel`, not the
  `storage` event. Both were tried and rejected after verifying directly with Playwright (two
  pages both navigated to the same `file://` path, the app's normal "just open index.html"
  usage): neither fires across those two tabs in Chrome, even though `location.origin` reports
  the identical `"file://"` string for both -- Chrome still treats them as unable to notify
  each other. Direct `localStorage`/IndexedDB *reads* DO work across those same tabs (same
  underlying storage partition), which is exactly what makes polling viable and is why it's
  the one approach actually reliable in this app's real, file://-first deployment. This is the
  same reasoning (and interval) as every other cross-context channel already in this codebase
  (`dm-bridge/watch.js`'s request/response polling, `checkLiveActions()`'s 2s poll) -- don't
  swap this for an event-based mechanism without re-verifying it actually fires over `file://`
  first, the same way this decision was made. `playerView.js` is deliberately independent of
  `ui/app.js` -- it re-implements a small, read-only subset of `renderMap()`/
  `renderMapBackground()`/`renderInitiative()`/`renderCombatLog()` (mirroring their exact CSS
  classes/DOM shape from `ui/styles.css` so nothing needs new page-specific styling) rather
  than importing or sharing code with `app.js`, since `app.js`'s render functions are entangled
  with the DM's own editable `state`/`selectedTokenId`/library stores in ways a read-only
  mirror shouldn't need or want. Token HP is shown as a color-graded bar (bloodied/critical
  thresholds at 50%/25%), never the DM's exact numbers. A token's sparse `hiddenFromPlayers`
  boolean (absent/visible by default, same convention as `dead`/`actionUsed`/every other sparse
  flag in this file) is the per-token hide/reveal system -- `ui/playerView.js`'s single filter
  point (`tokens = state.tokens.filter(t => t.mapName === state.mapName && !t.hiddenFromPlayers)`)
  excludes it from BOTH the map and the initiative list, since `renderInitiative()` is called
  with that same already-filtered array rather than re-deriving its own. Toggled from the token
  sheet (a `visibility-status` row + button, right under the heading, mirroring `updateToken()`
  directly the same way the HP quick-buttons do -- no dedicated engine primitive, no
  self-logged message, since this is a DM-only settings toggle, not a game event) or via the
  Claude DM bridge's `set_visibility` action (`{target, hidden: true|false}` -- an explicit
  boolean, not a blind toggle like `toggle_condition`, since Claude needs to be able to set the
  correct state without necessarily having tracked whether it was already hidden; each token's
  line in `buildPrompt()` shows `", hidden from players"` when true so Claude can check first
  anyway). **Does NOT retroactively or prospectively redact a hidden token's name out of
  freeform combat log text** -- a known, documented limitation, not an oversight: log entries
  are already-generated strings by the time this filter could apply, and no attempt is made to
  scrub token names out of narration text either; the SYSTEM_PROMPT tells Claude not to name a
  hidden token in its own `message` if the point is to keep it a surprise, but that's a
  prompting convention, not an engine-enforced guarantee. `index.html`'s **Open Player Window**
  button uses a fixed `window.open()` target name (`"campaignOSPlayerWindow"`, not `"_blank"`)
  so repeated clicks focus the existing window instead of spawning duplicates.

## Testing
`npm test` (zero dependencies, Node's built-in `node:test`) covers `engine/*.js` and the pure
(non-IndexedDB, non-File-System-Access) logic in `ui/tokenLibrary.js`, `ui/mapLibrary.js`, and
`ui/folderAssets.js`. Runs in CI on push/PR to `main`. UI-only behavior (File System Access API,
IndexedDB round trips, DOM rendering) is verified with Playwright during development rather
than as part of the committed suite -- there's no headless picker API, so these use OPFS as a
same-interface stand-in for a picked folder.
