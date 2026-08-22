(function () {
  // Must be assigned before any code below runs, not just before its own first use --
  // unlike the `function escapeHtml() {...}` this replaced, a `const` isn't hoisted with its
  // value, only its binding (TDZ): sheet.innerHTML = renderMarkdown(...) a few lines down
  // calls this (via inline()) as soon as the IIFE executes, well before this file's own
  // function declarations further down are ever invoked.
  const escapeHtml = window.CampaignOSDom.escapeHtml;
  // Same TDZ reasoning as escapeHtml just above -- setUpHpEditor() (a `function`,
  // fully hoisted) is called a few lines down, before this file's own textual position
  // for the HP-editor block further below, but it references this `const` immediately
  // when called, so it has to already be initialized by then too.
  const HP_LINE_PATTERN = /^(\s*(?:[-*]\s*)?\*{0,2}HP\s*:\s*\*{0,2}\s*)(-?\d+)(\s*\/\s*)(-?\d+)(\s*)$/im;
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

  // Player-editable HP (Phase 10, 2026-08-22): deliberately narrow -- see
  // dm-bridge/watch.js's own block comment for why only this one field, on this one
  // section, of a real character sheet is safe to patch by regex rather than a full
  // editor. NPCs (npcs/ sheets) don't get this -- this is a PLAYER's own sheet.
  const isNpc = /(^|[\\/])npcs?[\\/]/i.test(item.path || "");
  if (!isNpc) setUpHpEditor(item);

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

  // --- Player-editable HP -----------------------------------------------------------
  // HP_LINE_PATTERN itself lives up top next to escapeHtml (TDZ -- see that comment);
  // same value dm-bridge/watch.js's own HP_LINE_PATTERN uses (duplicated, not shared --
  // no bundler between this file and the Node script, same convention
  // MONSTER_LIST/CONDITION_LIST/DAMAGE_TYPE_LIST already accept elsewhere in this
  // codebase): closing ** falls AFTER the colon in this campaign's real files
  // ("- **HP:** 182 / 182"), confirmed against actual character sheets, not assumed.

  function findCombatHpLine(text) {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => /^##\s+combat\b/i.test(line.trim()));
    if (start === -1) return null;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index])) {
        end = index;
        break;
      }
    }
    const offset = lines.slice(start, end).findIndex((line) => HP_LINE_PATTERN.test(line));
    if (offset === -1) return null;
    const lineIndex = start + offset;
    const match = lines[lineIndex].match(HP_LINE_PATTERN);
    return { lineIndex, hp: Number(match[2]), maxHp: Number(match[4]) };
  }

  function setUpHpEditor(item) {
    const hpMatch = findCombatHpLine(item.text || "");
    if (!hpMatch) return; // no "## Combat" / "**HP:**" line found -- nothing to edit here

    const editor = document.querySelector("#hpEditor");
    const currentInput = document.querySelector("#hpEditorCurrent");
    const maxInput = document.querySelector("#hpEditorMax");
    const saveButton = document.querySelector("#hpEditorSave");
    const connectButton = document.querySelector("#hpEditorConnect");
    const status = document.querySelector("#hpEditorStatus");

    editor.hidden = false;
    currentInput.value = hpMatch.hp;
    maxInput.value = hpMatch.maxHp;

    const fileName = item.path.split(/[\\/]/).pop();

    // A minimal, independent DM-bridge connection -- character.html is its own page, not
    // part of index.html's app.js scope, so this can't reuse app.js's own dmBridgeDirHandle
    // or read/write helpers directly. Reuses the SAME saved folder handle (ui/dmBridgeStore.js,
    // same IndexedDB store) index.html already created, so a DM who's connected there once
    // doesn't need to pick the dm-bridge/ folder again here -- just re-grant the permission
    // prompt, same restore pattern app.js's tryRestoreDMBridge() already uses.
    let dirHandle = null;
    let pendingId = null;
    let pollTimer = null;
    let timeoutHandle = null;

    async function readBridgeJson(name) {
      let fileHandle;
      try {
        fileHandle = await dirHandle.getFileHandle(name);
      } catch (err) {
        if (err.name === "NotFoundError") return null;
        throw err;
      }
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (!text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    async function writeBridgeJson(name, obj) {
      const fileHandle = await dirHandle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(obj, null, 2));
      await writable.close();
    }

    function setConnected(handle) {
      dirHandle = handle;
      connectButton.hidden = true;
      status.textContent = `Connected to "${handle.name}".`;
    }

    async function tryRestoreConnection() {
      if (!window.showDirectoryPicker) return;
      const handle = await window.CampaignOSDMBridgeStore.loadHandle().catch(() => null);
      if (!handle) {
        connectButton.hidden = false;
        status.textContent = "Not connected -- Save needs the DM bridge folder to write to the campaign repo.";
        return;
      }
      const permission = await handle.queryPermission({ mode: "readwrite" }).catch(() => "denied");
      if (permission === "granted") {
        setConnected(handle);
      } else {
        connectButton.hidden = false;
        status.textContent = `Previously connected to "${handle.name}" -- click Connect to re-grant access.`;
      }
    }

    connectButton.addEventListener("click", async () => {
      if (!window.showDirectoryPicker) {
        status.textContent = "Not supported in this browser -- use Chrome or Edge.";
        return;
      }
      try {
        let handle = await window.CampaignOSDMBridgeStore.loadHandle().catch(() => null);
        if (handle) {
          const permission = await handle.requestPermission({ mode: "readwrite" }).catch(() => "denied");
          if (permission !== "granted") handle = null;
        }
        if (!handle) {
          handle = await window.showDirectoryPicker({ id: "campaign-os-dm-bridge" });
          await window.CampaignOSDMBridgeStore.saveHandle(handle);
        }
        setConnected(handle);
      } catch (err) {
        if (err.name !== "AbortError") status.textContent = `Connection failed: ${err.message}`;
      }
    });

    async function checkResponse() {
      if (!dirHandle || !pendingId) return;
      let response;
      try {
        response = await readBridgeJson("update-character-response.json");
      } catch {
        return;
      }
      if (!response || response.id !== pendingId) return;

      clearTimeout(timeoutHandle);
      pendingId = null;
      saveButton.disabled = false;
      status.textContent = response.message || (response.ok ? "Saved." : "Something went wrong.");
      if (response.ok) {
        // Reflect the save immediately in this page's own rendered sheet and cached
        // campaign copy, rather than telling the DM to re-import to see it (unlike Create
        // Character, this edited an existing file in place -- the text is already known).
        const lines = (item.text || "").split(/\r?\n/);
        const found = findCombatHpLine(item.text || "");
        if (found) {
          lines[found.lineIndex] = lines[found.lineIndex].replace(HP_LINE_PATTERN, (full, prefix, oldHp, sep, oldMax, suffix) =>
            `${prefix}${currentInput.value}${sep}${maxInput.value}${suffix}`
          );
          item.text = lines.join("\n");
          sheet.innerHTML = renderMarkdown(item.text);
          const savedCampaign = loadCampaign();
          const savedItem = savedCampaign.files.find((candidate) => candidate.id === item.id);
          if (savedItem) {
            savedItem.text = item.text;
            localStorage.setItem(campaignStorageKey, JSON.stringify(savedCampaign));
          }
        }
      }
    }

    saveButton.addEventListener("click", async () => {
      const hp = Number(currentInput.value);
      const maxHp = Number(maxInput.value);
      if (!Number.isFinite(hp) || !Number.isFinite(maxHp)) {
        status.textContent = "Current and max HP must both be numbers.";
        return;
      }
      if (!dirHandle) {
        status.textContent = "Connect to Claude Code first -- HP is saved through the same DM bridge folder as Create Character.";
        return;
      }

      const id = `hp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        await writeBridgeJson("update-character-request.json", { id, fileName, hp, maxHp });
      } catch (err) {
        status.textContent = `Could not write to the DM bridge folder: ${err.message}`;
        return;
      }

      pendingId = id;
      saveButton.disabled = true;
      status.textContent = "Saving...";
      if (!pollTimer) pollTimer = setInterval(checkResponse, 1500);

      clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => {
        if (pendingId !== id) return;
        pendingId = null;
        saveButton.disabled = false;
        status.textContent = "No response after 20s -- make sure `node dm-bridge/watch.js` is running, then try again.";
      }, 20000);
    });

    tryRestoreConnection();
  }
})();
