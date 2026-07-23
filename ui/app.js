(function () {
  const storageKey = "campaign-os-encounter-state";
  const campaignStorageKey = "campaign-os-campaign-import";
  const preferencesStorageKey = "campaign-os-preferences";
  const sessionTranscriptStorageKey = "campaign-os-session-transcript";
  const map = document.querySelector("#battleMap");
  const initiativeList = document.querySelector("#initiativeList");
  const turnStatus = document.querySelector("#turnStatus");
  const nextTurnButton = document.querySelector("#nextTurnButton");
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
  const dmBridgeContextRow = document.querySelector("#dmBridgeContextRow");
  const dmBridgeContextLabel = document.querySelector("#dmBridgeContextLabel");
  const dmBridgeContextClear = document.querySelector("#dmBridgeContextClear");
  const endSessionButton = document.querySelector("#endSessionButton");
  const endSessionStatus = document.querySelector("#endSessionStatus");
  const libraryAddForm = document.querySelector("#libraryAddForm");
  const libraryName = document.querySelector("#libraryName");
  const libraryImageInput = document.querySelector("#libraryImageInput");
  const libraryList = document.querySelector("#libraryList");
  const libraryClearAll = document.querySelector("#libraryClearAll");
  const mapLibraryAddForm = document.querySelector("#mapLibraryAddForm");
  const mapLibraryName = document.querySelector("#mapLibraryName");
  const mapLibraryImageInput = document.querySelector("#mapLibraryImageInput");
  const mapLibraryList = document.querySelector("#mapLibraryList");
  const mapLibraryClearAll = document.querySelector("#mapLibraryClearAll");
  const tokenFolderConnect = document.querySelector("#tokenFolderConnect");
  const tokenFolderStatus = document.querySelector("#tokenFolderStatus");
  const mapFolderConnect = document.querySelector("#mapFolderConnect");
  const mapFolderStatus = document.querySelector("#mapFolderStatus");
  const mapFolderSearch = document.querySelector("#mapFolderSearch");
  const mapFolderResults = document.querySelector("#mapFolderResults");
  const mapSelect = document.querySelector("#mapSelect");
  const mapImageInput = document.querySelector("#mapImageInput");
  const adjustGrid = document.querySelector("#adjustGrid");
  const showGrid = document.querySelector("#showGrid");
  const gridOpacity = document.querySelector("#gridOpacity");
  const mapFitMode = document.querySelector("#mapFitMode");
  const tokenSize = document.querySelector("#tokenSize");
  const feetPerSquareInput = document.querySelector("#feetPerSquare");
  const toggleFog = document.querySelector("#toggleFog");
  const clearMapImage = document.querySelector("#clearMapImage");
  const mapSettingsToggle = document.querySelector("#mapSettingsToggle");
  const mapToolbarSecondary = document.querySelector("#mapToolbarSecondary");
  const sideTabPlay = document.querySelector("#sideTabPlay");
  const sideTabSetup = document.querySelector("#sideTabSetup");
  const sideGroupPlay = document.querySelector("#sideGroupPlay");
  const sideGroupSetup = document.querySelector("#sideGroupSetup");
  const createCharacterForm = document.querySelector("#createCharacterForm");
  const createCharacterButton = document.querySelector("#createCharacterButton");
  const createCharacterStatus = document.querySelector("#createCharacterStatus");
  const ccName = document.querySelector("#ccName");
  const ccRace = document.querySelector("#ccRace");
  const ccClass = document.querySelector("#ccClass");
  const ccLevel = document.querySelector("#ccLevel");
  const ccBackground = document.querySelector("#ccBackground");
  const ccAlignment = document.querySelector("#ccAlignment");
  const ccStandardArray = document.querySelector("#ccStandardArray");
  const ccRollScores = document.querySelector("#ccRollScores");
  const ccStr = document.querySelector("#ccStr");
  const ccDex = document.querySelector("#ccDex");
  const ccCon = document.querySelector("#ccCon");
  const ccInt = document.querySelector("#ccInt");
  const ccWis = document.querySelector("#ccWis");
  const ccCha = document.querySelector("#ccCha");
  const ccAc = document.querySelector("#ccAc");
  const ccSpeed = document.querySelector("#ccSpeed");
  const ccWeaponName = document.querySelector("#ccWeaponName");
  const ccWeaponDice = document.querySelector("#ccWeaponDice");
  const ccWeaponAbility = document.querySelector("#ccWeaponAbility");
  const ccSkillList = document.querySelector("#ccSkillList");
  const ccLanguages = document.querySelector("#ccLanguages");
  const ccTools = document.querySelector("#ccTools");
  const ccFeatures = document.querySelector("#ccFeatures");
  const ccIsCaster = document.querySelector("#ccIsCaster");
  const ccSpellFields = document.querySelector("#ccSpellFields");
  const ccSpellAbility = document.querySelector("#ccSpellAbility");
  const ccSpellsKnown = document.querySelector("#ccSpellsKnown");
  const ccEquipment = document.querySelector("#ccEquipment");
  const ccTraits = document.querySelector("#ccTraits");
  const ccIdeals = document.querySelector("#ccIdeals");
  const ccBonds = document.querySelector("#ccBonds");
  const ccFlaws = document.querySelector("#ccFlaws");
  const ccBackstory = document.querySelector("#ccBackstory");
  const legacyPrototypeMaps = new Set(["The Standing Ring", "Bear Cave", "Urskelde Road"]);

  let preferences = loadPreferences();
  let state = loadEncounter();
  let campaign = loadCampaign();
  let selectedCampaignItemId = preferences.selectedCampaignItemId || null;
  let gridAdjusting = false;
  let mapSettingsOpen = false;
  let gridDrag = null;
  let suppressGridClick = false;
  let dmBridgeDirHandle = null;
  let tokensFolderHandle = null;
  let tokensFolderIndex = []; // [{ name, key, handle }] -- metadata only, no bytes read yet
  let mapsFolderHandle = null;
  let mapsFolderIndex = [];
  let dmBridgePendingId = null;
  let dmBridgePollTimer = null;
  let dmBridgeTimeoutHandle = null;
  const dmBridgeResponseTimeoutMs = 20000;
  let dmBridgeContext = null;
  let sessionTranscript = loadSessionTranscript();
  let endSessionPendingId = null;
  let endSessionTimeoutHandle = null;
  let endSessionPollTimer = null;
  const endSessionResponseTimeoutMs = 120000;
  let createCharacterPendingId = null;
  let createCharacterTimeoutHandle = null;
  let createCharacterPollTimer = null;
  const createCharacterResponseTimeoutMs = 20000;
  campaignSearch.value = preferences.search || "";
  campaignFilter.value = preferences.filter || "all";
  showTemplates.checked = Boolean(preferences.showTemplates);

  function setSideTab(tab) {
    const isSetup = tab === "setup";
    sideGroupPlay.hidden = isSetup;
    sideGroupSetup.hidden = !isSetup;
    sideTabPlay.classList.toggle("active", !isSetup);
    sideTabSetup.classList.toggle("active", isSetup);
    sideTabPlay.setAttribute("aria-selected", String(!isSetup));
    sideTabSetup.setAttribute("aria-selected", String(isSetup));
  }

  setSideTab(preferences.sideTab === "setup" ? "setup" : "play");

  sideTabPlay.addEventListener("click", () => {
    setSideTab("play");
    savePreferences();
  });

  sideTabSetup.addEventListener("click", () => {
    setSideTab("setup");
    savePreferences();
  });

  // --- Create Character -----------------------------------------------------------
  //
  // Builds a brand-new level-appropriate 5e character sheet (engine/characterCreator.js
  // does the actual math/markdown) and writes it into the DnD campaign repo's
  // characters/ folder through the DM bridge -- a deterministic file write handled
  // directly by dm-bridge/watch.js, not a Claude call (the sheet is already fully
  // computed here; there's nothing left to draft). Requires the DM bridge folder to be
  // connected and DND_REPO_PATH to be set when the watcher was started, same as End
  // Session.

  ccClass.innerHTML = window.CampaignOSCharacterCreator.CLASS_LIST
    .map((name) => `<option value="${name}">${name}</option>`).join("");
  ccClass.value = "Fighter";

  ccSkillList.innerHTML = window.CampaignOSCharacterCreator.SKILL_LIST.map((skill) => `
    <label class="cc-skill">
      <input type="checkbox" value="${escapeAttribute(skill.name)}">
      ${escapeHtml(skill.name)} <span>(${skill.ability})</span>
    </label>
  `).join("");

  ccIsCaster.addEventListener("change", () => {
    ccSpellFields.hidden = !ccIsCaster.checked;
  });

  ccStandardArray.addEventListener("click", () => {
    const [str, dex, con, int, wis, cha] = [15, 14, 13, 12, 10, 8];
    ccStr.value = str; ccDex.value = dex; ccCon.value = con;
    ccInt.value = int; ccWis.value = wis; ccCha.value = cha;
  });

  function rollAbilityScore() {
    const rolls = [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
    return rolls[1] + rolls[2] + rolls[3]; // drop the lowest of the four
  }

  ccRollScores.addEventListener("click", () => {
    ccStr.value = rollAbilityScore();
    ccDex.value = rollAbilityScore();
    ccCon.value = rollAbilityScore();
    ccInt.value = rollAbilityScore();
    ccWis.value = rollAbilityScore();
    ccCha.value = rollAbilityScore();
  });

  function characterDraftFromForm() {
    const proficientSkills = Array.from(ccSkillList.querySelectorAll("input[type=checkbox]:checked"))
      .map((input) => input.value);
    return {
      name: ccName.value,
      race: ccRace.value,
      className: ccClass.value,
      level: ccLevel.value,
      background: ccBackground.value,
      alignment: ccAlignment.value,
      abilityScores: { STR: ccStr.value, DEX: ccDex.value, CON: ccCon.value, INT: ccInt.value, WIS: ccWis.value, CHA: ccCha.value },
      ac: ccAc.value,
      speed: ccSpeed.value,
      proficientSkills,
      languages: ccLanguages.value,
      toolsWeaponsArmor: ccTools.value,
      features: ccFeatures.value,
      spellcasting: ccIsCaster.checked ? {
        isCaster: true,
        ability: ccSpellAbility.value,
        spellsKnown: ccSpellsKnown.value
      } : null,
      equipment: ccEquipment.value,
      personality: { traits: ccTraits.value, ideals: ccIdeals.value, bonds: ccBonds.value, flaws: ccFlaws.value },
      backstory: ccBackstory.value,
      attack: { weaponName: ccWeaponName.value, diceSize: ccWeaponDice.value, ability: ccWeaponAbility.value }
    };
  }

  createCharacterForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const draft = characterDraftFromForm();
    const errors = window.CampaignOSCharacterCreator.validateDraft(draft);
    if (errors.length) {
      createCharacterStatus.textContent = errors.join(" ");
      return;
    }

    if (!dmBridgeDirHandle) {
      createCharacterStatus.textContent = "Connect to Claude Code first (Claude DM panel, Play tab) -- character files are written through the same DM bridge folder.";
      return;
    }

    const character = window.CampaignOSCharacterCreator.computeCharacter(draft);
    const markdown = window.CampaignOSCharacterCreator.characterMarkdown(character);
    const fileName = window.CampaignOSCharacterCreator.fileNameForCharacter(character.name);

    const id = `char-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await writeBridgeJson("create-character-request.json", { id, fileName, markdown, createdAt: new Date().toISOString() });
    } catch (err) {
      createCharacterStatus.textContent = `Could not write to the DM bridge folder: ${err.message}`;
      return;
    }

    createCharacterPendingId = id;
    createCharacterButton.disabled = true;
    createCharacterStatus.textContent = `Writing characters/${fileName}...`;
    startCreateCharacterPolling();

    clearTimeout(createCharacterTimeoutHandle);
    createCharacterTimeoutHandle = setTimeout(() => {
      if (createCharacterPendingId !== id) return;
      createCharacterPendingId = null;
      createCharacterButton.disabled = false;
      createCharacterStatus.textContent = "No response after 20s -- make sure `node dm-bridge/watch.js` is running, then try again.";
    }, createCharacterResponseTimeoutMs);
  });

  function startCreateCharacterPolling() {
    if (createCharacterPollTimer) return;
    createCharacterPollTimer = setInterval(checkCreateCharacterResponse, 1500);
  }

  async function checkCreateCharacterResponse() {
    if (!dmBridgeDirHandle || !createCharacterPendingId) return;
    let response;
    try {
      response = await readBridgeJson("create-character-response.json");
    } catch {
      return;
    }
    if (!response || response.id !== createCharacterPendingId) return;

    clearTimeout(createCharacterTimeoutHandle);
    createCharacterPendingId = null;
    createCharacterButton.disabled = false;
    createCharacterStatus.textContent = response.ok
      ? `${response.message} Re-import the campaign folder (above) to see it in the browser.`
      : (response.message || "Something went wrong.");
  }

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
    renderTurnTracker();
    renderInitiative();
    renderTokenSheet();
    renderCombatLog();
    renderCampaign();
  }

  // Both libraries are pure IndexedDB state with no dependency on the encounter (`state`)
  // at all, so unlike everything else in render(), they deliberately do NOT get refreshed
  // on every render() call -- render() runs after nearly every interaction (a token move, a
  // damage button), and re-fetching + re-decoding every saved image on every one of those
  // was real, compounding overhead. These are called once at boot and again after whatever
  // specifically changes the library (add/delete) -- see their call sites below.
  const LIBRARY_THUMBNAIL_LIMIT = 40;

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
      entries.forEach((entry, index) => {
        const row = document.createElement("div");
        row.className = "library-item";
        row.innerHTML = `
          <span></span>
          <span>${escapeHtml(entry.displayName)}</span>
          <button type="button" data-key="${escapeAttribute(entry.key)}">Remove</button>
        `;
        // Rendering an <img> means the browser decodes it into a full bitmap -- fine for a
        // handful of entries, but doing that for hundreds at once (a bulk-imported asset
        // pack) is exactly what can crash the tab. Past the limit, list by name only (the
        // Remove button still works); metadata alone (listEntries) never touches image
        // bytes at all, so this cap is purely about DOM/decode cost, not IndexedDB cost.
        if (index < LIBRARY_THUMBNAIL_LIMIT) {
          window.CampaignOSTokenLibrary.getImage(entry.key).then((image) => {
            if (image) row.querySelector("span").outerHTML = `<img src="${image}" alt="">`;
          });
        }
        row.querySelector("button").addEventListener("click", () => {
          window.CampaignOSTokenLibrary.deleteEntry(entry.key).then(renderTokenLibrary);
        });
        libraryList.appendChild(row);
      });
      if (entries.length > LIBRARY_THUMBNAIL_LIMIT) {
        const note = document.createElement("p");
        note.className = "library-empty";
        note.textContent = `+${entries.length - LIBRARY_THUMBNAIL_LIMIT} more (thumbnails hidden past ${LIBRARY_THUMBNAIL_LIMIT} to save memory).`;
        libraryList.appendChild(note);
      }
    });
  }

  function renderMapLibrary() {
    window.CampaignOSMapLibrary.listEntries().then((entries) => {
      mapLibraryList.innerHTML = "";
      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "library-empty";
        empty.textContent = "No maps saved yet.";
        mapLibraryList.appendChild(empty);
        return;
      }
      entries.forEach((entry, index) => {
        const row = document.createElement("div");
        row.className = "library-item map-library-item";
        row.innerHTML = `
          <span></span>
          <span>${escapeHtml(entry.displayName)}</span>
          <button type="button" data-action="use">Use</button>
          <button type="button" data-action="remove">Remove</button>
        `;
        if (index < LIBRARY_THUMBNAIL_LIMIT) {
          window.CampaignOSMapLibrary.getImage(entry.key).then((image) => {
            if (image) row.querySelector("span").outerHTML = `<img src="${image}" alt="">`;
          });
        }
        row.querySelector('[data-action="use"]').addEventListener("click", () => useMapLibraryEntry(entry));
        row.querySelector('[data-action="remove"]').addEventListener("click", () => {
          window.CampaignOSMapLibrary.deleteEntry(entry.key).then(renderMapLibrary);
        });
        mapLibraryList.appendChild(row);
      });
      if (entries.length > LIBRARY_THUMBNAIL_LIMIT) {
        const note = document.createElement("p");
        note.className = "library-empty";
        note.textContent = `+${entries.length - LIBRARY_THUMBNAIL_LIMIT} more (thumbnails hidden past ${LIBRARY_THUMBNAIL_LIMIT} to save memory).`;
        mapLibraryList.appendChild(note);
      }
    });
  }

  // Loads a saved Map Library entry as the active map: creates a map with that name if it
  // doesn't exist yet (same as picking a file directly always has), or replaces the art on
  // an existing map of that name. Fetches this one entry's actual image bytes now (the
  // rendered list only ever carried metadata) and copies them into the shared image store
  // under a fresh key, exactly like a direct file upload does -- the encounter state only
  // ever holds that short key, never the raw image data.
  async function useMapLibraryEntry(entry) {
    const mapName = entry.displayName;
    const image = await window.CampaignOSMapLibrary.getImage(entry.key);
    if (!image) {
      commandResult.textContent = `Couldn't find stored art for "${mapName}".`;
      return;
    }
    const previousKey = state.maps?.[mapName]?.image;
    const key = window.CampaignOSImageStore.generateKey("map");
    await window.CampaignOSImageStore.saveImage(key, image);
    if (previousKey && !previousKey.startsWith("data:")) {
      window.CampaignOSImageStore.deleteImage(previousKey).catch(() => {});
    }
    setActiveMap(mapName);
    updateState(window.CampaignOS.setMapImage(state, mapName, key, {
      aspectRatio: entry.aspectRatio || "12 / 8"
    }));
    commandResult.textContent = `${mapName} loaded from the map library.`;
  }

  // Attaches library art (matched by name) to any token that doesn't already have an
  // image -- called after every action that can add tokens to the map (manual spawn,
  // adding an imported character, and Claude DM bridge actions), so art shows up the
  // same way no matter which path created the token. The library keeps its own copy of
  // the art in its own IndexedDB store; this saves a fresh copy under a per-token key
  // in the shared image store rather than writing the raw data URL onto the token, for
  // the same reason map images moved off inline base64 (keeps the localStorage-
  // persisted encounter state small).
  async function applyLibraryImages(sourceState) {
    let nextState = sourceState;
    let changed = false;
    for (const token of sourceState.tokens) {
      if (token.image) continue;
      let libraryImage = await window.CampaignOSTokenLibrary.findImage(token.name);
      let fromFolder = false;
      // Fall back to the connected Tokens folder (if any) only when the manually-saved
      // Token Library has no match -- reads exactly one file, never the whole folder.
      if (!libraryImage && tokensFolderIndex.length) {
        const entry = window.CampaignOSFolderAssets.findInIndex(tokensFolderIndex, token.name, window.CampaignOSTokenLibrary.normalizeName);
        if (entry) {
          libraryImage = await window.CampaignOSFolderAssets.readEntryAsDataUrl(entry);
          fromFolder = true;
        }
      }
      if (libraryImage) {
        // Folder-sourced art hasn't been through the Token Library's own add-form (which
        // downscales before saving) -- do it here so a full-resolution source file doesn't
        // get copied into the image store as-is.
        const finalImage = fromFolder ? (await resizeImageDataUrl(libraryImage, 512, "image/png")).dataUrl : libraryImage;
        const key = window.CampaignOSImageStore.generateKey("token");
        await window.CampaignOSImageStore.saveImage(key, finalImage);
        nextState = window.CampaignOS.updateToken(nextState, token.id, { image: key });
        changed = true;
      }
    }
    return { state: nextState, changed };
  }

  const resolvedImageCache = new Map();

  // Shared resolver for any stored `image` field (map or token) -- these are now
  // ui/imageStore.js keys rather than raw data URLs. Also transparently handles a
  // pre-migration value that's still raw inline base64 (starts with "data:").
  function resolveStoredImage(imageValue) {
    if (!imageValue) return Promise.resolve("");
    if (imageValue.startsWith("data:")) return Promise.resolve(imageValue);
    if (resolvedImageCache.has(imageValue)) return Promise.resolve(resolvedImageCache.get(imageValue));
    return window.CampaignOSImageStore.loadImage(imageValue).then((dataUrl) => {
      resolvedImageCache.set(imageValue, dataUrl || "");
      return dataUrl || "";
    });
  }

  async function migrateLegacyTokenImage(tokenId, dataUrl) {
    const key = window.CampaignOSImageStore.generateKey("token");
    await window.CampaignOSImageStore.saveImage(key, dataUrl);
    state = window.CampaignOS.updateToken(state, tokenId, { image: key });
    saveEncounter();
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
        tokenButton.classList.add("has-image");
        if (token.image.startsWith("data:")) {
          tokenButton.style.backgroundImage = `url("${token.image}")`;
          migrateLegacyTokenImage(token.id, token.image);
        } else {
          resolveStoredImage(token.image).then((dataUrl) => {
            if (dataUrl) tokenButton.style.backgroundImage = `url("${dataUrl}")`;
            else tokenButton.classList.remove("has-image");
          });
        }
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
    feetPerSquareInput.value = settings.feetPerSquare;
    tokenSize.value = settings.tokenSize;
  }

  function renderTurnTracker() {
    const activeTokenId = state.turn?.tokenId;
    const activeToken = activeTokenId ? activeTokens().find((token) => token.id === activeTokenId) : null;
    turnStatus.textContent = activeToken
      ? `Round ${state.turn.round} — ${activeToken.name}'s turn`
      : "No active turn";
  }

  function renderInitiative() {
    initiativeList.innerHTML = "";
    const activeTokenId = state.turn?.tokenId;
    window.CampaignOS.sortByInitiative(activeTokens()).forEach((token) => {
      const item = document.createElement("li");
      const classes = [];
      if (token.id === state.selectedTokenId) classes.push("active");
      if (token.id === activeTokenId) classes.push("current-turn");
      item.className = classes.join(" ");
      const movementNote = token.id === activeTokenId
        ? `<small>${Math.max(0, (token.speed ?? 30) - (token.movementUsed || 0))} ft left</small>`
        : "";
      item.innerHTML = `<button type="button" data-id="${token.id}"><span>${token.name}</span>${movementNote}<strong>${token.initiative}</strong></button>`;
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
        <div class="portrait-preview">${token.image ? `<img data-portrait-image alt="">` : `<span>${escapeHtml(token.icon)}</span>`}</div>
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
        <div class="stat-grid">
          <label>
            Speed (ft)
            <input name="speed" type="number" min="0" max="999" value="${token.speed ?? 30}">
          </label>
          <label>
            Moved (ft)
            <input value="${token.movementUsed || 0} / ${token.speed ?? 30}" disabled>
          </label>
        </div>
        <button type="submit">Update</button>
      </form>
      <form class="attack-control">
        <label>
          Target
          <select name="targetId"></select>
        </label>
        <label>
          Roll
          <select name="mode">
            <option value="normal">Normal</option>
            <option value="advantage">Advantage</option>
            <option value="disadvantage">Disadvantage</option>
          </select>
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

    const portraitImg = tokenSheet.querySelector("img[data-portrait-image]");
    if (portraitImg) {
      resolveStoredImage(token.image).then((dataUrl) => {
        if (dataUrl) portraitImg.src = dataUrl;
      });
    }

    const editor = tokenSheet.querySelector(".token-editor");
    const imageInput = tokenSheet.querySelector('input[name="image"]');
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files[0];
      if (!file) return;
      const raw = await readFileAsDataUrl(file);
      const resized = await resizeImageDataUrl(raw, 512, "image/png");
      const previousKey = token.image;
      const key = window.CampaignOSImageStore.generateKey("token");
      await window.CampaignOSImageStore.saveImage(key, resized.dataUrl);
      if (previousKey && !previousKey.startsWith("data:")) {
        window.CampaignOSImageStore.deleteImage(previousKey).catch(() => {});
      }
      updateState(window.CampaignOS.updateToken(state, token.id, { image: key }));
    });
    const clearImageButton = tokenSheet.querySelector('[data-action="clear-image"]');
    if (clearImageButton) {
      clearImageButton.addEventListener("click", () => {
        const previousKey = token.image;
        if (previousKey && !previousKey.startsWith("data:")) {
          window.CampaignOSImageStore.deleteImage(previousKey).catch(() => {});
        }
        updateState(window.CampaignOS.updateToken(state, token.id, { image: "" }));
      });
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
        damageDice: form.get("damageDice"),
        speed: form.get("speed")
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
      const formData = new FormData(attackControl);
      const targetId = formData.get("targetId");
      const mode = formData.get("mode");
      const result = window.CampaignOS.attack(state, token.id, targetId, {
        advantage: mode === "advantage",
        disadvantage: mode === "disadvantage"
      });
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

  // Session/notes context so Claude DM knows the actual story (an NPC, a prior
  // session, a plot thread) rather than only ever seeing live token stats and
  // whatever the DM happens to type in the command box. Stays attached across
  // multiple commands until cleared -- most DM turns reference the same scene.
  const dmBridgeContextMaxChars = 6000;

  function useCampaignContext(item) {
    dmBridgeContext = { title: item.title, text: item.text || item.summary || "" };
    commandResult.textContent = `"${item.title}" attached as DM context -- type a command and hit Run.`;
    renderDMBridgeContext();
  }

  function renderDMBridgeContext() {
    if (!dmBridgeContext) {
      dmBridgeContextRow.hidden = true;
      return;
    }
    dmBridgeContextRow.hidden = false;
    dmBridgeContextLabel.textContent = dmBridgeContext.title;
  }

  dmBridgeContextClear.addEventListener("click", () => {
    dmBridgeContext = null;
    renderDMBridgeContext();
    commandResult.textContent = "DM context cleared.";
  });

  // "End Session" write-back: hands this session's full transcript (not just the
  // UI's 12-entry combat log) and final token states to the watcher, which asks a
  // real Claude Code invocation -- with actual Read/Write/Edit access to the DnD
  // campaign repo (see DND_REPO_PATH in dm-bridge/watch.js) -- to draft a session-log
  // entry and world-state.md updates in the campaign's existing narrative style.
  // File changes only: nothing is committed or pushed, so the DM reviews the diff
  // and commits it themselves same as any other campaign-repo edit.
  endSessionButton.addEventListener("click", async () => {
    if (!dmBridgeDirHandle) {
      endSessionStatus.textContent = "Connect to Claude Code first (see the button above).";
      return;
    }
    if (!sessionTranscript.length) {
      endSessionStatus.textContent = "Nothing recorded yet this session -- run a few commands first.";
      return;
    }

    const id = `end-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id,
      transcript: sessionTranscript.map((entry) => entry.text),
      contextTitle: dmBridgeContext?.title || null,
      finalState: {
        mapName: state.mapName,
        tokens: state.tokens.map((token) => ({
          name: token.name,
          type: token.type,
          mapName: token.mapName,
          hp: token.hp,
          maxHp: token.maxHp,
          ac: token.ac,
          conditions: token.conditions
        }))
      },
      createdAt: new Date().toISOString()
    };

    try {
      await writeBridgeJson("end-session-request.json", payload);
    } catch (err) {
      endSessionStatus.textContent = `Could not write to the DM bridge folder: ${err.message}`;
      return;
    }

    endSessionPendingId = id;
    endSessionButton.disabled = true;
    endSessionStatus.textContent = "Ending session -- Claude is updating the campaign repo's files (this can take a minute)...";
    startEndSessionPolling();

    clearTimeout(endSessionTimeoutHandle);
    endSessionTimeoutHandle = setTimeout(() => {
      if (endSessionPendingId !== id) return;
      endSessionPendingId = null;
      endSessionButton.disabled = false;
      endSessionStatus.textContent = "No response after 2 minutes -- check the watcher is running and DND_REPO_PATH is set, then try again.";
    }, endSessionResponseTimeoutMs);
  });

  function startEndSessionPolling() {
    if (endSessionPollTimer) return;
    endSessionPollTimer = setInterval(checkEndSessionResponse, 1500);
  }

  async function checkEndSessionResponse() {
    if (!dmBridgeDirHandle || !endSessionPendingId) return;
    let response;
    try {
      response = await readBridgeJson("end-session-response.json");
    } catch {
      return;
    }
    if (!response || response.id !== endSessionPendingId) return;

    clearTimeout(endSessionTimeoutHandle);
    endSessionPendingId = null;
    endSessionButton.disabled = false;

    if (response.ok) {
      clearSessionTranscript();
    }
    endSessionStatus.textContent = response.message || "Done.";
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

  // Downscales an image data URL if it exceeds maxDimension on its longest side, and always
  // returns the resulting natural width/height. An already-small image is returned
  // untouched (no lossy re-encode for no reason). Converting a big batch of full-resolution
  // source images (a commercial battle map pack, a bulk token import) to base64 and decoding
  // each one with no size cap is what crashes the tab with "Out of Memory" -- capping
  // dimensions here bounds both the import itself and long-term IndexedDB storage.
  function resizeImageDataUrl(dataUrl, maxDimension, mimeType, quality) {
    return new Promise((resolve) => {
      const image = new Image();
      image.addEventListener("load", () => {
        const width = image.naturalWidth || 1;
        const height = image.naturalHeight || 1;
        const scale = maxDimension / Math.max(width, height);
        if (scale >= 1) {
          resolve({ dataUrl, width, height });
          return;
        }
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        canvas.getContext("2d").drawImage(image, 0, 0, targetWidth, targetHeight);
        resolve({ dataUrl: canvas.toDataURL(mimeType, quality), width: targetWidth, height: targetHeight });
      });
      image.addEventListener("error", () => resolve({ dataUrl, width: 12, height: 8 }));
      image.src = dataUrl;
    });
  }

  // Blocks the browser's native file-selection UI, so it's fine to call before doing any
  // work -- if the DM cancels, nothing has been read into memory yet.
  function confirmLargeBatch(count, label) {
    if (count <= 50) return true;
    return window.confirm(`You selected ${count} ${label}. Adding that many at once can take a while and use significant storage -- continue?`);
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

    // moveToken only enforces speed when `token` is the active turn's token (state.turn) --
    // otherwise this behaves exactly like the old unconstrained click-to-move.
    const result = window.CampaignOS.moveToken(state, token.id, x, y);
    if (result.state === state) {
      commandResult.textContent = result.message;
      return;
    }

    commandResult.textContent = result.message;
    updateState(result.state);
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
    recordTranscript(`DM: ${commandInput.value}`);
    recordTranscript(result.message);
    commandResult.textContent = result.message;
    render();
  });

  libraryAddForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const files = Array.from(libraryImageInput.files);
    if (!files.length) return;
    if (!confirmLargeBatch(files.length, "token images")) return;

    const typedName = libraryName.value.trim();
    // A typed name only makes sense for a single file -- with several files selected
    // at once, each one gets its own name derived from its filename instead.
    const useTypedName = files.length === 1 && typedName;

    try {
      for (const file of files) {
        const name = useTypedName ? typedName : nameFromFileName(file.name);
        const raw = await readFileAsDataUrl(file);
        // Tokens display small (a circular portrait), so 512px is plenty; PNG keeps
        // transparency for portraits that use it.
        const resized = await resizeImageDataUrl(raw, 512, "image/png");
        await window.CampaignOSTokenLibrary.saveEntry(name, resized.dataUrl);
      }
    } catch (error) {
      commandResult.textContent = `Couldn't add to the token library: ${error?.message || error}`;
      return;
    }

    commandResult.textContent = files.length === 1
      ? `Added "${useTypedName ? typedName : nameFromFileName(files[0].name)}" to the token library.`
      : `Added ${files.length} tokens to the library from their filenames.`;
    libraryAddForm.reset();
    renderTokenLibrary();
  });

  mapLibraryAddForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const files = Array.from(mapLibraryImageInput.files);
    if (!files.length) return;
    if (!confirmLargeBatch(files.length, "map images")) return;

    const typedName = mapLibraryName.value.trim();
    const useTypedName = files.length === 1 && typedName;

    try {
      for (const file of files) {
        const name = useTypedName ? typedName : nameFromFileName(file.name);
        const raw = await readFileAsDataUrl(file);
        // 1600px is far more than a battle map needs to look sharp on a VTT grid, and
        // JPEG at 0.85 quality keeps a full commercial map pack from ballooning storage
        // (and the import itself from spiking memory) the way full-resolution PNGs do.
        const resized = await resizeImageDataUrl(raw, 1600, "image/jpeg", 0.85);
        await window.CampaignOSMapLibrary.saveEntry(name, resized.dataUrl, `${resized.width} / ${resized.height}`);
      }
    } catch (error) {
      commandResult.textContent = `Couldn't add to the map library: ${error?.message || error}`;
      return;
    }

    commandResult.textContent = files.length === 1
      ? `Added "${useTypedName ? typedName : nameFromFileName(files[0].name)}" to the map library.`
      : `Added ${files.length} maps to the library from their filenames.`;
    mapLibraryAddForm.reset();
    renderMapLibrary();
  });

  libraryClearAll.addEventListener("click", () => {
    if (!window.confirm("Remove every saved token art entry? This can't be undone.")) return;
    window.CampaignOSTokenLibrary.clearAll().then(() => {
      commandResult.textContent = "Token library cleared.";
      renderTokenLibrary();
    });
  });

  mapLibraryClearAll.addEventListener("click", () => {
    if (!window.confirm("Remove every saved map library entry? This can't be undone.")) return;
    window.CampaignOSMapLibrary.clearAll().then(() => {
      commandResult.textContent = "Map library cleared.";
      renderMapLibrary();
    });
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

  // Shared connect flow for the Maps/Tokens folders -- same re-grant-then-repick pattern as
  // the DM bridge connect handler above, but read-only (these folders are never written to).
  async function connectAssetFolder(kind, statusEl) {
    if (!window.showDirectoryPicker) {
      statusEl.textContent = "Not supported in this browser -- use Chrome or Edge.";
      return null;
    }
    let handle = await window.CampaignOSAssetFolders.loadHandle(kind).catch(() => null);
    if (handle) {
      const permission = await handle.requestPermission({ mode: "read" }).catch(() => "denied");
      if (permission !== "granted") handle = null;
    }
    if (!handle) {
      handle = await window.showDirectoryPicker({ id: `campaign-os-${kind}-folder`, mode: "read" });
      await window.CampaignOSAssetFolders.saveHandle(kind, handle);
    }
    return handle;
  }

  tokenFolderConnect.addEventListener("click", async () => {
    try {
      const handle = await connectAssetFolder("tokens", tokenFolderStatus);
      if (handle) await indexTokensFolder(handle);
    } catch (err) {
      if (err.name !== "AbortError") tokenFolderStatus.textContent = `Connection failed: ${err.message}`;
    }
  });

  async function indexTokensFolder(handle) {
    tokensFolderHandle = handle;
    tokenFolderStatus.textContent = `Indexing "${handle.name}"...`;
    tokenFolderStatus.classList.remove("connected");
    tokensFolderIndex = await window.CampaignOSFolderAssets.indexFolder(handle, window.CampaignOSTokenLibrary.normalizeName);
    tokenFolderStatus.textContent = `Connected to "${handle.name}" -- ${tokensFolderIndex.length} images indexed.`;
    tokenFolderStatus.classList.add("connected");
  }

  mapFolderConnect.addEventListener("click", async () => {
    try {
      const handle = await connectAssetFolder("maps", mapFolderStatus);
      if (handle) await indexMapsFolder(handle);
    } catch (err) {
      if (err.name !== "AbortError") mapFolderStatus.textContent = `Connection failed: ${err.message}`;
    }
  });

  async function indexMapsFolder(handle) {
    mapsFolderHandle = handle;
    mapFolderStatus.textContent = `Indexing "${handle.name}"...`;
    mapFolderStatus.classList.remove("connected");
    mapFolderSearch.disabled = true;
    mapsFolderIndex = await window.CampaignOSFolderAssets.indexFolder(handle, window.CampaignOSMapLibrary.normalizeName);
    mapFolderStatus.textContent = `Connected to "${handle.name}" -- ${mapsFolderIndex.length} maps indexed.`;
    mapFolderStatus.classList.add("connected");
    mapFolderSearch.disabled = false;
    renderMapFolderResults();
  }

  // Runs once at startup, same silent-reconnect-if-still-granted pattern as
  // tryRestoreDMBridge -- no permission prompt without a user gesture behind it.
  async function tryRestoreAssetFolders() {
    if (!window.showDirectoryPicker) return;

    const tokenHandle = await window.CampaignOSAssetFolders.loadHandle("tokens").catch(() => null);
    if (tokenHandle) {
      const permission = await tokenHandle.queryPermission({ mode: "read" }).catch(() => "denied");
      if (permission === "granted") await indexTokensFolder(tokenHandle);
      else tokenFolderStatus.textContent = `Previously connected to "${tokenHandle.name}" -- click Connect to re-grant access.`;
    }

    const mapHandle = await window.CampaignOSAssetFolders.loadHandle("maps").catch(() => null);
    if (mapHandle) {
      const permission = await mapHandle.queryPermission({ mode: "read" }).catch(() => "denied");
      if (permission === "granted") await indexMapsFolder(mapHandle);
      else mapFolderStatus.textContent = `Previously connected to "${mapHandle.name}" -- click Connect to re-grant access.`;
    }
  }

  const MAP_FOLDER_RESULTS_LIMIT = 50;

  function renderMapFolderResults() {
    mapFolderResults.innerHTML = "";
    if (!mapsFolderIndex.length) return;

    const query = mapFolderSearch.value.trim().toLowerCase();
    const matches = query
      ? mapsFolderIndex.filter((entry) => entry.name.toLowerCase().includes(query))
      : mapsFolderIndex.slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAP_FOLDER_RESULTS_LIMIT);

    if (!query) {
      const hint = document.createElement("p");
      hint.className = "library-empty";
      hint.textContent = `Showing the first ${Math.min(MAP_FOLDER_RESULTS_LIMIT, mapsFolderIndex.length)} of ${mapsFolderIndex.length} -- type to search.`;
      mapFolderResults.appendChild(hint);
    } else if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "library-empty";
      empty.textContent = "No matches.";
      mapFolderResults.appendChild(empty);
      return;
    }

    matches.slice(0, MAP_FOLDER_RESULTS_LIMIT).forEach((entry) => {
      const row = document.createElement("div");
      row.className = "library-item map-library-item";
      row.innerHTML = `
        <span></span>
        <span>${escapeHtml(entry.name)}</span>
        <button type="button" data-action="use">Use</button>
      `;
      row.querySelector('[data-action="use"]').addEventListener("click", () => useMapFolderEntry(entry));
      mapFolderResults.appendChild(row);
    });
  }

  mapFolderSearch.addEventListener("input", renderMapFolderResults);

  // Reads exactly one file from the connected Maps folder (nothing else in it) and loads it
  // as the active map -- same downscale-then-store flow as a direct upload or the manual Map
  // Library's "Use", just sourced from the live folder handle instead of a saved copy.
  async function useMapFolderEntry(entry) {
    const mapName = entry.name;
    const raw = await window.CampaignOSFolderAssets.readEntryAsDataUrl(entry);
    const resized = await resizeImageDataUrl(raw, 1600, "image/jpeg", 0.85);
    const previousKey = state.maps?.[mapName]?.image;
    const key = window.CampaignOSImageStore.generateKey("map");
    await window.CampaignOSImageStore.saveImage(key, resized.dataUrl);
    if (previousKey && !previousKey.startsWith("data:")) {
      window.CampaignOSImageStore.deleteImage(previousKey).catch(() => {});
    }
    setActiveMap(mapName);
    updateState(window.CampaignOS.setMapImage(state, mapName, key, {
      aspectRatio: `${resized.width} / ${resized.height}`,
      sourcePath: `Maps folder/${entry.name}`
    }));
    commandResult.textContent = `${mapName} loaded from the Maps folder.`;
  }

  async function sendDMBridgeCommand(command) {
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      id,
      command,
      context: dmBridgeContext
        ? { title: dmBridgeContext.title, text: dmBridgeContext.text.slice(0, dmBridgeContextMaxChars) }
        : null,
      state: {
        mapName: state.mapName,
        grid: window.CampaignOS.currentGrid(state),
        round: state.turn?.round || 0,
        activeToken: activeTokens().find((token) => token.id === state.turn?.tokenId)?.name || null,
        availableMaps: loadedMapNames().filter((name) => name !== state.mapName),
        tokens: activeTokens().map((token) => ({
          name: token.name,
          type: token.type,
          x: token.x,
          y: token.y,
          hp: token.hp,
          maxHp: token.maxHp,
          ac: token.ac,
          speed: token.speed ?? 30,
          movementLeft: Math.max(0, (token.speed ?? 30) - (token.movementUsed || 0)),
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

    recordTranscript(`DM: ${command}`);
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
    const { state: withActions, messages: actionMessages } = window.CampaignOSDMBridge.applyActions(state, response.actions || []);
    const enriched = await applyLibraryImages(withActions);
    state = enriched.state;
    saveEncounter();
    actionMessages.forEach(recordTranscript);
    recordTranscript(response.message);
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

  nextTurnButton.addEventListener("click", () => {
    if (!activeTokens().length) {
      commandResult.textContent = "No tokens on this map to run initiative for.";
      return;
    }
    updateState(window.CampaignOS.nextTurn(state));
  });

  mapSettingsToggle.addEventListener("click", () => {
    mapSettingsOpen = !mapSettingsOpen;
    mapToolbarSecondary.hidden = !mapSettingsOpen;
    mapSettingsToggle.classList.toggle("active-toggle", mapSettingsOpen);
  });

  mapImageInput.addEventListener("change", async () => {
    const file = mapImageInput.files[0];
    if (!file) return;
    const mapName = mapNameFromFile(file.name);
    const raw = await readFileAsDataUrl(file);
    const resized = await resizeImageDataUrl(raw, 1600, "image/jpeg", 0.85);
    const previousKey = state.maps?.[mapName]?.image;
    const key = window.CampaignOSImageStore.generateKey("map");
    await window.CampaignOSImageStore.saveImage(key, resized.dataUrl);
    if (previousKey && !previousKey.startsWith("data:")) {
      window.CampaignOSImageStore.deleteImage(previousKey).catch(() => {});
    }
    setActiveMap(mapName);
    updateState(window.CampaignOS.setMapImage(state, mapName, key, {
      sourceFileName: file.name,
      aspectRatio: `${resized.width} / ${resized.height}`
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
  feetPerSquareInput.addEventListener("change", updateMapView);

  mapSelect.addEventListener("change", () => {
    setActiveMap(mapSelect.value);
    saveEncounter();
    render();
  });

  function saveEncounter() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  // Everything worth remembering for the "End Session" write-back -- combat log lines
  // and Claude DM narration alike -- kept in its own uncapped store, since state.log
  // exists only for the UI's rolling 12-entry display and would lose most of a real
  // session's history long before the session ends.
  function recordTranscript(text) {
    if (!text) return;
    sessionTranscript.push({ at: new Date().toISOString(), text });
    localStorage.setItem(sessionTranscriptStorageKey, JSON.stringify(sessionTranscript));
  }

  function loadSessionTranscript() {
    try {
      const saved = JSON.parse(localStorage.getItem(sessionTranscriptStorageKey));
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function clearSessionTranscript() {
    sessionTranscript = [];
    localStorage.removeItem(sessionTranscriptStorageKey);
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
      tokenSize: tokenSize.value,
      feetPerSquare: feetPerSquareInput.value
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
      tokenSize: clampUiNumber(mapSettings.tokenSize, 78, 40, 100),
      feetPerSquare: clampUiNumber(mapSettings.feetPerSquare, 5, 1, 30)
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
      selectedCampaignItemId,
      sideTab: sideGroupSetup.hidden ? "play" : "setup"
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
  renderTokenLibrary();
  renderMapLibrary();
  tryRestoreDMBridge();
  tryRestoreAssetFolders();
})();
