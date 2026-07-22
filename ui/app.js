(function () {
  const storageKey = "campaign-os-week-three";
  const campaignStorageKey = "campaign-os-campaign-import";
  const map = document.querySelector("#battleMap");
  const initiativeList = document.querySelector("#initiativeList");
  const tokenSheet = document.querySelector("#tokenSheet");
  const combatLog = document.querySelector("#combatLog");
  const campaignImport = document.querySelector("#campaignImport");
  const campaignSummary = document.querySelector("#campaignSummary");
  const campaignBrowser = document.querySelector("#campaignBrowser");
  const commandForm = document.querySelector("#commandForm");
  const commandInput = document.querySelector("#commandInput");
  const commandResult = document.querySelector("#commandResult");
  const mapSelect = document.querySelector("#mapSelect");

  let state = window.CampaignOS.createState();
  let campaign = loadCampaign();

  function selectedToken() {
    return state.tokens.find((token) => token.id === state.selectedTokenId);
  }

  function render() {
    document.body.dataset.fog = state.fogEnabled ? "on" : "off";
    document.querySelector("h1").textContent = state.mapName;
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

    for (let y = 1; y <= 8; y += 1) {
      for (let x = 1; x <= 12; x += 1) {
        const tile = document.createElement("button");
        tile.className = "map-tile";
        tile.type = "button";
        tile.dataset.x = x;
        tile.dataset.y = y;
        tile.ariaLabel = `Tile ${x}, ${y}`;
        tile.addEventListener("dragover", (event) => event.preventDefault());
        tile.addEventListener("drop", handleDrop);
        map.appendChild(tile);
      }
    }

    state.tokens.forEach((token) => {
      const tokenButton = document.createElement("button");
      tokenButton.className = `token ${token.type}`;
      tokenButton.type = "button";
      tokenButton.draggable = true;
      tokenButton.dataset.id = token.id;
      tokenButton.style.gridColumn = token.x;
      tokenButton.style.gridRow = token.y;
      tokenButton.textContent = token.icon;
      tokenButton.title = token.name;
      tokenButton.setAttribute("aria-label", token.name);
      if (token.id === state.selectedTokenId) tokenButton.classList.add("selected");
      tokenButton.addEventListener("click", () => selectToken(token.id));
      tokenButton.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", token.id));
      map.appendChild(tokenButton);
    });
  }

  function renderInitiative() {
    initiativeList.innerHTML = "";
    window.CampaignOS.sortByInitiative(state.tokens).forEach((token) => {
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
        </div>
        <strong>${token.hp} / ${token.maxHp}</strong>
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
    state.tokens
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
    campaignSummary.textContent = imported
      ? `${campaign.name}: ${campaign.files.length} Markdown files imported.`
      : "No campaign imported.";
    campaignBrowser.innerHTML = "";

    Object.entries(campaign.categories).forEach(([category, items]) => {
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

      items.slice(0, 8).forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "campaign-item";
        button.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.path)}</span><small>${escapeHtml(item.summary)}</small>`;
        button.addEventListener("click", () => openCampaignItem(item));
        group.appendChild(button);
      });

      campaignBrowser.appendChild(group);
    });
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
    commandResult.textContent = `${item.title}: ${item.summary}`;
    if (item.category === "locations") {
      state.mapName = item.title;
      render();
    }
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

  function selectToken(tokenId) {
    state.selectedTokenId = tokenId;
    render();
  }

  function updateState(nextState) {
    state = nextState;
    render();
  }

  function handleDrop(event) {
    const tokenId = event.dataTransfer.getData("text/plain");
    const x = Number(event.currentTarget.dataset.x);
    const y = Number(event.currentTarget.dataset.y);
    updateState(window.CampaignOS.setTokenPosition(state, tokenId, x, y));
  }

  commandForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = window.CampaignOS.parseCommand(state, commandInput.value);
    state = result.state;
    commandResult.textContent = result.message;
    render();
  });

  document.querySelector("#saveEncounter").addEventListener("click", () => {
    localStorage.setItem(storageKey, JSON.stringify(state));
    commandResult.textContent = "Encounter saved locally.";
  });

  document.querySelector("#loadEncounter").addEventListener("click", () => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      commandResult.textContent = "No saved encounter found.";
      return;
    }
    state = JSON.parse(saved);
    commandResult.textContent = "Encounter loaded.";
    render();
  });

  document.querySelector("#resetEncounter").addEventListener("click", () => {
    state = window.CampaignOS.createState();
    commandResult.textContent = "Encounter reset.";
    render();
  });

  campaignImport.addEventListener("change", async () => {
    campaignSummary.textContent = "Importing campaign...";
    campaign = await window.CampaignOSCampaign.importMarkdownFiles(campaignImport.files);
    saveCampaign();
    commandResult.textContent = `${campaign.name} imported.`;
    render();
  });

  document.querySelector("#clearCampaign").addEventListener("click", () => {
    campaign = window.CampaignOSCampaign.createCampaign();
    localStorage.removeItem(campaignStorageKey);
    campaignImport.value = "";
    commandResult.textContent = "Campaign import cleared.";
    render();
  });

  document.querySelector("#toggleFog").addEventListener("click", () => {
    state.fogEnabled = !state.fogEnabled;
    render();
  });

  mapSelect.addEventListener("change", () => {
    state.mapName = mapSelect.value;
    document.querySelector("h1").textContent = state.mapName;
  });

  function saveCampaign() {
    localStorage.setItem(campaignStorageKey, JSON.stringify(campaign));
  }

  function loadCampaign() {
    const saved = localStorage.getItem(campaignStorageKey);
    if (!saved) return window.CampaignOSCampaign.createCampaign();
    try {
      return JSON.parse(saved);
    } catch {
      return window.CampaignOSCampaign.createCampaign();
    }
  }

  render();
})();
