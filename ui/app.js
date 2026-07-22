(function () {
  const storageKey = "campaign-os-encounter-state";
  const campaignStorageKey = "campaign-os-campaign-import";
  const preferencesStorageKey = "campaign-os-preferences";
  const map = document.querySelector("#battleMap");
  const initiativeList = document.querySelector("#initiativeList");
  const tokenSheet = document.querySelector("#tokenSheet");
  const combatLog = document.querySelector("#combatLog");
  const campaignImport = document.querySelector("#campaignImport");
  const campaignSearch = document.querySelector("#campaignSearch");
  const campaignFilter = document.querySelector("#campaignFilter");
  const showTemplates = document.querySelector("#showTemplates");
  const campaignSummary = document.querySelector("#campaignSummary");
  const campaignDetail = document.querySelector("#campaignDetail");
  const campaignBrowser = document.querySelector("#campaignBrowser");
  const commandForm = document.querySelector("#commandForm");
  const commandInput = document.querySelector("#commandInput");
  const commandResult = document.querySelector("#commandResult");
  const mapSelect = document.querySelector("#mapSelect");
  const mapImageInput = document.querySelector("#mapImageInput");
  const gridColumns = document.querySelector("#gridColumns");
  const gridRows = document.querySelector("#gridRows");
  const showGrid = document.querySelector("#showGrid");
  const gridOpacity = document.querySelector("#gridOpacity");
  const mapFitMode = document.querySelector("#mapFitMode");
  const tokenSize = document.querySelector("#tokenSize");
  const toggleFog = document.querySelector("#toggleFog");

  let preferences = loadPreferences();
  let state = loadEncounter();
  let campaign = loadCampaign();
  let selectedCampaignItemId = preferences.selectedCampaignItemId || null;
  campaignSearch.value = preferences.search || "";
  campaignFilter.value = preferences.filter || "all";
  showTemplates.checked = Boolean(preferences.showTemplates);

  function selectedToken() {
    return activeTokens().find((token) => token.id === state.selectedTokenId);
  }

  function activeTokens() {
    return window.CampaignOS.tokensOnCurrentMap(state);
  }

  function render() {
    document.body.dataset.fog = state.fogEnabled ? "on" : "off";
    toggleFog.textContent = state.fogEnabled ? "Fog On" : "Fog Off";
    toggleFog.classList.toggle("active-toggle", state.fogEnabled);
    document.querySelector("h1").textContent = state.mapName;
    renderMapBackground();
    renderMapControls();
    ensureMapOption(state.mapName);
    mapSelect.value = state.mapName;
    renderMap();
    renderInitiative();
    renderTokenSheet();
    renderCombatLog();
    renderCampaign();
  }

  function renderMap() {
    map.innerHTML = "";
    map.onclick = handleMapClick;
    const settings = currentMapSettings();
    const grid = { columns: settings.columns, rows: settings.rows };
    map.style.setProperty("--grid-columns", grid.columns);
    map.style.setProperty("--grid-rows", grid.rows);
    map.style.setProperty("--grid-opacity", settings.gridOpacity / 100);
    map.style.setProperty("--token-size", `${settings.tokenSize}%`);
    map.classList.toggle("grid-hidden", !settings.showGrid);

    for (let y = 1; y <= grid.rows; y += 1) {
      for (let x = 1; x <= grid.columns; x += 1) {
        const tile = document.createElement("button");
        tile.className = "map-tile";
        tile.type = "button";
        tile.dataset.x = x;
        tile.dataset.y = y;
        tile.ariaLabel = `Tile ${x}, ${y}`;
        map.appendChild(tile);
      }
    }

    activeTokens().forEach((token) => {
      const tokenButton = document.createElement("button");
      tokenButton.className = `token ${token.type}`;
      tokenButton.type = "button";
      tokenButton.draggable = false;
      tokenButton.dataset.id = token.id;
      tokenButton.style.gridColumn = `${token.x} / span 1`;
      tokenButton.style.gridRow = `${token.y} / span 1`;
      if (token.image) {
        tokenButton.style.backgroundImage = `url("${token.image}")`;
        tokenButton.classList.add("has-image");
      } else {
        tokenButton.textContent = token.icon;
      }
      tokenButton.title = token.name;
      tokenButton.setAttribute("aria-label", token.name);
      if (token.id === state.selectedTokenId) tokenButton.classList.add("selected");
      tokenButton.addEventListener("click", (event) => {
        event.stopPropagation();
        selectToken(token.id);
      });
      map.appendChild(tokenButton);
    });
  }

  function renderMapBackground() {
    const settings = currentMapSettings();
    const image = settings.image || "";
    map.style.backgroundSize = settings.fitMode;
    map.style.backgroundRepeat = "no-repeat";
    if (image) {
      map.style.backgroundImage = `url("${image}")`;
      map.classList.add("has-map-image");
    } else {
      map.style.backgroundImage = "";
      map.classList.remove("has-map-image");
    }
  }

  function renderMapControls() {
    const settings = currentMapSettings();
    gridColumns.value = settings.columns;
    gridRows.value = settings.rows;
    showGrid.checked = settings.showGrid;
    gridOpacity.value = settings.gridOpacity;
    mapFitMode.value = settings.fitMode;
    tokenSize.value = settings.tokenSize;
  }

  function renderInitiative() {
    initiativeList.innerHTML = "";
    window.CampaignOS.sortByInitiative(activeTokens()).forEach((token) => {
      const item = document.createElement("li");
      item.className = token.id === state.selectedTokenId ? "active" : "";
      item.innerHTML = `<button type="button" data-id="${token.id}"><span>${token.name}</span><strong>${token.initiative}</strong></button>`;
      item.querySelector("button").addEventListener("click", () => selectToken(token.id));
      initiativeList.appendChild(item);
    });
  }

  function renderTokenSheet() {
    const token = selectedToken();
    if (!token) {
      tokenSheet.className = "token-sheet empty";
      tokenSheet.textContent = "Select a token";
      return;
    }

    tokenSheet.className = "token-sheet";
    tokenSheet.innerHTML = `
      <div class="token-heading">
        <div>
          <p>${token.type}</p>
          <h3>${escapeHtml(token.name)}</h3>
          ${token.sourcePath ? `<span class="token-source">${escapeHtml(token.sourcePath)}</span>` : ""}
        </div>
        <strong>${token.hp} / ${token.maxHp}</strong>
      </div>
      <div class="token-portrait">
        <div class="portrait-preview">${token.image ? `<img src="${token.image}" alt="">` : `<span>${escapeHtml(token.icon)}</span>`}</div>
        <label>
          Token Image
          <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
        </label>
        ${token.image ? `<button type="button" data-action="clear-image">Clear Image</button>` : ""}
      </div>
      <form class="token-editor">
        <label>
          Name
          <input name="name" type="text" value="${escapeAttribute(token.name)}">
        </label>
        <div class="stat-grid">
          <label>
            HP
            <input name="hp" type="number" min="0" max="999" value="${token.hp}">
          </label>
          <label>
            Max
            <input name="maxHp" type="number" min="1" max="999" value="${token.maxHp}">
          </label>
          <label>
            Init
            <input name="initiative" type="number" min="0" max="99" value="${token.initiative}">
          </label>
        </div>
        <div class="stat-grid">
          <label>
            AC
            <input name="ac" type="number" min="1" max="99" value="${token.ac || 10}">
          </label>
          <label>
            Attack
            <input name="attackBonus" type="number" min="-20" max="99" value="${token.attackBonus || 0}">
          </label>
          <label>
            Damage
            <input name="damageDice" type="text" value="${escapeAttribute(token.damageDice || "1d4")}">
          </label>
        </div>
        <button type="submit">Update</button>
      </form>
      <form class="attack-control">
        <label>
          Target
          <select name="targetId"></select>
        </label>
        <button type="submit">Attack</button>
      </form>
      <form class="hp-control">
        <label>
          Hit Damage
          <input name="amount" type="number" min="1" max="999" value="5">
        </label>
        <div class="hp-actions">
          <button type="button" data-action="damage">Damage</button>
          <button type="button" data-action="heal">Heal</button>
        </div>
      </form>
      <div class="hp-actions">
        <button type="button" data-action="bloodied">Bloodied</button>
        <button type="button" data-action="drop">Drop</button>
        <button type="button" data-action="full">Full HP</button>
      </div>
      <div>
        <h3 class="subheading">Conditions</h3>
        <div class="conditions"></div>
      </div>
      <button class="danger-button" type="button" data-action="remove">Remove Token</button>
    `;

    const editor = tokenSheet.querySelector(".token-editor");
    const imageInput = tokenSheet.querySelector('input[name="image"]');
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files[0];
      if (!file) return;
      const image = await readFileAsDataUrl(file);
      updateState(window.CampaignOS.updateToken(state, token.id, { image }));
    });
    const clearImageButton = tokenSheet.querySelector('[data-action="clear-image"]');
    if (clearImageButton) {
      clearImageButton.addEventListener("click", () => updateState(window.CampaignOS.updateToken(state, token.id, { image: "" })));
    }

    editor.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(editor);
      updateState(window.CampaignOS.updateToken(state, token.id, {
        name: form.get("name"),
        hp: form.get("hp"),
        maxHp: form.get("maxHp"),
        initiative: form.get("initiative"),
        ac: form.get("ac"),
        attackBonus: form.get("attackBonus"),
        damageDice: form.get("damageDice")
      }));
    });

    const attackControl = tokenSheet.querySelector(".attack-control");
    const targetSelect = attackControl.querySelector("select");
    activeTokens()
      .filter((candidate) => candidate.id !== token.id)
      .forEach((candidate) => {
        const option = document.createElement("option");
        option.value = candidate.id;
        option.textContent = candidate.name;
        targetSelect.appendChild(option);
      });
    attackControl.addEventListener("submit", (event) => {
      event.preventDefault();
      const targetId = new FormData(attackControl).get("targetId");
      const result = window.CampaignOS.attack(state, token.id, targetId);
      state = result.state;
      saveEncounter();
      commandResult.textContent = result.message;
      render();
    });

    const hpControl = tokenSheet.querySelector(".hp-control");
    const hpAmount = () => Number(new FormData(hpControl).get("amount")) || 1;
    tokenSheet.querySelector('[data-action="damage"]').addEventListener("click", () => updateState(window.CampaignOS.applyDamage(state, token.id, hpAmount())));
    tokenSheet.querySelector('[data-action="heal"]').addEventListener("click", () => updateState(window.CampaignOS.applyHealing(state, token.id, hpAmount())));
    tokenSheet.querySelector('[data-action="bloodied"]').addEventListener("click", () => updateState(window.CampaignOS.updateToken(state, token.id, { hp: Math.floor(token.maxHp / 2) })));
    tokenSheet.querySelector('[data-action="drop"]').addEventListener("click", () => updateState(window.CampaignOS.updateToken(state, token.id, { hp: 0 })));
    tokenSheet.querySelector('[data-action="full"]').addEventListener("click", () => updateState(window.CampaignOS.updateToken(state, token.id, { hp: token.maxHp })));
    tokenSheet.querySelector('[data-action="remove"]').addEventListener("click", () => updateState(window.CampaignOS.removeToken(state, token.id)));

    const conditions = tokenSheet.querySelector(".conditions");
    window.CampaignOS.conditionList.forEach((condition) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" ${token.conditions.includes(condition) ? "checked" : ""}> ${condition}`;
      label.querySelector("input").addEventListener("change", () => updateState(window.CampaignOS.toggleCondition(state, token.id, condition)));
      conditions.appendChild(label);
    });
  }

  function renderCombatLog() {
    combatLog.innerHTML = "";
    const entries = state.log || [];
    if (!entries.length) {
      const item = document.createElement("li");
      item.className = "empty-log";
      item.textContent = "No attacks yet.";
      combatLog.appendChild(item);
      return;
    }

    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = entry;
      combatLog.appendChild(item);
    });
  }

  function renderCampaign() {
    const imported = campaign.files.length > 0;
    const visibleFiles = filteredCampaignFiles();
    const hiddenTemplates = showTemplates.checked ? 0 : campaign.files.filter((item) => item.isTemplate).length;
    if (!visibleFiles.some((item) => item.id === selectedCampaignItemId)) {
      selectedCampaignItemId = visibleFiles[0]?.id || null;
    }
    campaignSummary.textContent = imported
      ? `${campaign.name}: ${visibleFiles.length} shown, ${campaign.files.length} imported${hiddenTemplates ? `, ${hiddenTemplates} templates hidden` : ""}.`
      : "No campaign imported.";
    campaignBrowser.innerHTML = "";
    renderCampaignDetail();

    categoryOrder().forEach((category) => {
      const items = visibleFiles.filter((item) => item.category === category);
      const group = document.createElement("section");
      group.className = "campaign-group";
      const title = document.createElement("h3");
      title.textContent = `${categoryLabel(category)} (${items.length})`;
      group.appendChild(title);

      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty-campaign";
        empty.textContent = "Nothing found.";
        group.appendChild(empty);
      }

      items.slice(0, 10).forEach((item) => {
        const card = document.createElement("div");
        card.className = item.id === selectedCampaignItemId ? "campaign-item active" : "campaign-item";

        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.className = "campaign-item-main";
        selectButton.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.path)}</span><small>${escapeHtml(item.summary)}</small>`;
        selectButton.addEventListener("click", () => openCampaignItem(item));
        card.appendChild(selectButton);

        const actions = document.createElement("div");
        actions.className = "campaign-item-actions";
        if (item.canSpawnToken) {
          const addButton = document.createElement("button");
          addButton.type = "button";
          addButton.textContent = "Add Token";
          addButton.addEventListener("click", () => addCampaignToken(item));
          actions.appendChild(addButton);

          const sheetButton = document.createElement("button");
          sheetButton.type = "button";
          sheetButton.textContent = "Open Sheet";
          sheetButton.addEventListener("click", () => openCharacterSheet(item));
          actions.appendChild(sheetButton);
        }
        if (item.category === "locations") {
          const mapButton = document.createElement("button");
          mapButton.type = "button";
          mapButton.textContent = "Open Map";
          mapButton.addEventListener("click", () => openCampaignItem(item));
          actions.appendChild(mapButton);
        }
        if (actions.children.length) card.appendChild(actions);
        group.appendChild(card);
      });

      campaignBrowser.appendChild(group);
    });
  }

  function renderCampaignDetail() {
    const item = campaign.files.find((candidate) => candidate.id === selectedCampaignItemId);
    if (!item) {
      campaignDetail.className = "campaign-detail empty";
      campaignDetail.textContent = campaign.files.length ? "No item matches the current filters." : "Select a campaign item.";
      return;
    }

    campaignDetail.className = "campaign-detail";
    campaignDetail.innerHTML = `
      <div class="detail-heading">
        <div>
          <p>${escapeHtml(categoryLabel(item.category))}${item.isTemplate ? " Template" : ""}</p>
          <h3>${escapeHtml(item.title)}</h3>
        </div>
        <strong>${item.wordCount}</strong>
      </div>
      <span>${escapeHtml(item.path)}</span>
      <p>${escapeHtml(item.summary)}</p>
      <div class="detail-actions"></div>
    `;

    const actions = campaignDetail.querySelector(".detail-actions");
    if (item.canSpawnToken) {
      const spawnButton = document.createElement("button");
      spawnButton.type = "button";
      spawnButton.textContent = "Add Token";
      spawnButton.addEventListener("click", () => addCampaignToken(item));
      actions.appendChild(spawnButton);

      const sheetButton = document.createElement("button");
      sheetButton.type = "button";
      sheetButton.textContent = "Open Sheet";
      sheetButton.addEventListener("click", () => openCharacterSheet(item));
      actions.appendChild(sheetButton);
    }

    if (item.category === "locations") {
      const mapButton = document.createElement("button");
      mapButton.type = "button";
      mapButton.textContent = "Open Map";
      mapButton.addEventListener("click", () => {
        setActiveMap(item.title);
        saveEncounter();
        commandResult.textContent = `${item.title} is now the active map context.`;
        render();
      });
      actions.appendChild(mapButton);
    }

    if (["sessions", "notes"].includes(item.category)) {
      const contextButton = document.createElement("button");
      contextButton.type = "button";
      contextButton.textContent = "Use Context";
      contextButton.addEventListener("click", () => useCampaignContext(item));
      actions.appendChild(contextButton);
    }
  }

  function filteredCampaignFiles() {
    const query = campaignSearch.value.trim().toLowerCase();
    const category = campaignFilter.value;
    return campaign.files.filter((item) => {
      if (!showTemplates.checked && item.isTemplate) return false;
      if (category !== "all" && item.category !== category) return false;
      if (!query) return true;
      const haystack = `${item.title} ${item.path} ${item.summary} ${item.text}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  function categoryOrder() {
    const selected = campaignFilter.value;
    if (selected !== "all") return [selected];
    return ["characters", "locations", "sessions", "notes"];
  }

  function categoryLabel(category) {
    return {
      characters: "Characters",
      locations: "Locations",
      sessions: "Sessions",
      notes: "Notes"
    }[category] || category;
  }

  function openCampaignItem(item) {
    selectedCampaignItemId = item.id;
    savePreferences();
    commandResult.textContent = `${item.title}: ${item.summary}`;
    if (item.category === "locations") {
      setActiveMap(item.title);
      saveEncounter();
      render();
    }
  }

  function addCampaignToken(item) {
    const draft = window.CampaignOSCampaign.tokenDraftFromItem(item);
    const result = window.CampaignOS.addToken(state, draft);
    state = result.state;
    saveEncounter();
    commandResult.textContent = `${result.token.name} joined the encounter from ${item.title}.`;
    render();
  }

  function openCharacterSheet(item) {
    const url = `character.html?id=${encodeURIComponent(item.id)}`;
    window.open(url, "_blank", "noopener");
  }

  function useCampaignContext(item) {
    commandInput.value = `Use ${item.title} as context.`;
    commandResult.textContent = `${item.title} is ready as DM context: ${item.summary}`;
  }

  function ensureMapOption(mapName) {
    const exists = Array.from(mapSelect.options).some((option) => option.value === mapName);
    if (exists) return;
    const option = document.createElement("option");
    option.value = mapName;
    option.textContent = mapName;
    mapSelect.appendChild(option);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(file);
    });
  }

  function selectToken(tokenId) {
    state.selectedTokenId = tokenId;
    saveEncounter();
    render();
  }

  function updateState(nextState) {
    state = nextState;
    saveEncounter();
    render();
  }

  function moveSelectedToken(x, y) {
    const token = selectedToken();
    if (!token) {
      commandResult.textContent = "Select a token first, then click a destination square.";
      return;
    }

    const nextState = window.CampaignOS.setTokenPosition(state, token.id, x, y);
    if (nextState === state) {
      commandResult.textContent = "That square is occupied.";
      return;
    }

    updateState(nextState);
  }

  function handleMapClick(event) {
    if (event.target.closest(".token")) return;
    const rect = map.getBoundingClientRect();
    const grid = currentGrid();
    const x = Math.min(grid.columns, Math.max(1, Math.floor(((event.clientX - rect.left) / rect.width) * grid.columns) + 1));
    const y = Math.min(grid.rows, Math.max(1, Math.floor(((event.clientY - rect.top) / rect.height) * grid.rows) + 1));
    moveSelectedToken(x, y);
  }

  commandForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = window.CampaignOS.parseCommand(state, commandInput.value);
    state = result.state;
    saveEncounter();
    commandResult.textContent = result.message;
    render();
  });

  document.querySelector("#saveEncounter").addEventListener("click", () => {
    saveEncounter();
    savePreferences();
    commandResult.textContent = "Encounter saved locally.";
  });

  document.querySelector("#loadEncounter").addEventListener("click", () => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      commandResult.textContent = "No saved encounter found.";
      return;
    }
    state = normalizeEncounter(JSON.parse(saved));
    commandResult.textContent = "Encounter loaded.";
    render();
  });

  document.querySelector("#resetEncounter").addEventListener("click", () => {
    state = window.CampaignOS.createState();
    saveEncounter();
    commandResult.textContent = "Encounter reset.";
    render();
  });

  campaignImport.addEventListener("change", async () => {
    campaignSummary.textContent = "Importing campaign...";
    campaign = await window.CampaignOSCampaign.importMarkdownFiles(campaignImport.files);
    selectedCampaignItemId = filteredCampaignFiles()[0]?.id || campaign.files[0]?.id || null;
    saveCampaign();
    savePreferences();
    commandResult.textContent = `${campaign.name} imported.`;
    render();
  });

  document.querySelector("#clearCampaign").addEventListener("click", () => {
    campaign = window.CampaignOSCampaign.createCampaign();
    selectedCampaignItemId = null;
    localStorage.removeItem(campaignStorageKey);
    savePreferences();
    campaignImport.value = "";
    commandResult.textContent = "Campaign import cleared.";
    render();
  });

  campaignSearch.addEventListener("input", () => {
    selectedCampaignItemId = filteredCampaignFiles()[0]?.id || null;
    savePreferences();
    render();
  });

  campaignFilter.addEventListener("change", () => {
    selectedCampaignItemId = filteredCampaignFiles()[0]?.id || null;
    savePreferences();
    render();
  });

  showTemplates.addEventListener("change", () => {
    selectedCampaignItemId = filteredCampaignFiles()[0]?.id || null;
    savePreferences();
    render();
  });

  toggleFog.addEventListener("click", () => {
    state.fogEnabled = !state.fogEnabled;
    saveEncounter();
    render();
  });

  mapImageInput.addEventListener("change", async () => {
    const file = mapImageInput.files[0];
    if (!file) return;
    const mapName = state.mapName;
    const image = await readFileAsDataUrl(file);
    updateState(window.CampaignOS.setMapImage(state, mapName, image));
    commandResult.textContent = `${mapName} map image imported.`;
  });

  document.querySelector("#clearMapImage").addEventListener("click", () => {
    const mapName = state.mapName;
    updateState(window.CampaignOS.setMapImage(state, mapName, ""));
    mapImageInput.value = "";
    commandResult.textContent = `${mapName} map image cleared.`;
  });

  gridColumns.addEventListener("change", updateGridSize);
  gridRows.addEventListener("change", updateGridSize);
  showGrid.addEventListener("change", updateMapView);
  gridOpacity.addEventListener("input", updateMapView);
  mapFitMode.addEventListener("change", updateMapView);
  tokenSize.addEventListener("input", updateMapView);

  mapSelect.addEventListener("change", () => {
    setActiveMap(mapSelect.value);
    saveEncounter();
    render();
  });

  function saveEncounter() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function setActiveMap(mapName) {
    state.mapName = mapName;
    if (!activeTokens().some((token) => token.id === state.selectedTokenId)) {
      state.selectedTokenId = activeTokens()[0]?.id || null;
    }
  }

  function updateGridSize() {
    updateState(window.CampaignOS.setMapGrid(state, state.mapName, gridColumns.value, gridRows.value));
    commandResult.textContent = `${state.mapName} grid updated.`;
  }

  function updateMapView() {
    updateState(window.CampaignOS.setMapView(state, state.mapName, {
      showGrid: showGrid.checked,
      gridOpacity: gridOpacity.value,
      fitMode: mapFitMode.value,
      tokenSize: tokenSize.value
    }));
  }

  function currentGrid() {
    const mapSettings = currentMapSettings();
    return {
      columns: mapSettings.columns,
      rows: mapSettings.rows
    };
  }

  function currentMapSettings() {
    const mapSettings = state.maps?.[state.mapName] || {};
    return {
      image: mapSettings.image || "",
      columns: clampUiNumber(mapSettings.columns, 12, 4, 80),
      rows: clampUiNumber(mapSettings.rows, 8, 4, 80),
      showGrid: mapSettings.showGrid !== false,
      gridOpacity: clampUiNumber(mapSettings.gridOpacity, 35, 0, 100),
      fitMode: mapSettings.fitMode === "contain" ? "contain" : "cover",
      tokenSize: clampUiNumber(mapSettings.tokenSize, 78, 40, 100)
    };
  }

  function clampUiNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function loadEncounter() {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return window.CampaignOS.createState();
    try {
      return normalizeEncounter(JSON.parse(saved));
    } catch {
      return window.CampaignOS.createState();
    }
  }

  function normalizeEncounter(savedState) {
    const fallback = window.CampaignOS.createState();
    const mapName = savedState?.mapName || fallback.mapName;
    const tokens = Array.isArray(savedState?.tokens)
      ? removeLegacyDefaultTokens(savedState.tokens).map((token) => ({
          ...token,
          mapName: token.mapName || mapName
        }))
      : fallback.tokens;
    const selectedTokenId = tokens.some((token) => token.id === savedState?.selectedTokenId && token.mapName === mapName)
      ? savedState.selectedTokenId
      : tokens.find((token) => token.mapName === mapName)?.id || null;
    return {
      ...fallback,
      ...savedState,
      mapName,
      selectedTokenId,
      tokens,
      maps: savedState?.maps || {},
      log: Array.isArray(savedState?.log) ? savedState.log : []
    };
  }

  function removeLegacyDefaultTokens(tokens) {
    return tokens.filter((token) => {
      return !(token.id === "darkhawk" && token.name === "Darkhawk" && !token.sourcePath);
    });
  }

  function saveCampaign() {
    localStorage.setItem(campaignStorageKey, JSON.stringify(campaign));
  }

  function loadCampaign() {
    const saved = localStorage.getItem(campaignStorageKey);
    if (!saved) return window.CampaignOSCampaign.createCampaign();
    try {
      return normalizeCampaign(JSON.parse(saved));
    } catch {
      return window.CampaignOSCampaign.createCampaign();
    }
  }

  function normalizeCampaign(savedCampaign) {
    if (!savedCampaign?.files || !savedCampaign?.categories) {
      return window.CampaignOSCampaign.createCampaign();
    }

    savedCampaign.files = savedCampaign.files.map((item) => ({
      ...item,
      category: window.CampaignOSCampaign.classify(item.path || "", item.text || ""),
      isTemplate: Boolean(item.isTemplate || /(^|[\\/])template([\\/]|$)/i.test(item.path || ""))
    }));

    savedCampaign.files = savedCampaign.files.map((item) => ({
      ...item,
      canSpawnToken: window.CampaignOSCampaign.canSpawnCharacterToken(item.path || "", item.category)
    }));

    Object.keys(savedCampaign.categories).forEach((category) => {
      savedCampaign.categories[category] = savedCampaign.files.filter((item) => item.category === category);
    });

    return savedCampaign;
  }

  function savePreferences() {
    preferences = {
      search: campaignSearch.value,
      filter: campaignFilter.value,
      showTemplates: showTemplates.checked,
      selectedCampaignItemId
    };
    localStorage.setItem(preferencesStorageKey, JSON.stringify(preferences));
  }

  function loadPreferences() {
    const saved = localStorage.getItem(preferencesStorageKey);
    if (!saved) return {};
    try {
      return JSON.parse(saved);
    } catch {
      return {};
    }
  }

  render();
})();
