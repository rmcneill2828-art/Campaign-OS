(function () {
  // Shared HTML-escaping helper -- for any free-text content (a token name, a campaign item's
  // title/path, imported markdown) inserted via innerHTML rather than textContent. Previously
  // defined near-identically in three separate files (ui/app.js, ui/playerView.js,
  // ui/character.js); consolidated here so there's exactly one place to get this right, after
  // one of those three copies (ui/app.js's own initiative-list render) turned out to have
  // skipped calling it entirely -- see CLAUDE.md for the full story. `value ?? ""` (not a bare
  // `String(value)`) is playerView.js's own, slightly more defensive original: a missing field
  // renders as nothing rather than the literal text "undefined"/"null".
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  window.CampaignOSDom = { escapeHtml };
})();
