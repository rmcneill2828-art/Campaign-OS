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
    let index = 0;

    function closeList() {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
    }

    while (index < lines.length) {
      const line = lines[index];

      if (isTableRow(line) && isSeparatorRow(lines[index + 1] || "")) {
        closeList();
        html.push(renderTable(lines, index));
        index = tableEnd(lines, index);
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        if (!listOpen) {
          html.push("<ul>");
          listOpen = true;
        }
        html.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
        index += 1;
        continue;
      }

      closeList();

      if (/^###\s+/.test(line)) html.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`);
      else if (/^##\s+/.test(line)) html.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
      else if (/^#\s+/.test(line)) html.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`);
      else if (line.trim()) html.push(`<p>${inline(line)}</p>`);

      index += 1;
    }

    closeList();
    return html.join("");
  }

  function isTableRow(line) {
    return typeof line === "string" && line.includes("|") && line.trim().length > 0;
  }

  function isSeparatorRow(line) {
    if (!isTableRow(line)) return false;
    const cells = splitTableRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
  }

  function splitTableRow(line) {
    let trimmed = line.trim();
    if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
    if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
    return trimmed.split("|").map((cell) => cell.trim());
  }

  function tableEnd(lines, start) {
    let index = start + 2;
    while (index < lines.length && isTableRow(lines[index]) && !isSeparatorRow(lines[index])) {
      index += 1;
    }
    return index;
  }

  function renderTable(lines, start) {
    const headerCells = splitTableRow(lines[start]);
    const bodyRows = [];
    for (let index = start + 2; index < tableEnd(lines, start); index += 1) {
      bodyRows.push(splitTableRow(lines[index]));
    }

    const head = `<thead><tr>${headerCells.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`;
    const body = bodyRows.length
      ? `<tbody>${bodyRows.map((cells) => `<tr>${cells.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`
      : "";
    return `<table>${head}${body}</table>`;
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
