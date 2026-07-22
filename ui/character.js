(function () {
  const campaignStorageKey = "campaign-os-campaign-import";
  const title = document.querySelector("#sheetTitle");
  const path = document.querySelector("#sheetPath");
  const sheet = document.querySelector("#characterSheet");
  const params = new URLSearchParams(window.location.search);
  const itemId = params.get("id");

  const campaign = loadCampaign();
  const item = campaign.files.find((candidate) => candidate.id === itemId);

  if (!item) {
    title.textContent = "Character Not Found";
    sheet.textContent = "Import the campaign again from the board, then open the character sheet from a character card.";
    return;
  }

  document.title = `${item.title} - Campaign OS`;
  title.textContent = item.title;
  path.textContent = item.path;
  sheet.innerHTML = renderMarkdown(item.text || item.summary || "No character content.");

  function loadCampaign() {
    const saved = localStorage.getItem(campaignStorageKey);
    if (!saved) return { files: [] };
    try {
      return JSON.parse(saved);
    } catch {
      return { files: [] };
    }
  }

  function renderMarkdown(markdown) {
    const lines = markdown.split(/\r?\n/);
    const html = [];
    let listOpen = false;

    lines.forEach((line) => {
      if (/^\s*[-*]\s+/.test(line)) {
        if (!listOpen) {
          html.push("<ul>");
          listOpen = true;
        }
        html.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
        return;
      }

      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }

      if (/^###\s+/.test(line)) html.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`);
      else if (/^##\s+/.test(line)) html.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
      else if (/^#\s+/.test(line)) html.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`);
      else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
    });

    if (listOpen) html.push("</ul>");
    return html.join("");
  }

  function inline(value) {
    return escapeHtml(value)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
