(function () {
  const conditionList = [
    "Blinded",
    "Charmed",
    "Frightened",
    "Grappled",
    "Poisoned",
    "Prone",
    "Restrained",
    "Stunned",
    "Unconscious"
  ];

  // SRD 5.1 stat blocks for the monsters `parseCommand`'s spawn phrasing recognizes
  // (see monsterPattern below). attackBonus/damageDice reflect the monster's primary
  // attack for single-attack resolution and the token sheet's editable fields; `attacks`
  // (when present) lists every attack a Multiattack action makes, consumed by attack()
  // below. `initiativeMod` is the monster's real Dex modifier, not a flat guess.
  //
  // Troll's Regeneration (10 HP at the start of its turn unless it took acid/fire damage
  // since its last turn) is intentionally NOT automated here -- this engine has no
  // start-of-turn hook to key it off. Apply it by hand via applyHealing on the troll's turn.
  const STAT_BLOCKS = {
    goblin: { hp: 7, ac: 15, attackBonus: 4, damageDice: "1d6+2", initiativeMod: 2 },
    orc: { hp: 15, ac: 13, attackBonus: 5, damageDice: "1d12+3", initiativeMod: 1 },
    wolf: { hp: 11, ac: 13, attackBonus: 4, damageDice: "2d4+2", initiativeMod: 2 },
    bandit: { hp: 11, ac: 12, attackBonus: 3, damageDice: "1d6+1", initiativeMod: 1 },
    troll: {
      hp: 84,
      ac: 15,
      attackBonus: 7,
      damageDice: "1d6+4",
      initiativeMod: -1,
      attacks: [
        { name: "Bite", attackBonus: 7, damageDice: "1d6+4" },
        { name: "Claw", attackBonus: 7, damageDice: "2d6+4" },
        { name: "Claw", attackBonus: 7, damageDice: "2d6+4" }
      ]
    }
  };
  // Safety net for a monster name that reaches spawnMonster without a STAT_BLOCKS entry
  // (not reachable through parseCommand today, since monsterPattern only matches the
  // names above, but spawnMonster itself doesn't enforce that).
  const GENERIC_STAT_BLOCK = { hp: 10, ac: 13, attackBonus: 3, damageDice: "1d8+1", initiativeMod: 2 };

  const initialState = {
    mapName: "",
    maps: {},
    fogEnabled: false,
    selectedTokenId: null,
    log: [],
    tokens: []
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createState() {
    return clone(initialState);
  }

  function sortByInitiative(tokens) {
    return [...tokens].sort((a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name));
  }

  function tokensOnCurrentMap(state) {
    return state.tokens.filter((token) => token.mapName === state.mapName);
  }

  function occupied(state, x, y) {
    return tokensOnCurrentMap(state).some((token) => token.x === x && token.y === y);
  }

  function findOpenTile(state, startX, startY) {
    const queue = [{ x: startX, y: startY }];
    const seen = new Set();

    while (queue.length) {
      const current = queue.shift();
      const key = `${current.x},${current.y}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const grid = currentGrid(state);
      if (current.x >= 1 && current.x <= grid.columns && current.y >= 1 && current.y <= grid.rows && !occupied(state, current.x, current.y)) {
        return current;
      }

      queue.push(
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 }
      );
    }

    return { x: 1, y: 1 };
  }

  function nextMonsterNumber(state, baseName) {
    const matcher = new RegExp(`^${baseName} (\\d+)$`, "i");
    return state.tokens.reduce((highest, token) => {
      const match = token.name.match(matcher);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0) + 1;
  }

  function spawnMonster(state, monsterName, count) {
    const nextState = clone(state);
    const spawned = [];
    const baseName = monsterName.charAt(0).toUpperCase() + monsterName.slice(1).toLowerCase();
    const stats = STAT_BLOCKS[monsterName.toLowerCase()] || GENERIC_STAT_BLOCK;

    for (let index = 0; index < count; index += 1) {
      const number = nextMonsterNumber(nextState, baseName);
      const tile = findOpenTile(nextState, 7 + index, 3 + index);
      const token = {
        id: `${monsterName.toLowerCase()}-${Date.now()}-${index}`,
        name: `${baseName} ${number}`,
        icon: baseName.slice(0, 2).toUpperCase(),
        type: "monster",
        mapName: nextState.mapName,
        x: tile.x,
        y: tile.y,
        hp: stats.hp,
        maxHp: stats.hp,
        ac: stats.ac,
        attackBonus: stats.attackBonus,
        damageDice: stats.damageDice,
        initiative: rollDie(20) + stats.initiativeMod,
        conditions: []
      };
      if (stats.attacks) token.attacks = stats.attacks;
      nextState.tokens.push(token);
      spawned.push(token);
    }

    nextState.selectedTokenId = spawned[0]?.id || nextState.selectedTokenId;
    return { state: nextState, spawned };
  }

  function addToken(state, draft) {
    const nextState = clone(state);
    const tile = findOpenTile(nextState, 4, 4);
    const token = {
      id: `${slugify(draft.name || "token")}-${Date.now()}`,
      name: draft.name || "Campaign Token",
      icon: draft.icon || String(draft.name || "CT").slice(0, 2).toUpperCase(),
      type: draft.type || "hero",
      mapName: nextState.mapName,
      x: tile.x,
      y: tile.y,
      hp: clampNumber(draft.hp ?? draft.maxHp ?? 10, 0, 999),
      maxHp: clampNumber(draft.maxHp ?? draft.hp ?? 10, 1, 999),
      ac: clampNumber(draft.ac ?? 12, 1, 99),
      attackBonus: clampNumber(draft.attackBonus ?? 3, -20, 99),
      damageDice: draft.damageDice || "1d6+1",
      initiative: clampNumber(draft.initiative ?? rollDie(20), 0, 99),
      conditions: draft.conditions || [],
      sourcePath: draft.sourcePath || ""
    };
    if (Array.isArray(draft.attacks) && draft.attacks.length > 1) token.attacks = draft.attacks;
    token.hp = clampNumber(token.hp, 0, token.maxHp);
    nextState.tokens.push(token);
    nextState.selectedTokenId = token.id;
    return { state: nextState, token };
  }

  function slugify(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "token";
  }

  function rollDie(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }

  function rollDice(notation) {
    const match = String(notation).trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
    if (!match) return { total: 0, rolls: [], modifier: 0, notation };

    const count = Number(match[1] || 1);
    const sides = Number(match[2]);
    const modifier = Number(match[3] || 0);
    const rolls = [];
    for (let index = 0; index < count; index += 1) {
      rolls.push(rollDie(sides));
    }

    return {
      total: rolls.reduce((sum, roll) => sum + roll, 0) + modifier,
      rolls,
      modifier,
      notation
    };
  }

  function applyDamage(state, tokenId, amount) {
    const nextState = clone(state);
    const token = nextState.tokens.find((item) => item.id === tokenId);
    if (token) token.hp = clampNumber(token.hp - amount, 0, token.maxHp);
    return nextState;
  }

  function applyHealing(state, tokenId, amount) {
    const nextState = clone(state);
    const token = nextState.tokens.find((item) => item.id === tokenId);
    if (token) token.hp = clampNumber(token.hp + amount, 0, token.maxHp);
    return nextState;
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function updateToken(state, tokenId, changes) {
    const nextState = clone(state);
    const token = nextState.tokens.find((item) => item.id === tokenId);
    if (!token) return nextState;

    if (typeof changes.name === "string") {
      token.name = changes.name.trim() || token.name;
      token.icon = token.name.slice(0, 2).toUpperCase();
    }

    if (changes.maxHp !== undefined) {
      token.maxHp = clampNumber(changes.maxHp, 1, 999);
      token.hp = clampNumber(token.hp, 0, token.maxHp);
    }

    if (changes.hp !== undefined) {
      token.hp = clampNumber(changes.hp, 0, token.maxHp);
    }

    if (changes.initiative !== undefined) {
      token.initiative = clampNumber(changes.initiative, 0, 99);
    }

    if (changes.ac !== undefined) {
      token.ac = clampNumber(changes.ac, 1, 99);
    }

    if (changes.attackBonus !== undefined) {
      token.attackBonus = clampNumber(changes.attackBonus, -20, 99);
    }

    if (typeof changes.damageDice === "string") {
      token.damageDice = changes.damageDice.trim() || token.damageDice || "1d4";
    }

    if (typeof changes.image === "string") {
      token.image = changes.image;
    }

    return nextState;
  }

  function setMapImage(state, mapName, image, details = {}) {
    const nextState = clone(state);
    nextState.maps = nextState.maps || {};
    nextState.maps[mapName] = {
      ...(nextState.maps[mapName] || {}),
      image,
      ...details
    };
    return nextState;
  }

  function setMapGrid(state, mapName, columns, rows) {
    const nextState = clone(state);
    nextState.maps = nextState.maps || {};
    nextState.maps[mapName] = {
      ...(nextState.maps[mapName] || {}),
      columns: clampNumber(columns, 4, 80),
      rows: clampNumber(rows, 4, 80)
    };
    nextState.tokens = nextState.tokens.map((token) => token.mapName === mapName
      ? {
          ...token,
          x: clampNumber(token.x, 1, nextState.maps[mapName].columns),
          y: clampNumber(token.y, 1, nextState.maps[mapName].rows)
        }
      : token);
    return nextState;
  }

  function setMapView(state, mapName, settings) {
    const nextState = clone(state);
    const current = nextState.maps?.[mapName] || {};
    nextState.maps = nextState.maps || {};
    nextState.maps[mapName] = {
      ...current,
      showGrid: settings.showGrid !== false,
      gridOpacity: clampNumber(settings.gridOpacity ?? current.gridOpacity ?? 35, 0, 100),
      fitMode: settings.fitMode === "contain" ? "contain" : "cover",
      tokenSize: clampNumber(settings.tokenSize ?? current.tokenSize ?? 78, 40, 100)
    };
    return nextState;
  }

  function currentGrid(state) {
    const mapSettings = state.maps?.[state.mapName] || {};
    return {
      columns: clampNumber(mapSettings.columns || 12, 4, 80),
      rows: clampNumber(mapSettings.rows || 8, 4, 80)
    };
  }

  function addLogEntry(state, text) {
    const nextState = clone(state);
    nextState.log = [text, ...(nextState.log || [])].slice(0, 12);
    return nextState;
  }

  // Rolls one d20 (or two, for advantage/disadvantage, keeping the higher/lower) and
  // reports both the chosen roll and the raw rolls behind it, so callers can show their
  // work the same way a natural-1/natural-20 already does.
  function rollD20WithMode(mode) {
    if (mode === "advantage" || mode === "disadvantage") {
      const a = rollDie(20);
      const b = rollDie(20);
      const roll = mode === "advantage" ? Math.max(a, b) : Math.min(a, b);
      return { roll, rolls: [a, b] };
    }
    return { roll: rollDie(20), rolls: [] };
  }

  // Resolves a single attack roll + damage roll against one target. `label` (an attack
  // name like "Claw") is only included in the message when set -- single-attack callers
  // leave it null so the message format matches a plain "<attacker> attacks <target>" line.
  function resolveOneAttack(attacker, target, attackBonus, damageDice, mode, label) {
    const d20Info = rollD20WithMode(mode);
    const d20 = d20Info.roll;
    const bonus = Number(attackBonus || 0);
    const total = d20 + bonus;
    const targetAc = Number(target.ac || 10);
    const isCritical = d20 === 20;
    const isMiss = d20 === 1 || (!isCritical && total < targetAc);
    const rollLabel = d20Info.rolls.length
      ? `${d20} (${mode}: ${d20Info.rolls.join(", ")})`
      : `${d20}`;
    const actorLabel = label ? `${attacker.name}'s ${label}` : attacker.name;

    if (isMiss) {
      return {
        damageTotal: 0,
        message: `${actorLabel} attacks ${target.name}: ${rollLabel} + ${bonus} = ${total} vs AC ${targetAc}. Miss.`
      };
    }

    const damage = rollDice(damageDice || "1d4");
    // RAW: a critical hit doubles the damage dice only, not any flat modifier.
    const diceTotal = damage.total - damage.modifier;
    const damageTotal = isCritical ? diceTotal * 2 + damage.modifier : damage.total;
    const critText = isCritical ? " Critical hit." : "";
    return {
      damageTotal,
      message: `${actorLabel} attacks ${target.name}: ${rollLabel} + ${bonus} = ${total} vs AC ${targetAc}. Hit.${critText} Damage ${damageTotal} (${damage.notation}).`
    };
  }

  // options: { advantage: bool, disadvantage: bool } -- applies to every d20 rolled this
  // call. If the attacker has an `attacks` array (Multiattack, e.g. a troll's Bite + two
  // Claws), each one resolves in order against the same target, stopping early if the
  // target drops to 0 HP so a dead target doesn't keep eating attack rolls.
  function attack(state, attackerId, targetId, options = {}) {
    let nextState = clone(state);
    const activeTokens = tokensOnCurrentMap(nextState);
    const attacker = activeTokens.find((token) => token.id === attackerId);
    const target = activeTokens.find((token) => token.id === targetId);
    if (!attacker || !target) {
      return { state, message: "Attack failed: attacker or target was not found." };
    }

    const mode = options.disadvantage ? "disadvantage" : options.advantage ? "advantage" : null;
    const profiles = Array.isArray(attacker.attacks) && attacker.attacks.length
      ? attacker.attacks
      : [{ name: null, attackBonus: attacker.attackBonus, damageDice: attacker.damageDice }];
    const useLabel = profiles.length > 1;

    const messages = [];
    for (const profile of profiles) {
      const liveTarget = tokensOnCurrentMap(nextState).find((token) => token.id === target.id);
      if (!liveTarget || liveTarget.hp <= 0) break;

      const result = resolveOneAttack(attacker, liveTarget, profile.attackBonus, profile.damageDice, mode, useLabel ? profile.name : null);
      messages.push(result.message);
      if (result.damageTotal > 0) {
        nextState = applyDamage(nextState, target.id, result.damageTotal);
      }
    }

    const message = messages.join(" ");
    return { state: addLogEntry(nextState, message), message };
  }

  function findTokenByName(state, name) {
    const normalized = name.trim().toLowerCase();
    return tokensOnCurrentMap(state).find((token) => token.name.toLowerCase() === normalized);
  }

  function removeToken(state, tokenId) {
    const nextState = clone(state);
    nextState.tokens = nextState.tokens.filter((token) => token.id !== tokenId);
    if (nextState.selectedTokenId === tokenId) {
      nextState.selectedTokenId = sortByInitiative(tokensOnCurrentMap(nextState))[0]?.id || null;
    }
    return nextState;
  }

  function setTokenPosition(state, tokenId, x, y) {
    if (occupied(state, x, y) && !tokensOnCurrentMap(state).some((token) => token.id === tokenId && token.x === x && token.y === y)) {
      return state;
    }

    const nextState = clone(state);
    const token = nextState.tokens.find((item) => item.id === tokenId);
    if (token) {
      token.mapName = nextState.mapName;
      token.x = x;
      token.y = y;
    }
    return nextState;
  }

  function toggleCondition(state, tokenId, condition) {
    const nextState = clone(state);
    const token = nextState.tokens.find((item) => item.id === tokenId);
    if (!token) return nextState;

    if (token.conditions.includes(condition)) {
      token.conditions = token.conditions.filter((item) => item !== condition);
    } else {
      token.conditions.push(condition);
    }

    return nextState;
  }

  function parseCommand(state, command) {
    const normalized = command.toLowerCase();
    const countWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const countPattern = "(one|two|three|four|five|six|\\d+)";
    const monsterPattern = "(goblin|orc|troll|bandit|wolf)s?";
    const actionFirst = new RegExp(`(?:spawn|summon|emerge|appear|add).*?${countPattern}\\s+${monsterPattern}`);
    const countFirst = new RegExp(`${countPattern}\\s+${monsterPattern}.*?(?:spawn|summon|emerge|appear|add)`);
    const spawnMatch = normalized.match(actionFirst) || normalized.match(countFirst);

    // Strip a trailing "with advantage"/"at disadvantage" phrase before matching the
    // attacker/target names, otherwise it gets swallowed into the target name.
    const disadvantageSuffix = /\s+(?:with disadvantage|at disadvantage)\s*[.!?]?$/i;
    const advantageSuffix = /\s+(?:with advantage|at advantage)\s*[.!?]?$/i;
    let attackOptions = {};
    let attackCommand = command;
    if (disadvantageSuffix.test(command)) {
      attackOptions = { disadvantage: true };
      attackCommand = command.replace(disadvantageSuffix, "");
    } else if (advantageSuffix.test(command)) {
      attackOptions = { advantage: true };
      attackCommand = command.replace(advantageSuffix, "");
    }
    const attackMatch = attackCommand.match(/^(.+?)\s+attacks?\s+(.+?)[.!?]?$/i);

    if (attackMatch) {
      const attacker = findTokenByName(state, attackMatch[1]);
      const target = findTokenByName(state, attackMatch[2]);
      if (!attacker || !target) {
        return { state, message: "I could not find the attacker or target." };
      }
      return attack(state, attacker.id, target.id, attackOptions);
    }

    if (spawnMatch) {
      const count = countWords[spawnMatch[1]] || Number(spawnMatch[1]);
      const result = spawnMonster(state, spawnMatch[2], count);
      return {
        state: result.state,
        message: `${result.spawned.map((token) => token.name).join(", ")} joined the encounter.`
      };
    }

    return { state, message: "I understood the narration, but no tool action matched yet." };
  }

  window.CampaignOS = {
    applyDamage,
    applyHealing,
    attack,
    addToken,
    conditionList,
    createState,
    currentGrid,
    parseCommand,
    removeToken,
    setMapGrid,
    setMapImage,
    setMapView,
    setTokenPosition,
    sortByInitiative,
    tokensOnCurrentMap,
    toggleCondition,
    updateToken
  };
})();
