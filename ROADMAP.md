# VTT Improvements Roadmap

Working plan from the 2026-08-03 review of Campaign OS as a VTT. Organized into phases by
dependency and blast radius, not strict priority -- within a phase, pick whichever item is most
useful next. Check items off as they land; add a one-line note (commit hash or date) when you do.

Context for future-me: this file tracks a checklist of *possible* work, not commitments. Re-read
the relevant CLAUDE.md sections before starting each item -- several of these touch code with
documented non-obvious constraints (action economy, applyDamage's return shape, the sparse-field
conventions, the Windows argv-escaping rule in dm-bridge/watch.js).

## Phase 0 -- Foundations (small, low-risk, unblock everything else)

- [x] **Encounter export/import.** Done 2026-08-03. "Export" downloads `state` as
  `campaign-os-<map-slug>-<date>.json`; "Import" (file input styled as a button next to it)
  replaces `state` via the existing `normalizeEncounter()` sanitizer (same one `loadEncounter()`
  uses), so a malformed/partial file degrades safely instead of corrupting the app. Invalid JSON
  shows "Import failed..." and leaves the current encounter untouched. `ui/app.js`,
  `index.html`, `ui/styles.css` only -- no engine change. Verified with a one-off Playwright
  script (seed state -> export -> reset -> import -> matches; garbage-file import leaves state
  alone) rather than the committed suite, per this repo's existing UI-testing convention.
- [ ] **Multiple save slots / named encounters.** Once export/import exists, consider whether a
  single implicit autosave slot is still enough, or whether named local scenes (still
  localStorage, just multiple keys) are worth it. Decide after using export/import for a while --
  may turn out unnecessary if export covers the real need.

## Phase 1 -- Core DM tooling (self-contained, no architecture change)

- [x] **Generic dice roller.** Done 2026-08-03. `engine/encounter.js`'s `rollFreeform(state,
  notation)` reuses the existing `rollDice()` NdM[+-K] parser rather than a second one, self-logs
  to the Combat Log on success (`"Rolled 3d6+2: [5, 1, 4] + 2 = 12."`), and fails outright (same
  `state` reference, no log entry) for anything that doesn't parse, matching every other
  self-logging primitive's convention. New "Dice Roller" panel in the sidebar (`index.html`,
  wired in `ui/app.js`), not tied to any token. 4 new unit tests (positive/negative modifier, no
  modifier, unparseable input) plus a Playwright pass covering the same cases through the actual
  UI.
- [x] **Standalone ruler/measure tool.** Done 2026-08-03. A "Ruler" toggle in the map toolbar;
  while on, click-drag on the map draws a dashed line + live ft label instead of moving the
  selected token, clearing on release. No engine change needed -- reuses the existing
  `gridMoveCost()` (feet-per-square scale + the RAW alternating-diagonal rule) exactly as a real
  move would compute it, and a new shared `gridCellFromEvent()` helper factored out of
  `handleMapClick` so click-to-move and the ruler agree on pixel-to-cell math. Verified with
  Playwright against a map with a non-default 10 ft/square scale (not the app's own default) to
  confirm it reads the map's real settings rather than coincidentally matching a hardcoded
  default.
- [x] **AoE templates (circle only for now).** Done 2026-08-03. A "Template" toggle in the map
  toolbar plus a Radius (ft) input; while on, clicking the map centers a circular overlay there.
  Deliberately visual-only -- no `targetIds` auto-detection, per the original scope call (that
  needs real shape-vs-token geometry, a separate follow-up). Circle math lives entirely in
  `ui/app.js` (no engine change): radius in feet is converted to the grid's own feetPerSquare,
  then expressed directly in the same 0-100 percentage coordinate space `cellCenterPercent()`
  already uses for the ruler, so it reads correctly off each map's own scale. Renders as a true
  circle only when the grid is calibrated to square cells -- the same assumption the token/grid
  rendering already makes everywhere else, not a new one. Persists across unrelated re-renders
  (e.g. a token move) by hooking into the same `renderGridHandles()`-style "survive the innerHTML
  wipe" pattern `renderMap()` already used. Cone/line are still open -- circle covers the most
  common case (Fireball, Burning Hands) and was the explicit starting point. Verified with
  Playwright: correct radius math against a non-default scale, live radius updates without
  re-clicking, and survival across an unrelated re-render.
- [x] **Undo (single-level).** Done 2026-08-03. Hooked into `saveEncounter()` itself rather than
  each of the ~60 individual `state = ...` call sites: every save stashes whatever was on disk
  *before* it into `undoSnapshot`, so Undo is really "swap with what this last replaced" --
  clicking it restores the prior state, and because that restore itself calls `saveEncounter()`,
  a second click redoes it (a depth-1 swap, not a growing stack, matching the "start simple"
  scope call). Covers every mutation for free, `resetEncounter` included -- verified specifically
  that Reset followed by Undo restores the whole pre-reset encounter, the actual pain point that
  motivated this item. Session-only by design (`undoSnapshot` starts `null` on a fresh load).

## Phase 2 -- Rules depth

- [x] **Damage types.** Done 2026-08-03. `token.damageResistances`/`damageVulnerabilities`/
  `damageImmunities` (plain lowercase-string arrays, case-insensitive matching) plus a
  `damageType` on attack profiles (`STAT_BLOCKS`, Multiattack rows, spells) feed
  `damageTypeModifier()` inside `applyDamage()` -- immunity zeroes, resistance halves (rounded
  down), vulnerability doubles, both-at-once cancels out to the RAW-accepted ruling.
  `applyDamage()`'s `{state, message}` return shape is unchanged; the adjustment folds into the
  same message every other call already produces. Threaded through `attack()` (reads the
  attacker's own profile automatically), `castSpell`/`castAreaSpell` (optional
  `options.damageType`), `dmBridge.js`'s `apply_damage`/`cast_spell`/`cast_area_spell`, and
  `dm-bridge/watch.js`'s `isValidAction`/`SYSTEM_PROMPT`/`buildPrompt` (resist/vulnerable/immune
  now shown per token) and the live-session snapshot. Every SRD monster in `STAT_BLOCKS` got its
  real weapon type, except two combined-roll Bites (hell hound, giant spider) left deliberately
  untyped -- tagging a blended two-damage-type roll with either type alone would misrepresent it.
  Skeleton got its SRD-documented `damageVulnerabilities: ["bludgeoning"]`; no other
  resistances/immunities were invented for monsters not already confirmed elsewhere in this
  codebase's own comments. `engine/campaign.js` now extracts a real sheet's stated type from its
  Attacks table's Damage cell (`"1d8+3 slashing"`), and `characterCreator.js` writes new
  character sheets in that same format (round-trips cleanly on re-import) plus a new Damage
  Type field in the Character Creator UI. Token sheet gained a damage-type select (single/
  primary attack only, same scope as the existing Attack/Damage fields) and three comma-
  separated Resistances/Vulnerabilities/Immunities text inputs. 12 new/extended unit tests
  across `encounter.test.js`/`campaign.test.js`/`characterCreator.test.js` (314 total, all
  passing) plus a live Playwright pass verifying the token sheet edits persist correctly and a
  real attack through the local command parser (not just a raw API call) correctly resists.
  See CLAUDE.md's new "Damage types / resistance / vulnerability / immunity" bullet for the
  full design writeup.
- [x] **Reactions / opportunity attacks.** Done 2026-08-03. Design decision: no automatic
  geometric trigger (this engine has no path-stepping between two grid coordinates to detect
  square-by-square reach-leaving with), so `moveToken()` instead surfaces a best-effort
  start-vs-end adjacency hint in its own result message ("This may provoke an opportunity
  attack from Goblin 1.") and the DM/Claude decides whether to act on it -- same "narrative
  judgment call, no engine-side timing detection" precedent `roll_death_save`/legendary actions
  already use. `attack()` gained a third `options.actionType`, `"reaction"`: gated on
  `state.turn.round > 0` (turn order running at all) rather than "the actor's own turn" (a
  reaction is definitionally taken on someone ELSE's turn), tracked via a new sparse
  `token.reactionUsed` cleared by `nextTurn()` alongside the existing action/bonusAction flags,
  and always resolves as exactly one attack even against a Multiattack creature (RAW). Wired
  through `dmBridge.js`/`dm-bridge/watch.js` the same way `bonusAction` already is -- no
  dedicated UI button, same as `bonusAction` has never had one. 8 new unit tests (322 total)
  plus Playwright verification of both the dmBridge-level reaction wiring and the hint
  appearing through real click-to-move. See CLAUDE.md's new "Reactions / opportunity attacks"
  bullet for the full design writeup.

Phase 2 complete.

## Phase 3 -- Real fog of war

Current "fog" (`toggleFog`) is cosmetic only -- a CSS `nth-child` pattern in `ui/styles.css`, not
tied to grid position or vision. Replace with a real per-cell reveal state:
- [ ] Design the data shape: likely `state.fogTiles` per map, a sparse set/grid of revealed cells
  (same sparse-map convention the rest of the engine already uses).
  DM tools to reveal/hide tiles (paint, or reveal-around-token-radius).
- [ ] Rendering: now that the player window (Phase 5) exists, this is genuinely worth building --
  hidden tiles need to actually hide something on a screen the DM isn't looking at for it to
  matter beyond "hide it from myself." `player.html`/`ui/playerView.js` is where fog would need
  to render (a covering layer over unrevealed `.map-tile`s); the DM's own `index.html` view can
  keep showing everything, same as any real table's DM screen.

## Phase 4 -- Line of sight / vision blocking

No walls, no vision radius, no occlusion anywhere in the engine today. This is a bigger lift than
fog of war (needs wall geometry against the grid, and a visibility algorithm), but its payoff is
now real too -- the player window (Phase 5) gives it somewhere to actually matter.

## Phase 5 -- Shared/player view (biggest architectural decision on this list)

- [x] **Decide scope.** Done 2026-08-03 (user decision): read-only same-machine player window,
  not real multi-device multiplayer. Multiplayer (a server/sync service) stays out of scope --
  revisit only if remote play becomes an actual need, since it's a much bigger architecture
  change touching almost everything (storage model, auth, real-time sync), not an extension of
  this decision.
- [x] **Read-only player window.** Done 2026-08-03. New `player.html` + `ui/playerView.js`,
  opened via `index.html`'s "Open Player Window" button -- map, tokens (a bloodied/critical
  health bar, not exact HP), initiative order, combat log, no editing, no DM panels. Sync is
  polling (`localStorage` diffed every 1s), NOT `BroadcastChannel`/the `storage` event -- both
  were tried and verified NOT to fire across two tabs opened from the same `file://` path in
  Chrome (this app's normal, documented usage), despite both reporting the same nominal
  `location.origin`; direct reads DO work across those tabs, which is what makes polling
  reliable. Verified via Playwright: cross-tab sync of damage/HP-bar-color/turn-advancement
  within one poll cycle, the empty "waiting for the DM" state, and the "Open Player Window"
  button itself. See CLAUDE.md's new "Player window" bullet for the full design writeup
  (including why the origin-matches-but-still-doesn't-work finding matters for any future
  cross-tab feature). No per-token hide/reveal system yet -- a real gap for secret
  monsters/unrevealed NPCs, noted as a natural follow-up below.

Phase 5 complete (as scoped). Phase 3 (fog of war) and Phase 4 (line of sight) were sequenced
after this because a DM-only tool gets little value from either -- both now have a real
player-facing viewport to matter for, so they're unblocked.

## Smaller / lower-priority items (park here, revisit if they start to matter)

- [ ] Audio/ambience/music layer -- no existing precedent in this codebase, would be a new
  subsystem from scratch.
- [ ] Player-editable character sheets (`character.html` is currently a read-only DM-side viewer).
- [ ] Token art dedup -- already flagged in README's "Possible Next Steps"; each spawn from a
  library entry copies the same image bytes into IndexedDB again rather than sharing one record.
