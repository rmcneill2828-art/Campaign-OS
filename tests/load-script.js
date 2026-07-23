const fs = require("node:fs");
const path = require("node:path");

// engine/*.js are plain browser scripts that attach their public API to `window`
// (e.g. `window.CampaignOS = {...}`) rather than using module.exports, so the app
// can load them with a plain <script> tag and no build step. To unit test them in
// Node without changing that, compile the file's source with `window`/`console`
// as parameters and run it in *this* realm (not a separate vm context) -- a vm
// sandbox's arrays/objects come from a different realm than the test file's, which
// makes assert.deepStrictEqual report false negatives on otherwise-identical values.
function loadScript(relativePath) {
  return loadScriptsInto({}, [relativePath]);
}

// Loads multiple scripts into one shared `window` object, in order -- needed when a
// script references another's exports (e.g. dmBridge.js calls window.CampaignOS.*
// from encounter.js). Returns the shared window with everything attached.
function loadScriptsInto(window, relativePaths) {
  relativePaths.forEach((relativePath) => {
    const filePath = path.join(__dirname, "..", relativePath);
    const code = fs.readFileSync(filePath, "utf8");
    const run = new Function("window", "console", code);
    run(window, console);
  });
  return window;
}

module.exports = { loadScript, loadScriptsInto };
