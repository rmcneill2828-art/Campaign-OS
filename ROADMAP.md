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

Phase 10 still open (both items need the scoping conversation before starting) -- not resolved by
the review below.

---

# Work plan: what's next (2026-08-22 review)

Full-project review after a ~2.5 week gap (last commit fa64982, 2026-08-04). Health check first:
347/347 tests passing, CI green on every commit since Phase 9, zero open issues/PRs, working tree
clean, zero TODO/FIXME markers left in source. A subagent cross-checked the codebase against every
non-obvious convention CLAUDE.md documents (effectiveSpeed() usage, deleteTokenImageIfUnshared(),
escapeHtml() coverage on every innerHTML site, applyDamage()'s {state, message} shape, the four
duplicated lookup lists between engine/encounter.js and dm-bridge/watch.js) plus a fresh
accessibility/error-handling/dead-code pass -- zero convention violations found, which is the real
headline: nothing has drifted since the last pass. What follows is organized the same way the
2026-08-03 work plan was -- cheap/high-value first, speculative last.

## Phase 11 -- Data safety (small, high-value, addresses a real risk that's been quietly growing)

- [x] **Token Library / Map Library export/import.** Done 2026-08-22. New Export/Import controls
  next to each library's existing Clear All button (`index.html`, wired in `ui/app.js`). Export
  bundles every entry's metadata AND image bytes (the already-stored data URL, not just a
  reference to it) into one self-contained `.json` file -- `campaign-os-token-library-<date>.json`
  / `campaign-os-map-library-<date>.json` -- via `CampaignOSTokenLibrary.listEntries()` +
  `getImage()` / `CampaignOSMapLibrary`'s equivalents, same download-a-Blob pattern the existing
  Encounter Export button already uses. Import reads the file back through the exact same
  `saveEntry()` every other add path (manual upload, folder connect) already uses, so a restored
  entry gets the same normalized key an upload would. Deliberately a **merge** (overwrite only an
  imported name that collides with an existing one), not a wipe-then-replace like Encounter
  Import -- restoring a library is meant to fill it back in, not risk losing whatever's already
  there if the wrong file gets picked; verified this explicitly (seed a local-only entry, import a
  file that doesn't mention it, confirm it survives untouched alongside the imported ones).
  Malformed JSON and well-formed-but-wrong-shape JSON (e.g. an Encounter export fed into the
  library importer) both fail cleanly with a "not a valid ... library file" message and leave the
  library completely unchanged, matching Encounter Import's own "degrade safely" convention rather
  than inventing a new one. No engine change -- `ui/app.js`/`index.html`/`ui/styles.css` only.
  Verified with a one-off Playwright script (seed both libraries -> export each -> Clear All ->
  import each back through the real file input -> images and aspect ratios match; merge-not-wipe
  semantics; both bad-file cases) rather than the committed suite, per this repo's existing
  UI-testing convention -- 347/347 existing tests still pass, untouched by this change.

Phase 11 complete.

## Phase 12 -- Small fixes surfaced by this review (self-contained, no design decisions needed)

- [x] **DM-bridge disconnect is silent.** Done 2026-08-22. New `handleDMBridgeAccessLost()`
  (`ui/app.js`) -- both `checkDMBridgeResponse()`'s and `checkLiveActions()`'s catch blocks now
  check specifically for `err.name === "NotAllowedError"` (a revoked/lost File System Access
  permission, as opposed to the transient read hiccups those catches already tolerated and still
  do) and, on that specific error, clear `dmBridgeDirHandle`, stop both poll timers
  (`dmBridgePollTimer`/`liveActionsPollTimer`), clear any pending request timeout, and flip
  `dmBridgeStatus` to `Connection to "<name>" was lost -- click Connect to re-grant access.`
  (removing the `.connected` class) -- the same recovery message `tryRestoreDMBridge()` already
  shows for a startup permission that needs re-confirming, so there's one message to know, not
  two. Verified with a one-off Playwright script using an OPFS directory as a same-interface
  stand-in for a picked folder (same technique the Live-session control contract section already
  documents), with `getFileHandle()` patched to throw `NotAllowedError` on demand to simulate a
  revoked permission -- confirmed the status flips within one poll cycle, and that un-revoking
  afterward does NOT resume anything (proving the timers were actually cleared, not just failing
  silently and retrying). OPFS doesn't work under a plain `file://` origin in Chromium (throws a
  SecurityError), so this one script specifically ran against a throwaway local static server
  instead of the usual `file://` verification -- the app itself is unaffected either way.
- [x] **Keyboard activation of a map tile doesn't move the token to the right cell.** Done
  2026-08-22. `handleMapClick()` now checks `event.target.closest(".map-tile")` first and, when
  the click actually targeted a tile, reads `x`/`y` straight off that tile's own `dataset`
  (already set when tiles are built) instead of always going through `gridCellFromEvent()`'s pixel
  math -- a keyboard-triggered click (Enter/Space on a focused tile button) reports
  `clientX`/`clientY` as 0, which the pixel math would silently resolve to the wrong cell (usually
  (1,1)) for. `gridCellFromEvent()` itself is untouched (still used for the ruler/template drag
  paths, and as the fallback here for any click that didn't land on a tile's own button), so pixel
  math is only bypassed exactly where a real, discrete tile identity is already known. Verified
  with Playwright: focusing a specific off-origin tile and pressing Enter moves the token to that
  exact cell (previously would not have); a real mouse click on a different tile still lands
  correctly too (regression check).
- [x] **Toggle buttons don't expose pressed state.** Done 2026-08-22. Ruler/Template/Walls/Adjust
  Grid (all mode toggles, `active-toggle` CSS class already existed) now also set `aria-pressed`
  alongside it. Map Settings is a disclosure toggle (shows/hides `mapToolbarSecondary`), not a
  mode -- it got `aria-expanded`/`aria-controls` instead, the ARIA-correct pairing for that
  pattern rather than reusing `aria-pressed` for something it doesn't quite mean. Verified with
  Playwright: each attribute flips true/false correctly across on -> off, not just a one-way stamp.
- [x] **Disabled-button text contrast is low.** Done 2026-08-22. The original `opacity: 0.45` on
  `button:disabled` computed to roughly 3.1:1 against `--panel-strong` (the worst-case surface a
  disabled button sits on), under WCAG AA's 4.5:1 normal-text threshold -- WCAG doesn't actually
  require disabled controls to meet that, but this app is meant to be read fast at a real table,
  so legibility still matters here regardless. Recomputed: 0.75 puts `--muted` right at ~4.5:1
  against that same surface while staying visually distinct from an enabled button (no hover
  glow/lift, `cursor: not-allowed`, and `--muted` is already dimmer than `--text`). Verified via
  Playwright's `getComputedStyle()` against a real disabled button rather than eyeballing it.

Phase 12 complete.

## Phase 13 -- Monster compendium expansion (medium, ongoing -- not a one-shot item)

- [x] **First batch: 8 monsters added, 2026-08-22 (16 -> 24).** `STAT_BLOCKS` in
  `engine/encounter.js` (mirrored in `dm-bridge/watch.js`'s `MONSTER_LIST` and
  `monsterPattern`'s spawn-phrasing regex) gained `brown bear`, `dire wolf`, `bugbear`,
  `hobgoblin`, `gnoll`, `specter`, `imp`, `veteran` -- picked to fill real gaps rather than as
  a bulk dump: a raider tier above goblin/orc (bugbear/hobgoblin/gnoll), the first incorporeal
  undead (specter -- skeleton/zombie/ghoul were all corporeal), a low-tier fiend distinct from
  Malphestor's own custom-authored NPC sheet (imp), a generic elite humanoid NPC (veteran, the
  natural step up from guard/cultist/priest), and the first beast-type entries at all
  (brown bear/dire wolf -- also thematically relevant to this campaign's bear-kin/bear-spirit
  motif per the paired DnD repo's session log). Source: the System Reference Document PDF at
  `I:\DND\Core Rulebooks\SRD` (not the full Monster Manual -- SRD content matches the existing
  16's own license tier, so nothing about this batch changes what license class `STAT_BLOCKS`
  draws from). Extraction method worth recording: this PDF's two-column layout badly scrambles
  `pdftotext -layout`'s column-interleaved output (numbers from unrelated stat blocks end up on
  the same line) -- `pdftotext -raw` instead preserves the PDF's real content-stream reading
  order and came out clean and directly transcribable; page numbers were found reliably by
  building an index from every line matching a size+type header (`Large beast`, `Medium
  humanoid`, etc.) rather than trusting a plain name search, since several names are also
  narrative-mentioned elsewhere in the document (a Wild Shape example, a class feature) on
  pages that aren't the real stat block at all. Each entry got a smoke-tested spawn (values
  compared 1:1 against the transcribed SRD text) plus a unit test for each new mechanical shape
  introduced (multi-word name, Multiattack, resistances/immunities) -- not one test per monster,
  matching this suite's existing density. Unmodeled riders (Imp's Sting poison-on-save, Specter's
  Incorporeal Movement/Sunlight Sensitivity, Veteran's optional third Shortsword attack) are
  commented in place, same "known gap, apply by hand" convention as Ghoul's paralysis rider.
- [ ] **Next batches, as actually needed for upcoming sessions** -- this item is intentionally
  never "done": pull the next few monsters from the SRD (or, once SRD coverage is exhausted for
  something the campaign needs, the full Monster Manual/Volo's Guide/Tome of Foes also in
  `I:\DND`) when a real encounter calls for something not yet in `STAT_BLOCKS`, verified against
  a real page the same way as above -- not a bulk import in one pass, which would turn into a
  large, hard-to-review dump. A DM-authored custom-monster path (JSON add-on, no source-code
  edit) is still worth doing separately for anything genuinely homebrew that won't be in any of
  those books.

## Phase 14 -- Encounter difficulty / XP-budget calculator (medium)

- [x] Done 2026-08-22. New **Encounter Difficulty** panel (`index.html`, right after
  Initiative -- a live-board panel, not a Setup-tab one; it reads the current map's tokens
  directly, so it belongs next to the other combat-state panels) implements the DMG's
  actual "Evaluating Encounter Difficulty" procedure (Chapter 3) exactly, not a looser
  approximation -- the open design question the roadmap note above had left unresolved.
  Both reference tables (XP Thresholds by Character Level, Encounter Multipliers +
  the Party Size adjustment) were transcribed directly from the Dungeon Master's Guide PDF
  at `I:\DND\Core Rulebooks` rather than trusted from memory. `engine/encounter.js` gained
  `XP_THRESHOLDS_BY_LEVEL`, `encounterMultiplier()`, and the actual query,
  `evaluateEncounterDifficulty(state)` -- a pure, read-only function (same shape as
  `effectiveSpeed()`/`damageTypeModifier()`, not a `{state, message}` mutator) that: reads
  hero-type tokens on the active map as the party, deriving each one's character level from
  the sum of its Hit Dice pool (one Hit Die per level is a fixed 5e rule regardless of class
  or multiclass split, so this needs no new extraction -- falls back to level 1 for a hero
  token with no Hit Dice pool at all, a documented simplification rather than a guess);
  reads monster-type tokens as the encounter, looking each one's XP up in `STAT_BLOCKS`
  (which gained a real `xp` field per monster, also page-checked against the SRD, for all
  24 entries) by the same trailing-instance-number-stripped name spawnMonster's own
  baseName uses -- a monster token that isn't a recognized name (an imported NPC, a
  hand-renamed token) is reported separately as "not counted," never guessed at; both dead
  heroes and dead monsters are excluded from the count entirely. Verified two ways: the
  DMG's own worked example from the book text itself (one bugbear + three hobgoblins
  against three 3rd-level characters and one 2nd-level character = Hard, adjusted XP 1,000
  against an 825/1,400 hard/deadly threshold) is reproduced exactly as a unit test, and a
  live Playwright pass drove the real UI end to end (empty state, adding heroes via Quick
  Add Token, spawning monsters via the command box, an unrecognized monster token
  correctly reported as uncounted). 6 new unit tests (357 total).

Phase 14 complete.

## Known, deliberately-deferred gaps (unchanged by this review -- already documented honestly)

Re-confirmed still open, still low-priority, still intentional: Charmed/Frightened remain tag-only
(need a tracked "source" token this engine doesn't model), a ghoul's paralyze/a giant spider's
poison/a zombie's Undead Fortitude riders aren't automated, exhaustion level 4's halved HP max
isn't applied automatically, and Blinded doesn't auto-fail a sight-dependent check. None of these
block real play -- same "handle it by hand" spirit as Troll's Regeneration before it got wired up.
Not promoted to a phase above; revisit only if one of them causes real friction at the table.
