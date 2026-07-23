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
  const dmBridgeConnect = document.querySelector("#dmBridgeConnect");
  const dmBridgeStatus = document.querySelector("#dmBridgeStatus");
  const libraryAddForm = document.querySelector("#libraryAddForm");
  const libraryName = document.querySelector("#libraryName");
  const libraryImageInput = document.querySelector("#libraryImageInput");
  const libraryList = document.querySelector("#libraryList");
  const mapSelect = document.querySelector("#mapSelect");
  const mapImageInput = document.querySelector("#mapImageInput");
  const adjustGrid = document.querySelector("#adjustGrid");
  const showGrid = document.querySelector("#showGrid");
  const gridOpacity = document.querySelector("#gridOpacity");
  const mapFitMode = document.querySelector("#mapFitMode");
  const tokenSize = document.querySelector("#tokenSize");
  const toggleFog = document.querySelector("#toggleFog");
  const clearMapImage = document.querySelector("#clearMapImage");
  const legacyPrototypeMaps = new Set(["The Standing Ring", "Bear Cave", "Urskelde Road"]);

  let preferences = loadPreferences();
  let state = loadEncounter();
  let campaign = loadCampaign();
  let selectedCampaignItemId = preferences.selectedCampaignItemId || null;
  let gridAdjusting = false;
  let gridDrag = null;
  let suppressGridClick = false;
  let dmBridgeDirHandle = null;
  let dmBridgePendingId = null;
  let dmBridgePollTimer = null;
  let dmBridgeTimeoutHandle = null;
  const dmBridgeResponseTimeoutMs = 20000;
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
    const previousMapName = state.mapName;
    reconcileActiveMap();
    if (state.mapName !== previousMapName) saveEncounter();
    document.body.dataset.fog = state.fogEnabled ? "on" : "off";
    toggleFog.textContent = state.fogEnabled ? "Fog On" : "Fog Off";
    toggleFog.classList.toggle("active-toggle", state.fogEnabled);
    adjustGrid.classList.toggle("active-toggle", gridAdjusting);
    adjustGrid.textContent = gridAdjusting ? "Adjusting Grid" : "Adjust Grid";
    document.querySelector("h1").textContent = state.mapName || "No map loaded";
    renderMapBackground();
    renderMapControls();
    renderMapOptions();
    renderMap();
    renderInitiative();
    renderTokenSheet();
    renderCombatLog();
    renderCampaign();
    renderTokenLibrary();
  }

  function renderTokenLibrary() {
    window.CampaignOSTokenLibrary.listEntries().then((entries) => {
      libraryList.innerHTML = "";
      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "library-empty";
        empty.textContent = "No art saved yet.";
        libraryList.appendChild(empty);
        return;
      }
      entries.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "library-item";
        row.innerHTML = `
          <img src="${entry.image}" alt="">
          <span>${escapeHtml(entry.displayName)}</span>
          <button type="button" data-key="${escapeAttribute(entry.key)}">Remove</button>
        `;
        row.querySelector("button").addEventListener("click", () => {
          window.CampaignOSTokenLibrary.deleteEntry(entry.key).then(renderTokenLibrary);
        });
        libraryList.appendChild(row);
      });
    });
  }

  // Attaches library art (matched by name) to any token that doesn't already have an
  // image -- called after every action that can add tokens to the map (manual spawn,
  // adding an imported character, and Claude DM bridge actions), so art shows up the
  // same way no matter which path created the token.
  async function applyLibraryImages(sourceState) {
    let nextState = sourceState;
    let changed = false;
    for (const token of sourceState.tokens) {
      if (token.image) continue;
      const image = await window.CampaignOSTokenLibrary.findImage(token.name);
      if (image) {
        nextState = window.CampaignOS.updateToken(nextState, token.id, { image });
        changed = true;
      }
    }
    return { state: nextState, changed };
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
    map.style.setProperty("--map-aspect-ratio", settings.aspectRatio);
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

    renderGridHandles();
  }

  let lastRenderedMapImageValue = undefined;

  function renderMapBackground() {
    const settings = currentMapSettings();
    map.style.backgroundSize = settings.fitMode;
    map.style.backgroundRepeat = "no-repeat";

    const imageValue = settings.image || "";
    // The map's `image` field is now an ui/imageStore.js key, not the actual image data
    // -- avoid re-fetching from IndexedDB every render() call (token moves, damage,
    // etc. all trigger one) when the active map's image hasn't actually changed.
    if (imageValue === lastRenderedMapImageValue) return;
    lastRenderedMapImageValue = imageValue;

    if (!imageValue) {
      map.style.backgroundImage = "";
      map.classList.remove("has-map-image");
      return;
    }

    if (imageValue.startsWith("data:")) {
      // Pre-migration save: the map's `image` field still holds raw inline base64
      // from before images moved into IndexedDB. Show it immediately, then move it
      // into the image store so this map stops bloating localStorage on every save.
      map.style.backgroundImage = `url("${imageValue}")`;
      map.classList.add("has-map-image");
      migrateLegacyMapImage(state.mapName, imageValue);
      return;
    }

    window.CampaignOSImageStore.loadImage(imageValue).then((dataUrl) => {
      if (!dataUrl) {
        map.style.backgroundImage = "";
        map.classList.remove("has-map-image");
        return;
      }
      map.style.backgroundImage = `url("${dataUrl}")`;
      map.classList.add("has-map-image");
    });
  }

  async function migrateLegacyMapImage(mapName, dataUrl) {
    const key = window.CampaignOSImageStore.generateKey("map");
    await window.CampaignOSImageStore.saveImage(key, dataUrl);
    state = window.CampaignOS.setMapImage(state, mapName, key);
    saveEncounter();
  }

  function renderMapControls() {
    const settings = currentMapSettings();
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

      items.slice(0, 30).forEach((item) => {
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

  async function addCampaignToken(item) {
    if (!state.mapName) {
      commandResult.textContent = "Load or open a map before adding tokens.";
      return;
    }
    const draft = window.CampaignOSCampaign.tokenDraftFromItem(item);
    const result = window.CampaignOS.addToken(state, draft);
    const enriched = await applyLibraryImages(result.state);
    state = enriched.state;
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

  function renderMapOptions() {
    const names = loadedMapNames();
    mapSelect.innerHTML = "";
    if (!names.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No maps loaded";
      mapSelect.appendChild(option);
      mapSelect.value = "";
      mapSelect.disabled = true;
      return;
    }

    names.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      mapSelect.appendChild(option);
    });
    mapSelect.disabled = false;
    mapSelect.value = state.mapName;
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

  function readImageDetails(dataUrl) {
    return new Promise((resolve) => {
      const image = new Image();
      image.addEventListener("load", () => resolve({
        width: image.naturalWidth || 12,
        height: image.naturalHeight || 8
      }));
      image.addEventListener("error", () => resolve({ width: 12, height: 8 }));
      image.src = dataUrl;
    });
  }

  function mapNameFromFile(fileName) {
    return String(fileName || "Imported Map")
      .replace(/\.[^.]+$/u, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Imported Map";
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

  commandForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (dmBridgeDirHandle) {
      sendDMBridgeCommand(commandInput.value);
      return;
    }
    const result = window.CampaignOS.parseCommand(state, commandInput.value);
    const enriched = await applyLibraryImages(result.state);
    state = enriched.state;
    saveEncounter();
    commandResult.textContent = result.message;
    render();
  });

  libraryAddForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const files = Array.from(libraryImageInput.files);
    if (!files.length) return;

    const typedName = libraryName.value.trim();
    // A typed name only makes sense for a single file -- with several files selected
    // at once, each one gets its own name derived from its filename instead.
    const useTypedName = files.length === 1 && typedName;

    for (const file of files) {
      const name = useTypedName ? typedName : nameFromFileName(file.name);
      const image = await readFileAsDataUrl(file);
      await window.CampaignOSTokenLibrary.saveEntry(name, image);
    }

    commandResult.textContent = files.length === 1
      ? `Added "${useTypedName ? typedName : nameFromFileName(files[0].name)}" to the token library.`
      : `Added ${files.length} tokens to the library from their filenames.`;
    libraryAddForm.reset();
    renderTokenLibrary();
  });

  function nameFromFileName(fileName) {
    return String(fileName || "")
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  dmBridgeConnect.addEventListener("click", async () => {
    if (!window.showDirectoryPicker) {
      dmBridgeStatus.textContent = "Not supported in this browser -- use Chrome or Edge.";
      return;
    }
    try {
      // If we've connected before, try re-granting permission on the stored handle
      // first -- this is a single browser permission prompt, not a full re-pick of
      // the folder. Only fall back to the picker if there's nothing stored yet, or
      // the user denies the re-grant.
      let handle = await window.CampaignOSDMBridgeStore.loadHandle().catch(() => null);
      if (handle) {
        const permission = await handle.requestPermission({ mode: "readwrite" }).catch(() => "denied");
        if (permission !== "granted") handle = null;
      }

      if (!handle) {
        // Pick (or re-pick) the project's dm-bridge/ folder -- the same folder
        // dm-bridge/watch.js reads and writes on the Node side.
        handle = await window.showDirectoryPicker({ id: "campaign-os-dm-bridge" });
        await window.CampaignOSDMBridgeStore.saveHandle(handle);
      }

      connectDMBridge(handle);
    } catch (err) {
      if (err.name !== "AbortError") {
        dmBridgeStatus.textContent = `Connection failed: ${err.message}`;
      }
    }
  });

  function connectDMBridge(handle) {
    dmBridgeDirHandle = handle;
    dmBridgeStatus.textContent = `Connected to "${handle.name}" -- run dm-bridge/watch.js to process commands`;
    dmBridgeStatus.classList.add("connected");
    startDMBridgePolling();
  }

  // Runs once at startup: if a folder was connected in a previous session and the
  // browser still remembers granting it read/write access, reconnect silently with
  // no click needed. If permission needs re-confirming, leave a hint rather than
  // popping a permission prompt with no user gesture behind it (browsers require one).
  async function tryRestoreDMBridge() {
    if (!window.showDirectoryPicker) return;
    const handle = await window.CampaignOSDMBridgeStore.loadHandle().catch(() => null);
    if (!handle) return;
    const permission = await handle.queryPermission({ mode: "readwrite" }).catch(() => "denied");
    if (permission === "granted") {
      connectDMBridge(handle);
    } else {
      dmBridgeStatus.textContent = `Previously connected to "${handle.name}" -- click Connect to re-grant access`;
    }
  }

  async function sendDMBridgeCommand(command) {
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id,
      command,
      state: {
        mapName: state.mapName,
        tokens: activeTokens().map((token) => ({
          name: token.name,
          type: token.type,
          hp: token.hp,
          maxHp: token.maxHp,
          ac: token.ac,
          conditions: token.conditions
        }))
      },
      createdAt: new Date().toISOString()
    };

    try {
      await writeBridgeJson("request.json", payload);
    } catch (err) {
      commandResult.textContent = `Could not write to the DM bridge folder: ${err.message}`;
      return;
    }

    dmBridgePendingId = id;
    setDMBridgeBusy(true);
    commandResult.textContent = "Waiting for Claude Code (run dm-bridge/watch.js if it isn't already running)...";

    clearTimeout(dmBridgeTimeoutHandle);
    dmBridgeTimeoutHandle = setTimeout(() => {
      if (dmBridgePendingId !== id) return; // a later response already resolved this
      dmBridgePendingId = null;
      setDMBridgeBusy(false);
      commandResult.textContent = "No response after 20s -- make sure `node dm-bridge/watch.js` is running, then try again.";
    }, dmBridgeResponseTimeoutMs);
  }

  function setDMBridgeBusy(isBusy) {
    commandInput.disabled = isBusy;
    commandForm.querySelector("button[type=submit]").disabled = isBusy;
  }

  function startDMBridgePolling() {
    if (dmBridgePollTimer) return;
    dmBridgePollTimer = setInterval(checkDMBridgeResponse, 1500);
  }

  async function checkDMBridgeResponse() {
    if (!dmBridgeDirHandle || !dmBridgePendingId) return;
    let response;
    try {
      response = await readBridgeJson("response.json");
    } catch {
      return;
    }
    if (!response || response.id !== dmBridgePendingId) return;

    clearTimeout(dmBridgeTimeoutHandle);
    dmBridgePendingId = null;
    setDMBridgeBusy(false);
    const withActions = window.CampaignOSDMBridge.applyActions(state, response.actions || []);
    const enriched = await applyLibraryImages(withActions);
    state = enriched.state;
    saveEncounter();
    commandResult.textContent = response.message || "(The DM assistant didn't include a narration.)";
    render();
  }

  async function writeBridgeJson(name, obj) {
    const fileHandle = await dmBridgeDirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(obj, null, 2));
    await writable.close();
  }

  async function readBridgeJson(name) {
    let fileHandle;
    try {
      fileHandle = await dmBridgeDirHandle.getFileHandle(name);
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
    const mapName = mapNameFromFile(file.name);
    const dataUrl = await readFileAsDataUrl(file);
    const details = await readImageDetails(dataUrl);
    const previousKey = state.maps?.[mapName]?.image;
    const key = window.CampaignOSImageStore.generateKey("map");
    await window.CampaignOSImageStore.saveImage(key, dataUrl);
    if (previousKey && !previousKey.startsWith("data:")) {
      window.CampaignOSImageStore.deleteImage(previousKey).catch(() => {});
    }
    setActiveMap(mapName);
    updateState(window.CampaignOS.setMapImage(state, mapName, key, {
      sourceFileName: file.name,
      aspectRatio: `${details.width} / ${details.height}`
    }));
    commandResult.textContent = `${mapName} map image imported from ${file.name}.`;
  });

  clearMapImage.addEventListener("click", () => {
    const mapName = state.mapName;
    if (!mapName) return;
    const previousKey = state.maps?.[mapName]?.image;
    if (previousKey && !previousKey.startsWith("data:")) {
      window.CampaignOSImageStore.deleteImage(previousKey).catch(() => {});
    }
    updateState(window.CampaignOS.setMapImage(state, mapName, ""));
    mapImageInput.value = "";
    commandResult.textContent = `${mapName} map image cleared.`;
  });

  adjustGrid.addEventListener("click", () => {
    gridAdjusting = !gridAdjusting;
    if (gridAdjusting && !state.mapName) {
      gridAdjusting = false;
      commandResult.textContent = "Open a map before adjusting the grid.";
    } else {
      commandResult.textContent = gridAdjusting ? "Drag the right, bottom, or corner handle to fit the grid." : "Grid adjustment off.";
    }
    render();
  });

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

  function reconcileActiveMap() {
    const names = loadedMapNames();
    if (names.includes(state.mapName)) return;
    state.mapName = names[0] || "";
    state.selectedTokenId = activeTokens()[0]?.id || null;
  }

  function loadedMapNames() {
    const names = new Set();
    campaign.files
      .filter((item) => item.category === "locations" && !item.isTemplate)
      .forEach((item) => names.add(item.title));

    Object.entries(state.maps || {}).forEach(([name, settings]) => {
      const hasMapData = Boolean(settings?.image || settings?.sourcePath);
      if (name && hasMapData) names.add(name);
    });

    state.tokens.forEach((token) => {
      const hasRealMapState = Boolean(state.maps?.[token.mapName]?.image || state.maps?.[token.mapName]?.sourcePath);
      if (token.mapName && (!legacyPrototypeMaps.has(token.mapName) || hasRealMapState)) names.add(token.mapName);
    });

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  function renderGridHandles() {
    if (!gridAdjusting || !state.mapName) return;
    [
      { type: "columns", side: "left", label: "Drag to adjust grid columns" },
      { type: "columns", side: "right", label: "Drag to adjust grid columns" },
      { type: "rows", side: "top", label: "Drag to adjust grid rows" },
      { type: "rows", side: "bottom", label: "Drag to adjust grid rows" },
      { type: "both", side: "top-left", label: "Drag to adjust grid columns and rows" },
      { type: "both", side: "top-right", label: "Drag to adjust grid columns and rows" },
      { type: "both", side: "bottom-left", label: "Drag to adjust grid columns and rows" },
      { type: "both", side: "bottom-right", label: "Drag to adjust grid columns and rows" }
    ].forEach((handle) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `grid-handle ${handle.type} ${handle.side}`;
      button.dataset.handle = handle.type;
      button.dataset.side = handle.side;
      button.textContent = handle.type === "columns" ? "Cols" : handle.type === "rows" ? "Rows" : "Both";
      button.setAttribute("aria-label", handle.label);
      button.title = handle.label;
      button.addEventListener("mousedown", startGridDrag);
      button.addEventListener("touchstart", startGridDrag, { passive: false });
      button.addEventListener("pointerdown", startGridDrag);
      button.addEventListener("click", nudgeGrid);
      map.appendChild(button);
    });
  }

  function startGridDrag(event) {
    event.preventDefault();
    event.stopPropagation();
    if (gridDrag) return;
    const point = event.touches?.[0] || event;
    const grid = currentGrid();
    const rect = map.getBoundingClientRect();
    gridDrag = {
      type: event.currentTarget.dataset.handle,
      startX: point.clientX,
      startY: point.clientY,
      startColumns: grid.columns,
      startRows: grid.rows,
      cellWidth: rect.width / grid.columns,
      cellHeight: rect.height / grid.rows,
      columnDirection: event.currentTarget.dataset.side.includes("left") ? -1 : 1,
      rowDirection: event.currentTarget.dataset.side.includes("top") ? -1 : 1,
      moved: false
    };
    document.body.classList.add("grid-dragging");
    window.addEventListener("pointermove", dragGrid);
    window.addEventListener("pointerup", endGridDrag, { once: true });
    window.addEventListener("mousemove", dragGrid);
    window.addEventListener("mouseup", endGridDrag, { once: true });
    window.addEventListener("touchmove", dragGrid, { passive: false });
    window.addEventListener("touchend", endGridDrag, { once: true });
  }

  function dragGrid(event) {
    if (!gridDrag || !state.mapName) return;
    event.preventDefault();
    const point = event.touches?.[0] || event;
    const columnDelta = Math.round(((point.clientX - gridDrag.startX) * gridDrag.columnDirection) / gridDrag.cellWidth);
    const rowDelta = Math.round(((point.clientY - gridDrag.startY) * gridDrag.rowDirection) / gridDrag.cellHeight);
    const columns = gridDrag.type === "rows" ? gridDrag.startColumns : gridDrag.startColumns + columnDelta;
    const rows = gridDrag.type === "columns" ? gridDrag.startRows : gridDrag.startRows + rowDelta;
    if (columnDelta !== 0 || rowDelta !== 0) gridDrag.moved = true;
    applyGridSize(columns, rows);
  }

  function nudgeGrid(event) {
    event.preventDefault();
    event.stopPropagation();
    if (suppressGridClick || !state.mapName) {
      suppressGridClick = false;
      return;
    }
    const type = event.currentTarget.dataset.handle;
    const grid = currentGrid();
    const columns = type === "rows" ? grid.columns : grid.columns + 1;
    const rows = type === "columns" ? grid.rows : grid.rows + 1;
    applyGridSize(columns, rows);
    commandResult.textContent = `${state.mapName} grid adjusted to ${currentGrid().columns} x ${currentGrid().rows}.`;
  }

  function applyGridSize(columns, rows) {
    const nextState = window.CampaignOS.setMapGrid(state, state.mapName, columns, rows);
    const nextGrid = {
      columns: nextState.maps?.[state.mapName]?.columns,
      rows: nextState.maps?.[state.mapName]?.rows
    };
    const current = currentGrid();
    if (nextGrid.columns === current.columns && nextGrid.rows === current.rows) return;
    state = nextState;
    saveEncounter();
    render();
  }

  function endGridDrag() {
    window.removeEventListener("pointermove", dragGrid);
    window.removeEventListener("mousemove", dragGrid);
    window.removeEventListener("touchmove", dragGrid);
    document.body.classList.remove("grid-dragging");
    if (gridDrag) {
      suppressGridClick = gridDrag.moved;
      commandResult.textContent = `${state.mapName} grid adjusted to ${currentGrid().columns} x ${currentGrid().rows}.`;
    }
    gridDrag = null;
  }

  function updateMapView() {
    if (!state.mapName) return;
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
      aspectRatio: /^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/.test(mapSettings.aspectRatio || "") ? mapSettings.aspectRatio : "12 / 8",
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

    // Location and session entries are synthesized from part of a source file's
    // content (see extractLocationEntries / extractSessionEntries in campaign.js) --
    // their `path` is that source file's path, which would reclassify them back to
    // "notes" if run through classify() again. Leave them as-is.
    const isSynthesizedEntry = (item) => item.sourceKind === "location-entry" || item.sourceKind === "session-entry";

    savedCampaign.files = savedCampaign.files.map((item) => (isSynthesizedEntry(item)
      ? item
      : {
          ...item,
          category: window.CampaignOSCampaign.classify(item.path || "", item.text || ""),
          isTemplate: Boolean(item.isTemplate || window.CampaignOSCampaign.isTemplatePath(item.path || ""))
        }));

    savedCampaign.files = savedCampaign.files.map((item) => (isSynthesizedEntry(item)
      ? item
      : {
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
  tryRestoreDMBridge();
})();
