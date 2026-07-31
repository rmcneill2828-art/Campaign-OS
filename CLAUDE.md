# Campaign OS

AI-native tabletop VTT companion to the DnD campaign repo at
https://github.com/rmcneill2828-art/DnD (locally, commonly checked out alongside this repo).
Campaign-OS imports campaign Markdown for characters, locations, and sessions; the DnD repo
remains the narrative source of truth. As of 2026-07-23 this isn't used for live play yet --
see that repo's own CLAUDE.md for why (short version: no ability scores/saves/spellcasting/
class-resource modeling until recently, still no spellcasting or class resources at all).

See README.md for the full feature list and usage. Notes specific to working on this code:

## Architecture
- `engine/` -- pure, DOM-free logic: `encounter.js` (state, tokens, combat, movement, turn
  order, saving throws), `campaign.js` (markdown import/parsing), `dmBridge.js` (translates the
  Claude DM bridge's actions into engine calls), `characterCreator.js` (5e math + markdown
  generation for new character sheets). Runnable and unit-tested under Node (`npm test`). Keep
  it that way: no `document`/`window` DOM access, no async IndexedDB/File System Access calls
  here -- those belong in `ui/`.
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
  seen the logged result. Don't write system-prompt guidance that implies otherwise.
- A token's `abilityScores` object is intentionally sparse (only the abilities actually known
  are present) and `savingThrows` is a sparse *override* map, not a computed value --
  `engine/campaign.js`'s `extractSavingThrows` reads a real sheet's stated bonus (e.g.
  "Wisdom +6 (Resilient, lvl Fighter 4)") literally rather than recomputing modifier +
  proficiency, since real sheets accumulate feats/multiclass bumps a flat formula can't
  reproduce. `engine/encounter.js`'s `savingThrowBonus()` prefers the stated override, falling
  back to the raw ability modifier, falling back to 0.

## Testing
`npm test` (zero dependencies, Node's built-in `node:test`) covers `engine/*.js` and the pure
(non-IndexedDB, non-File-System-Access) logic in `ui/tokenLibrary.js`, `ui/mapLibrary.js`, and
`ui/folderAssets.js`. Runs in CI on push/PR to `main`. UI-only behavior (File System Access API,
IndexedDB round trips, DOM rendering) is verified with Playwright during development rather
than as part of the committed suite -- there's no headless picker API, so these use OPFS as a
same-interface stand-in for a picked folder.
