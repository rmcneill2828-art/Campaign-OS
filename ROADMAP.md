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
- [ ] **Standalone ruler/measure tool.** Let the DM measure grid distance without committing to a
  token move -- e.g. click-drag on the map that shows live ft (using the map's feet-per-square
  scale and the existing alternating-diagonal cost logic) and clears on release. Mostly
  `ui/app.js` map-click handling; can reuse the diagonal-movement math already in
  `engine/encounter.js` rather than duplicating it.
- [ ] **AoE templates (cone/line/circle/cube).** A drawable overlay on the grid to help decide
  which tokens fall inside a spell's area before calling `cast_area_spell` -- circle first
  (simplest: radius from a click point), cone/line after. Purely a UI/visual aid; doesn't need to
  feed `targetIds` automatically at first (that's a nice-to-have follow-up once the shape math
  exists) -- even just "show me the circle so I can pick targets by eye" is the real win.
- [ ] **Undo (single-level, or a short history stack).** `resetEncounter` is currently the only
  way to back out of a mistake, and it nukes everything. Snapshot `state` before each mutating
  action (cheap -- it's already a plain JSON-serializable object) and add an "Undo" button that
  restores the last snapshot. Start with depth 1 before building a full stack; check whether that
  alone covers real usage before investing more.

## Phase 2 -- Rules depth

- [ ] **Damage types.** The highest-leverage rules gap: nothing in the engine tracks damage type,
  so resistance/vulnerability/immunity can't work at all. Needs: a `damageType` field on attack
  profiles/spells (stat blocks in `encounter.js`'s `STAT_BLOCKS`, `characterCreator.js`'s
  generated attack, `cast_spell`/`cast_area_spell`'s dmBridge actions), a token-level
  `resistances`/`vulnerabilities`/`immunities` set, and a damage-modifier step in `applyDamage()`.
  This is the biggest single item in this phase -- touches `engine/encounter.js`,
  `engine/campaign.js` (import), `engine/dmBridge.js` (action shape), `dm-bridge/watch.js`
  (system prompt), and the token sheet UI. Re-read the `applyDamage()` CLAUDE.md bullet before
  starting; its `{state, message}` return shape and every call site matter here.
- [ ] **Reactions / opportunity attacks.** Needs a "left this token's reach" trigger, which the
  engine currently has no notion of (movement is just a speed budget, not adjacency-tracked over
  a path). Design the trigger detection before writing the action -- this is more of an
  open design question than a mechanical one.

## Phase 3 -- Real fog of war

Current "fog" (`toggleFog`) is cosmetic only -- a CSS `nth-child` pattern in `ui/styles.css`, not
tied to grid position or vision. Replace with a real per-cell reveal state:
- [ ] Design the data shape: likely `state.fogTiles` per map, a sparse set/grid of revealed cells
  (same sparse-map convention the rest of the engine already uses).
  DM tools to reveal/hide tiles (paint, or reveal-around-token-radius).
- [ ] Rendering: only matters visually once there's a genuine player-facing view (see Phase 5) --
  as a DM-only tool without a separate player screen, real fog of war has limited value beyond
  "hide it from myself," so consider sequencing this after Phase 5 starts, not before.

## Phase 4 -- Line of sight / vision blocking

No walls, no vision radius, no occlusion anywhere in the engine today. This is a bigger lift than
fog of war (needs wall geometry against the grid, and a visibility algorithm) and its payoff is
also mostly about the player-facing view. Sequence after Phase 5 is scoped, for the same reason
as fog of war above -- don't build vision math with no second viewport to make it matter yet.

## Phase 5 -- Shared/player view (biggest architectural decision on this list)

Everything today lives in one browser tab's local storage -- there is no second client, no
server, no way for players to see the board themselves. This is the one item that changes what
kind of tool Campaign OS *is* (single-DM tactical tracker vs. a real shared-table VTT), so it's
worth a deliberate go/no-go conversation rather than just starting:
- [ ] Decide scope first: a read-only "player window" (second browser tab/window on the same
  machine, synced via `BroadcastChannel`/`localStorage` events -- no server needed, much smaller
  lift) vs. real multi-device multiplayer (needs a server or a sync service, a much bigger
  architecture change touching almost everything). Don't start building until this is picked.
- [ ] If read-only same-machine player window: likely the highest-value, lowest-effort version of
  "shared view" available, and a natural prerequisite for Phase 3/4 to actually matter.

## Smaller / lower-priority items (park here, revisit if they start to matter)

- [ ] Audio/ambience/music layer -- no existing precedent in this codebase, would be a new
  subsystem from scratch.
- [ ] Player-editable character sheets (`character.html` is currently a read-only DM-side viewer).
- [ ] Token art dedup -- already flagged in README's "Possible Next Steps"; each spawn from a
  library entry copies the same image bytes into IndexedDB again rather than sharing one record.
