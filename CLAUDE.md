# Campaign OS

AI-native tabletop VTT companion to the DnD campaign repo at
https://github.com/rmcneill2828-art/DnD (locally, commonly checked out alongside this repo).
Campaign-OS imports campaign Markdown for characters, locations, and sessions; the DnD repo
remains the narrative source of truth.

See README.md for the full feature list and usage. Notes specific to working on this code:

## Architecture
- `engine/` -- pure, DOM-free logic (encounter state, campaign markdown parsing, the dm-bridge
  action dispatcher). Runnable and unit-tested under Node (`npm test`). Keep it that way: no
  `document`/`window` DOM access, no async IndexedDB/File System Access calls here -- those
  belong in `ui/`.
- `ui/` -- browser glue: rendering, event wiring, and the IndexedDB-backed stores
  (`imageStore.js`, `tokenLibrary.js`, `dmBridgeStore.js`).
- `dm-bridge/watch.js` -- a Node script, run separately (`node dm-bridge/watch.js`), that bridges
  the browser to the local `claude` CLI. Two independent request/response file pairs:
  `request.json`/`response.json` for live combat narration (tools disabled, strict JSON reply),
  and `end-session-request.json`/`end-session-response.json` for the write-back into the DnD
  repo (real Read/Write/Edit access, scoped via `DND_REPO_PATH`, never git).

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
- The write-back (End Session) never runs git and never commits/pushes to the DnD repo, on
  purpose -- it only edits files. Don't add auto-commit behavior without the user asking for it.

## Testing
`npm test` (zero dependencies, Node's built-in `node:test`) covers `engine/*.js` and the
name-matching logic in `ui/tokenLibrary.js`. Runs in CI on push/PR to `main`. UI-only behavior
(File System Access API, IndexedDB round trips, DOM rendering) is verified with Playwright during
development rather than as part of the committed suite -- there's no headless picker API, so
these use OPFS as a same-interface stand-in for a picked folder.
