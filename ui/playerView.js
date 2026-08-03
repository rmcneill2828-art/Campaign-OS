(function () {
  // Read-only mirror of the DM's board for a second, player-facing browser tab/window (a
  // second monitor, a TV) -- opened via index.html's "Open Player Window" button. No editing,
  // no DM panels, no campaign browser, no Claude DM bridge: just the map, tokens, initiative,
  // and combat log, kept in sync with the DM's tab.
  //
  // Sync is plain polling of localStorage, NOT BroadcastChannel or the 'storage' event --
  // verified via Playwright that neither fires across two tabs both opened from a file://
  // path (the app's normal, documented "just open index.html" usage): both tabs report the
  // same nominal location.origin ("file://"), but Chrome still treats them as unable to
  // notify each other. Direct localStorage/IndexedDB reads DO work across those same tabs
  // (same underlying storage partition), so polling every second and diffing the raw JSON
  // string against the last-seen value is the one approach that's actually reliable in this
  // app's real deployment environment -- the same reasoning (and the same interval) as every
  // other cross-context channel in this codebase (dm-bridge/watch.js's request/response
  // polling, ui/app.js's live-actions polling).
  const storageKey = "campaign-os-encounter-state";
  const map = document.querySelector("#battleMap");
  const mapNameEl = document.querySelector("#playerMapName");
  const syncStatusEl = document.querySelector("#playerSyncStatus");
  const turnStatusEl = document.querySelector("#playerTurnStatus");
  const initiativeListEl = document.querySelector("#playerInitiativeList");
  const combatLogEl = document.querySelector("#playerCombatLog");

  let lastRawState = null;
  let lastUpdateAt = null;
  let lastRenderedMapImageValue = undefined;
  const resolvedImageCache = new Map();

  function clampNum(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function currentMapSettings(state) {
    const mapSettings = state.maps?.[state.mapName] || {};
    return {
      image: mapSettings.image || "",
      aspectRatio: /^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/.test(mapSettings.aspectRatio || "") ? mapSettings.aspectRatio : "12 / 8",
      columns: clampNum(mapSettings.columns, 12, 4, 80),
      rows: clampNum(mapSettings.rows, 8, 4, 80),
      showGrid: mapSettings.showGrid !== false,
      gridOpacity: clampNum(mapSettings.gridOpacity, 35, 0, 100),
      fitMode: mapSettings.fitMode === "contain" ? "contain" : "cover",
      tokenSize: clampNum(mapSettings.tokenSize, 78, 40, 100)
    };
  }

  // Same imageStore key-vs-inline-data-URL resolution as ui/app.js's own resolveStoredImage --
  // imageStore itself (IndexedDB) is a plain, DOM-independent script safe to load into this
  // page as-is, so there's no need for a second image storage layer here.
  function resolveStoredImage(imageValue) {
    if (!imageValue) return Promise.resolve("");
    if (imageValue.startsWith("data:")) return Promise.resolve(imageValue);
    if (resolvedImageCache.has(imageValue)) return Promise.resolve(resolvedImageCache.get(imageValue));
    return window.CampaignOSImageStore.loadImage(imageValue).then((dataUrl) => {
      resolvedImageCache.set(imageValue, dataUrl || "");
      return dataUrl || "";
    });
  }

  function renderMapBackground(settings) {
    map.style.backgroundSize = settings.fitMode;
    map.style.backgroundRepeat = "no-repeat";
    const imageValue = settings.image || "";
    if (imageValue === lastRenderedMapImageValue) return;
    lastRenderedMapImageValue = imageValue;
    if (!imageValue) {
      map.style.backgroundImage = "";
      map.classList.remove("has-map-image");
      return;
    }
    resolveStoredImage(imageValue).then((dataUrl) => {
      if (!dataUrl) return;
      map.style.backgroundImage = `url("${dataUrl}")`;
      map.classList.add("has-map-image");
    });
  }

  function renderMapGrid(state, settings) {
    map.style.setProperty("--grid-columns", settings.columns);
    map.style.setProperty("--grid-rows", settings.rows);
    map.style.setProperty("--grid-opacity", settings.gridOpacity / 100);
    map.style.setProperty("--token-size", `${settings.tokenSize}%`);
    map.style.setProperty("--map-aspect-ratio", settings.aspectRatio);
    map.classList.toggle("grid-hidden", !settings.showGrid);

    // Fog of war -- the three-state model: never explored (solid, hides terrain and anything
    // on it), explored but not currently visible (dimmed -- the party has been here before,
    // but can't see it right now), currently visible (no overlay at all). Only active on a map
    // that actually has walls drawn -- engine/encounter.js's revealVisibleTiles() only ever
    // populates revealedTiles for one (see its own comment for why), and a wall-free map
    // should render exactly as it always has, with no fog at all, not "everything unexplored."
    const walls = state.maps?.[state.mapName]?.walls;
    const fogActive = Array.isArray(walls) && walls.length > 0;
    const revealedTiles = state.maps?.[state.mapName]?.revealedTiles || {};
    const currentlyVisible = fogActive
      ? new Set(window.CampaignOS.visibleCellsForParty(state, state.mapName).map(([x, y]) => `${x},${y}`))
      : null;

    map.innerHTML = "";
    for (let y = 1; y <= settings.rows; y += 1) {
      for (let x = 1; x <= settings.columns; x += 1) {
        const tile = document.createElement("div");
        tile.className = "map-tile";
        if (fogActive) {
          const key = `${x},${y}`;
          if (!revealedTiles[key]) tile.classList.add("map-tile-unexplored");
          else if (!currentlyVisible.has(key)) tile.classList.add("map-tile-dimmed");
        }
        map.appendChild(tile);
      }
    }

    // Two independent filters, both applied before anything renders -- neither redacts a
    // token's name out of combat log text (see the CLAUDE.md "Player window" bullet for why
    // that's a known, documented gap rather than something attempted and broken):
    //   - hiddenFromPlayers: a manual DM override (a secret monster, an NPC not yet revealed).
    //     Always wins regardless of line of sight -- a token can be technically visible AND
    //     still deliberately hidden.
    //   - isVisibleToParty (engine/encounter.js): line-of-sight against the map's own walls
    //     (state.maps[name].walls), union over every hero-type token on the map -- "if any PC
    //     could see it, the table sees it." A map with no walls drawn has no restriction at
    //     all (isVisibleToParty's own fast path), so this is a no-op for every map that never
    //     got a wall, i.e. almost all of them until a DM actually uses the Walls tool.
    const tokens = (state.tokens || [])
      .filter((token) => token.mapName === state.mapName && !token.hiddenFromPlayers)
      .filter((token) => window.CampaignOS.isVisibleToParty(state, token));
    tokens.forEach((token) => {
      const tokenEl = document.createElement("div");
      tokenEl.className = `token ${token.type}`;
      tokenEl.style.gridColumn = `${token.x} / span 1`;
      tokenEl.style.gridRow = `${token.y} / span 1`;
      tokenEl.title = token.name;

      // A rough health bar (bloodied/near-death color, no exact numbers) -- a reasonable
      // middle ground between "players see nothing" and "players see the DM's exact HP
      // figures," without building a whole per-token hide/reveal system for this first pass.
      const hpBar = document.createElement("div");
      hpBar.className = "token-hp-bar";
      const hpFraction = token.maxHp > 0 ? Math.max(0, Math.min(1, token.hp / token.maxHp)) : 0;
      const fill = document.createElement("div");
      fill.className = "token-hp-bar-fill";
      fill.style.width = `${Math.round(hpFraction * 100)}%`;
      if (hpFraction <= 0.25) fill.classList.add("token-hp-bar-critical");
      else if (hpFraction <= 0.5) fill.classList.add("token-hp-bar-bloodied");
      hpBar.appendChild(fill);
      tokenEl.appendChild(hpBar);

      if (token.image) {
        tokenEl.classList.add("has-image");
        resolveStoredImage(token.image).then((dataUrl) => {
          if (dataUrl) tokenEl.style.backgroundImage = `url("${dataUrl}")`;
        });
      } else {
        const iconSpan = document.createElement("span");
        iconSpan.className = "token-icon-label";
        iconSpan.textContent = token.icon || "";
        tokenEl.appendChild(iconSpan);
      }
      map.appendChild(tokenEl);
    });

    return tokens;
  }

  function renderInitiative(state, tokens) {
    const activeTokenId = state.turn?.tokenId;
    const activeToken = activeTokenId ? tokens.find((token) => token.id === activeTokenId) : null;
    turnStatusEl.textContent = activeToken
      ? `Round ${state.turn.round} — ${activeToken.name}'s turn`
      : "No active turn";

    const sorted = window.CampaignOS.sortByInitiative(tokens);
    initiativeListEl.innerHTML = "";
    sorted.forEach((token) => {
      const item = document.createElement("li");
      if (token.id === activeTokenId) item.className = "current-turn";
      const deathBadge = token.dead
        ? `<small class="death-badge death-badge-dead">DEAD</small>`
        : token.dying
          ? `<small class="death-badge death-badge-dying">${token.dying.stable ? "STABLE" : "DYING"}</small>`
          : "";
      item.innerHTML = `<button type="button" tabindex="-1"><span>${escapeHtml(token.name)}</span>${deathBadge}<strong>${token.initiative}</strong></button>`;
      initiativeListEl.appendChild(item);
    });
  }

  function renderCombatLog(state) {
    combatLogEl.innerHTML = "";
    const entries = state.log || [];
    if (!entries.length) {
      const item = document.createElement("li");
      item.className = "empty-log";
      item.textContent = "No attacks yet.";
      combatLogEl.appendChild(item);
      return;
    }
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = entry;
      combatLogEl.appendChild(item);
    });
  }

  function render(state) {
    if (!state || !state.mapName) {
      mapNameEl.textContent = "No map loaded";
      map.innerHTML = "";
      lastRenderedMapImageValue = undefined;
      initiativeListEl.innerHTML = "";
      combatLogEl.innerHTML = "";
      turnStatusEl.textContent = "No active turn";
      return;
    }

    mapNameEl.textContent = state.mapName;
    const settings = currentMapSettings(state);
    renderMapBackground(settings);
    const tokens = renderMapGrid(state, settings);
    renderInitiative(state, tokens);
    renderCombatLog(state);
  }

  function formatAgo(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 2) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.round(seconds / 60)}m ago`;
  }

  function poll() {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) {
      syncStatusEl.textContent = "Waiting for the DM's board -- open Campaign OS (index.html) in another tab first.";
      return;
    }
    if (raw === lastRawState) {
      syncStatusEl.textContent = `Live -- updated ${lastUpdateAt ? formatAgo(lastUpdateAt) : "just now"}`;
      return;
    }
    lastRawState = raw;
    lastUpdateAt = Date.now();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      syncStatusEl.textContent = "Couldn't read the DM's board (invalid saved state).";
      return;
    }
    render(parsed);
    syncStatusEl.textContent = "Live -- updated just now";
  }

  poll();
  setInterval(poll, 1000);
})();
