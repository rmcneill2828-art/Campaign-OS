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
- [ ] **Multiple save slots / named encounters.** Moved to Phase 8 (below) as part of the
  2026-08-03 work-plan pass -- kept here as a pointer so this line's history isn't confusing.

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

- [x] **Real per-cell fog of war.** Done 2026-08-03. Replaced the old cosmetic `toggleFog`
  (a CSS `nth-child` pattern completely disconnected from grid position or vision) outright --
  `state.fogEnabled`, the button, and the CSS rules were all deleted, not kept alongside the
  real thing, since a fake toggle surviving next to genuine fog of war would be actively
  misleading. Turned out not to need a separate "design the data shape / manual paint tools"
  step at all -- Phase 4's walls + line-of-sight primitives (`hasLineOfSight`,
  `isVisibleToParty`), built the same day, made fog of war fully **automatic** instead: a new
  `visibleCellsForParty()` computes every cell any hero currently sees, and
  `revealVisibleTiles()` merges that into `state.maps[mapName].revealedTiles` (sparse
  `{"x,y": true}`, once revealed stays revealed) every time the encounter saves -- no manual
  reveal/hide painting UI needed, since the same walls a DM draws for token-hiding already
  drive this. `ui/playerView.js` renders the standard three-state model (never explored =
  hidden entirely, explored-but-not-currently-visible = dimmed, currently visible = normal),
  gated behind the same "map has walls" check the token filter uses -- a wall-free map has no
  fog at all, matching every other "no walls = no restriction" default in this feature set.
  **Reset Fog** (map toolbar, next to Clear Walls) forgets a map's explored memory. Only the
  player window ever shows fog; the DM's own map is untouched. 9 new unit tests (338 total)
  plus a full Playwright pass: confirmed the old toggle is gone, and walked the whole
  unexplored -> visible -> dimmed-and-remembered -> reset cycle live through both browser tabs.
  See CLAUDE.md's new "Fog of war" bullet for the full design writeup.

Phase 3 complete.

## Phase 4 -- Line of sight / vision blocking

- [x] **Walls + line-of-sight token filtering.** Done 2026-08-03. `state.maps[mapName].walls`
  -- a plain array of `{x1,y1,x2,y2}` segments in grid VERTEX space (0..columns/0..rows, cell
  *corners*, distinct from the 1..columns cell-index space tokens use) -- absent/empty (every
  map that's never had a wall drawn) means no restriction at all, a deliberate fast path that
  makes this a no-op everywhere until a DM actually uses it. `hasLineOfSight()` (standard
  orientation-based segment intersection against cell-center points, so a ray can never land
  exactly on a wall vertex) + `isVisibleToParty()` (visible if it's a hero, or in line of sight
  of ANY hero on the map -- "if one PC can see it, the table sees it"; no PCs on the map at all
  = fully visible, nothing to hide from) are new `engine/encounter.js` primitives.
  `ui/playerView.js` applies this as a second filter alongside (not instead of)
  `hiddenFromPlayers`. New **Walls** map-toolbar toggle: click-drag between two grid vertices
  draws a wall, clicking near an existing one (no genuine drag) removes it, **Clear Walls**
  wipes a map's walls entirely; walls render on the DM's own map unconditionally (real
  persisted data, not a transient tool overlay like the ruler/template). Straight-line-of-sight
  only -- no vision radius/darkvision distance limit, no fog-of-war memory of previously-seen
  area (Phase 3 was explicitly skipped, so there's no tile-reveal state to layer this into
  yet). No Claude DM bridge action for drawing/removing walls (a DM-only map-prep tool, not
  something narration would plausibly trigger). 6 new unit tests (331 total) plus a full
  Playwright pass: draw a wall through real click-drag, confirm the player window hides the
  now-blocked token within one poll cycle, click-to-delete the wall, confirm the token
  reappears, redraw + Clear Walls with the confirm dialog. See CLAUDE.md's new "Line of sight /
  walls" bullet for the full design writeup.

Phase 4 complete (line-of-sight token filtering). This turned out to be a direct prerequisite
for Phase 3 (fog of war), built the same day -- see Phase 3 above.

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
  cross-tab feature).
- [x] **Per-token hide/reveal.** Done 2026-08-03 (same-day follow-up -- the gap noted right
  after the player window shipped). A sparse `token.hiddenFromPlayers` boolean, toggled from
  the token sheet (a status row + button under the heading) or the Claude DM bridge's new
  `set_visibility` action (`{target, hidden: true|false}` -- an explicit boolean, not a blind
  toggle, so Claude doesn't need to have tracked prior state correctly). `ui/playerView.js`
  excludes a hidden token from both the map and initiative list at its one token-filtering
  point. Does NOT scrub a hidden token's name out of freeform combat log text -- a known,
  documented limitation (log entries are already-generated strings by the time this could
  apply), not attempted. 5 new unit tests (325 total) plus Playwright verification of the full
  loop: seed a hidden token, confirm it's absent from the player window, reveal it from the DM
  token sheet, confirm the player window picks it up within one poll cycle.

Phase 5 complete (as scoped). Phase 3 (fog of war) and Phase 4 (line of sight) were sequenced
after this because a DM-only tool gets little value from either -- both now have a real
player-facing viewport to matter for, so they're unblocked.

---

# Work plan: what's next (2026-08-03 pass)

Everything above (Phases 0-5) is done except the one item moved down to Phase 8. What follows is
every open thread identified along the way -- both the original "smaller/lower-priority" parking
lot and the follow-ups each phase's own bullets flagged as deliberately out of scope -- organized
into phases in **recommended order**: cheap, high-value finishing touches on freshly-shipped work
first (while the design is still fresh), then medium-effort feature completions, then cleanup,
then the two large, open-ended items last (they need real scoping conversations before starting,
the same way Phase 5 did).

## Phase 6 -- Finish line of sight (small, high-value, builds on Phase 3/4 directly)

- [ ] **Vision radius / darkvision distance limit.** `hasLineOfSight()` currently only checks
  whether a wall is in the way -- no maximum distance at all, so a token can technically see
  the full length of an unlit corridor. Add an optional per-token `visionRange` (feet, sparse --
  absent means unlimited, matching every other sparse-field convention in `engine/encounter.js`)
  and fold a distance check into `hasLineOfSight`/`isVisibleToParty` alongside the existing wall
  check. Deliberately NOT a full lighting model (no per-cell bright/dim/dark state, no light
  sources) -- that's a much bigger feature; this is the same "flat distance limit, not RAW's full
  light-level nuance" simplification the rest of this feature set already uses. Token sheet gets
  a Vision Range field; SRD monsters with real darkvision (most humanoids' player-facing
  counterparts don't have it, but plenty of monsters do) could get one set in `STAT_BLOCKS`, same
  as `damageType` was backfilled per-monster in the damage-types phase -- worth doing at the same
  time rather than as a separate pass.
- [ ] **DM-bridge wall actions.** There is currently no way for Claude to draw or remove a wall
  -- `set_visibility` got a DM-bridge action alongside its UI toggle, walls didn't. Add
  `add_wall`/`remove_wall` (or a single `set_wall` with an add/remove mode) to `engine/dmBridge.js`
  and `dm-bridge/watch.js`'s `isValidAction`/`SYSTEM_PROMPT`, mirroring the existing pattern
  exactly. Lower value than vision range (walls are mostly a DM map-prep concern, not something
  narration dynamically changes mid-session -- "a section of wall collapses" is the realistic use
  case), which is why it's second in this phase, not first.

## Phase 7 -- Finish AoE templates (medium)

- [ ] **Cone and line template shapes.** The AoE template tool only draws a circle today
  (`renderTemplateOverlay()` in `ui/app.js`) -- cone (Burning Hands, a dragon's breath) and line
  (Lightning Bolt) are common enough spell shapes to be worth the same treatment. Needs real
  shape math (a cone needs an origin + direction + angle; a line needs an origin + direction +
  length/width) and a UI decision for how the DM sets direction/angle (drag-to-aim is the natural
  extension of the existing click-to-place-radius interaction). Circle was deliberately built
  first and scoped to skip this -- see its own roadmap entry above.
- [ ] **AoE auto-target-detection.** Once a template shape exists on the grid (circle today,
  cone/line after the item above), compute which tokens fall inside it and feed that straight
  into `cast_area_spell`'s `targetIds` instead of the DM reading them off by eye. This was
  explicitly scoped out when the circle template shipped ("doesn't need to feed targetIds
  automatically at first... even just 'show me the circle so I can pick targets by eye' is the
  real win") -- worth doing now that the shape math from the item above will exist anyway, since
  "is this token's cell inside the shape" is most of what target-detection needs.

## Phase 8 -- Save/session ergonomics (small-medium)

- [ ] **Multiple save slots / named encounters.** The original Phase 0 item, deferred at the
  time ("decide after using export/import for a while -- may turn out unnecessary"). Revisit now:
  does the single implicit autosave + manual Export/Import actually cover real usage, or does
  running more than one encounter/campaign in the same browser profile want real named local
  slots (still `localStorage`, just multiple keys instead of one fixed `storageKey`)? If it does,
  this needs a small slot-picker UI (list, rename, delete, switch) alongside the existing
  Save/Load/Export/Import row.

## Phase 9 -- Cleanup (small, no new user-facing capability)

- [ ] **Token art dedup.** Flagged in README's "Possible Next Steps" since before this whole
  work-plan pass started. Every monster spawned from the same Token Library entry copies the same
  image bytes into IndexedDB again rather than sharing one record -- fine at IndexedDB's storage
  scale for a normal session, but worth fixing if it ever actually causes a problem. Lowest
  priority here on purpose: it's real technical debt, but it doesn't add anything a DM would
  notice at the table, unlike everything above it.

## Phase 10 -- Large, speculative features (needs a scoping conversation before starting)

Both of these are big enough, and open-ended enough, that they deserve the same
"decide-before-building" treatment Phase 5 got -- don't start either from this bullet list alone.

- [ ] **Player-editable character sheets.** `character.html` is currently a read-only DM-side
  viewer opened from an imported sheet. Making it genuinely player-editable raises real questions
  this roadmap hasn't answered yet: who has access (only via the DM's machine, or should the
  player window -- Phase 5 -- expose an edit path)? Where do edits actually go (the campaign
  repo's markdown directly? A separate persisted layer)? Is this even the right layer for it, given
  campaign markdown is otherwise DM/Claude-authored? Needs a real design conversation, not just an
  implementation pass.
- [ ] **Audio/ambience/music layer.** No existing precedent anywhere in this codebase to extend
  -- would be a wholly new subsystem: an asset-management layer for audio files (something like
  the Token/Map Library's IndexedDB pattern, or a folder connection like Tokens/Maps Folder),
  playback controls, and a decision about scope (looping ambience per map? one-shot stingers?
  music tied to combat state?). The most speculative, highest-effort item on this whole list --
  last for a reason.
