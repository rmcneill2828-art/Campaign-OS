(function () {
  const storageKey = "campaign-os-week-one";
  const map = document.querySelector("#battleMap");
  const initiativeList = document.querySelector("#initiativeList");
  const tokenSheet = document.querySelector("#tokenSheet");
  const commandForm = document.querySelector("#commandForm");
  const commandInput = document.querySelector("#commandInput");
  const commandResult = document.querySelector("#commandResult");
  const mapSelect = document.querySelector("#mapSelect");

  let state = window.CampaignOS.createState();

  function selectedToken() {
    return state.tokens.find((token) => token.id === state.selectedTokenId);
  }

  function render() {
    document.body.dataset.fog = state.fogEnabled ? "on" : "off";
    document.querySelector("h1").textContent = state.mapName;
    mapSelect.value = state.mapName;
    renderMap();
    renderInitiative();
    renderTokenSheet();
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
          <h3>${token.name}</h3>
        </div>
        <strong>${token.hp} / ${token.maxHp}</strong>
      </div>
      <div class="hp-actions">
        <button type="button" data-action="damage">Damage 5</button>
        <button type="button" data-action="heal">Heal 5</button>
      </div>
      <div class="conditions"></div>
    `;

    tokenSheet.querySelector('[data-action="damage"]').addEventListener("click", () => updateState(window.CampaignOS.applyDamage(state, token.id, 5)));
    tokenSheet.querySelector('[data-action="heal"]').addEventListener("click", () => updateState(window.CampaignOS.applyHealing(state, token.id, 5)));

    const conditions = tokenSheet.querySelector(".conditions");
    window.CampaignOS.conditionList.forEach((condition) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="checkbox" ${token.conditions.includes(condition) ? "checked" : ""}> ${condition}`;
      label.querySelector("input").addEventListener("change", () => updateState(window.CampaignOS.toggleCondition(state, token.id, condition)));
      conditions.appendChild(label);
    });
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

  document.querySelector("#toggleFog").addEventListener("click", () => {
    state.fogEnabled = !state.fogEnabled;
    render();
  });

  mapSelect.addEventListener("change", () => {
    state.mapName = mapSelect.value;
    document.querySelector("h1").textContent = state.mapName;
  });

  render();
})();
