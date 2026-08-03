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

- [x] **Vision radius / darkvision distance limit.** Done 2026-08-03. Optional per-token
  `visionRange` (feet, sparse -- absent means unlimited). New `cellVisibleToHero()` layers a
  `gridMoveCost`-based distance check (the same feet-per-square + alternating-diagonal measure
  the Ruler tool already uses) on top of `hasLineOfSight`'s wall check, consumed by both
  `isVisibleToParty` and `visibleCellsForParty` (so it feeds fog-of-war reveal too, not just
  token hiding). Caught a real design bug before shipping: a naive implementation let
  `visionRange` apply even on a wall-free map, breaking the "no walls = zero restriction"
  invariant this whole feature set depends on -- fixed by making `cellVisibleToHero` check for
  walls explicitly, rather than trusting `hasLineOfSight`'s own internal fast path to cover it
  (a unit test locks this in). New **Vision Range (ft)** field on the token sheet. Deliberately
  NOT a full lighting model (no per-cell bright/dim/dark state) -- a flat distance limit only.
  Skipped backfilling monster `STAT_BLOCKS` with darkvision as originally suggested here: only
  hero-type tokens' vision drives this system at all, so a monster's own vision range would be
  inert data, not a real gap. 6 new unit tests (341 total) plus a live Playwright pass setting
  Vision Range via the actual token sheet and confirming the player window responds.
- [x] **DM-bridge wall actions.** Done 2026-08-03. `add_wall`/`remove_wall_near` in
  `engine/dmBridge.js`, mirroring `set_visibility`'s pattern; `remove_wall_near` uses a wider
  0.75-grid-unit threshold than the UI's own 0.35, since Claude is estimating a coordinate from
  narration rather than clicking a pixel. `SYSTEM_PROMPT` explains the vertex-vs-cell coordinate
  distinction and warns against adding a wall just to "turn on" line of sight/fog of war --
  `buildPrompt()` now shows a per-map `Walls on this map: N` count (from a new `wallCount` field
  in `buildBridgeStateSnapshot()`, which feeds both the cold-start and live-session channels for
  free) so Claude can check before deciding. 1 new dmBridge test (342 total).

Phase 6 complete.

## Phase 7 -- Finish AoE templates (medium)

- [x] **Cone and line template shapes.** Done 2026-08-03. A **Shape** dropdown
  (Circle/Cone/Line) in the map toolbar. Circle keeps its original plain-click placement; Cone
  and Line need a click-drag instead (mousedown sets the origin, mousemove continuously updates
  the aim angle from live cursor position, matching the roadmap's own suggested "drag-to-aim"
  UX). Cone follows the SRD's literal geometry ("width at a given point equals that point's
  distance from the origin") -- a true triangle, not a circular sector/"pie slice." **Caught a
  real bug before shipping**: the first implementation tested distance-from-apex + a fixed
  angle constant, which describes a sector, a genuinely wider shape than the RAW triangle for
  any off-centerline point -- a unit test written against the RAW text directly caught the
  mismatch. Fixed with the same rotated-frame technique `pointInLine` already used. Also fixed
  a real, previously-shipped bug found along the way: `handleMapClick()` was missing a
  `wallsModeOn` guard, so clicking near a wall to delete it could also silently move whichever
  token was currently selected.
- [x] **AoE auto-target-detection.** Done 2026-08-03 (built alongside the item above, using its
  shape math directly). The template's label now lists every token currently inside the shape
  (e.g. "20 ft cone — Goblin 1, Goblin 2"), computed via new pure `engine/encounter.js`
  primitives (`pointInCircle`/`pointInCone`/`pointInLine`). Deliberately stops at "tell the DM
  who's covered," not "auto-fill `cast_area_spell`'s `targetIds`" -- the DM/Claude still issues
  the actual cast; this closes the "reading it off by eye" pain point without building a
  parallel casting UI that would mostly duplicate what typing the cast command already does.
  9 new unit tests (345 total) plus a full Playwright pass: circle regression check, cone/line
  placement and live target-detection through a real drag, shape-switch clearing stale
  placement, and the `wallsModeOn` bug fix. See CLAUDE.md's new "AoE templates" bullet for the
  full design writeup, including the sector-vs-triangle bug.

Phase 7 complete.

## Phase 8 -- Save/session ergonomics (small-medium)

- [x] **Multiple save slots / named encounters.** Decided 2026-08-03 (user decision): **skip
  it.** The original Phase 0 item, deferred at the time with a note that it "may turn out
  unnecessary" once Export/Import existed -- revisited now and confirmed: the single implicit
  autosave plus manual Export/Import already covers the real need, so the slot-picker UI (list,
  rename, delete, switch) this would have required isn't worth building. Revisit only if actual
  usage running multiple encounters/campaigns in one browser profile turns out to want it later.

Phase 8 complete (resolved by not building it).

## Phase 9 -- Cleanup (small, no new user-facing capability)

- [x] **Token art dedup.** Done 2026-08-03. `ui/imageStore.js`'s new `saveImageDeduped(dataUrl)`
  is content-addressed -- key = `"sha256-" + SHA-256(dataUrl)` (`crypto.subtle`, confirmed
  working under plain `file://`, not just `https://`, with a live Playwright check before
  relying on it) -- so identical bytes always land on the same IndexedDB record no matter how
  many times/tokens they get saved for. Used by `applyLibraryImages` (auto-attach at spawn) and
  `useTokenFolderEntry` (manual folder-file attach); three goblins spawned from the same Token
  Library entry now share one record instead of three. Falls back to a plain random-key save
  if `crypto.subtle` is ever unavailable. The real design work was on the OTHER end: a shared
  key can't be blindly deleted just because one token stopped using it (that would corrupt
  every other token still pointing at it) -- new `deleteTokenImageIfUnshared()` recognizes and
  skips any `"sha256-"`-prefixed key, now used at all three places a token's image can be
  replaced/cleared instead of calling `deleteImage()` directly. Deliberately scoped to just the
  two auto/library-sourced attach paths (what the original README item was actually about) --
  map images and a token sheet's own ad-hoc file upload stay undeduped, since maps are rarely
  identical and a one-off upload has no known "source" to dedupe against anyway. Verified both
  directions with Playwright: clearing one of three tokens sharing a deduped image leaves the
  other two intact and the record still present; clearing a genuinely unique image still
  actually deletes it. See CLAUDE.md's new "Token image dedup" bullet for the full writeup.

Phase 9 complete.

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
