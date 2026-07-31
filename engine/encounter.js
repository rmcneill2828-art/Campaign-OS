(function () {
  const ABILITY_KEYS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

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
  // below. `initiativeMod` is the monster's real Dex modifier, not a flat guess -- same
  // number as abilityScores.DEX's modifier, kept as its own field since it predates
  // ability scores being modeled at all. None of these five have a stated saving throw
  // proficiency in the SRD, so their saves fall back to a flat ability modifier (see
  // savingThrowBonus) -- no `savingThrows` override needed.
  //
  // Troll's Regeneration (10 HP at the start of its turn unless it took acid/fire damage
  // since its last turn) is intentionally NOT automated here -- this engine has no
  // start-of-turn hook to key it off. Apply it by hand via applyHealing on the troll's turn.
  const STAT_BLOCKS = {
    goblin: {
      hp: 7, ac: 15, attackBonus: 4, damageDice: "1d6+2", initiativeMod: 2, speed: 30,
      abilityScores: { STR: 8, DEX: 14, CON: 10, INT: 10, WIS: 8, CHA: 8 }
    },
    orc: {
      hp: 15, ac: 13, attackBonus: 5, damageDice: "1d12+3", initiativeMod: 1, speed: 30,
      abilityScores: { STR: 16, DEX: 12, CON: 16, INT: 7, WIS: 11, CHA: 10 }
    },
    wolf: {
      hp: 11, ac: 13, attackBonus: 4, damageDice: "2d4+2", initiativeMod: 2, speed: 40,
      abilityScores: { STR: 12, DEX: 15, CON: 12, INT: 3, WIS: 12, CHA: 6 }
    },
    bandit: {
      hp: 11, ac: 12, attackBonus: 3, damageDice: "1d6+1", initiativeMod: 1, speed: 30,
      abilityScores: { STR: 11, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 }
    },
    troll: {
      hp: 84,
      ac: 15,
      attackBonus: 7,
      damageDice: "1d6+4",
      // Real SRD Dex is 13 (+1 mod) -- fixing a pre-existing -1 here alongside adding the
      // full ability block, since the two were clearly meant to be the same number.
      initiativeMod: 1,
      speed: 30,
      abilityScores: { STR: 18, DEX: 13, CON: 20, INT: 7, WIS: 9, CHA: 7 },
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
  const GENERIC_STAT_BLOCK = {
    hp: 10, ac: 13, attackBonus: 3, damageDice: "1d8+1", initiativeMod: 2, speed: 30,
    abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }
  };

  const initialState = {
    mapName: "",
    maps: {},
    fogEnabled: false,
    selectedTokenId: null,
    log: [],
    tokens: [],
    // The active turn tracker. tokenId is null when no encounter turn order is running
    // (free positioning/scene-setting outside combat); round starts at 1 once nextTurn()
    // is first called. Movement speed limits (see moveToken) only apply to whichever token
    // this currently points at -- everything else can still be freely repositioned.
    turn: { tokenId: null, round: 0 }
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
        speed: stats.speed,
        movementUsed: 0,
        diagonalStepsThisTurn: 0,
        initiative: rollDie(20) + stats.initiativeMod,
        conditions: [],
        abilityScores: { ...stats.abilityScores }
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
      speed: clampNumber(draft.speed ?? 30, 0, 999),
      movementUsed: 0,
      diagonalStepsThisTurn: 0,
      initiative: clampNumber(draft.initiative ?? rollDie(20), 0, 99),
      conditions: draft.conditions || [],
      sourcePath: draft.sourcePath || ""
    };
    if (Array.isArray(draft.attacks) && draft.attacks.length > 1) token.attacks = draft.attacks;
    const abilityScores = normalizeAbilityScores(draft.abilityScores);
    if (abilityScores) token.abilityScores = abilityScores;
    const savingThrows = normalizeSavingThrows(draft.savingThrows);
    if (savingThrows) token.savingThrows = savingThrows;
    const spellcasting = normalizeSpellcasting(draft.spellcasting);
    if (spellcasting) token.spellcasting = spellcasting;
    const spellSlots = normalizeSpellSlots(draft.spellSlots);
    if (spellSlots) token.spellSlots = spellSlots;
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

  function normalizeAbilityScores(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const scores = {};
    let any = false;
    ABILITY_KEYS.forEach((key) => {
      const value = Number(raw[key]);
      if (Number.isFinite(value)) {
        scores[key] = clampNumber(value, 1, 30);
        any = true;
      }
    });
    return any ? scores : undefined;
  }

  // A stated saving-throw bonus (parsed from a real character sheet's "Saving throws:"
  // line, e.g. "Wisdom +6 (Resilient, lvl Fighter 4)") is stored as-is rather than
  // recomputed from ability score + proficiency bonus -- real sheets accumulate feats,
  // multiclass bumps, and magic items a flat formula can't reproduce. Sparse: only the
  // abilities actually stated are recorded, everything else falls back to the raw
  // ability modifier (see savingThrowBonus).
  function normalizeSavingThrows(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const saves = {};
    let any = false;
    ABILITY_KEYS.forEach((key) => {
      const value = Number(raw[key]);
      if (Number.isFinite(value)) {
        saves[key] = Math.round(value);
        any = true;
      }
    });
    return any ? saves : undefined;
  }

  function abilityModifier(score) {
    return Math.floor((Number(score) - 10) / 2);
  }

  // Sparse per-level (1-9) spell slot tracker: only levels the caster actually has are
  // present. Each level stores {max, current}; current is clamped to [0, max] so a bad
  // update (e.g. current > max after an editor typo) can't create slots out of nowhere.
  function normalizeSpellSlots(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const slots = {};
    let any = false;
    for (let level = 1; level <= 9; level += 1) {
      const entry = raw[level];
      if (!entry || typeof entry !== "object") continue;
      const max = Number(entry.max);
      if (!Number.isFinite(max) || max <= 0) continue;
      const clampedMax = clampNumber(max, 1, 99);
      const current = Number.isFinite(Number(entry.current)) ? Number(entry.current) : clampedMax;
      slots[level] = { max: clampedMax, current: clampNumber(current, 0, clampedMax) };
      any = true;
    }
    return any ? slots : undefined;
  }

  // A stated spell save DC / spell attack bonus (parsed from a real sheet's
  // "Spellcasting:" line, e.g. "Spell save DC 16, spell attack +8") is stored as-is,
  // same rationale as savingThrows: real sheets bake in proficiency/feats/magic items a
  // flat formula can't reproduce. Sparse -- either field can be present alone.
  function normalizeSpellcasting(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const result = {};
    const saveDC = Number(raw.saveDC);
    if (Number.isFinite(saveDC)) result.saveDC = clampNumber(saveDC, 1, 30);
    const attackBonus = Number(raw.attackBonus);
    if (Number.isFinite(attackBonus)) result.attackBonus = clampNumber(attackBonus, -20, 99);
    return Object.keys(result).length ? result : undefined;
  }

  function ordinal(level) {
    if (level === 1) return "1st";
    if (level === 2) return "2nd";
    if (level === 3) return "3rd";
    return `${level}th`;
  }

  // The bonus rollSavingThrow adds to the d20: an explicit stated save bonus if the sheet
  // has one, else the raw ability modifier (no proficiency bonus -- a token only gets that
  // if it's baked into an explicit override, matching how monsters without a stated
  // saving-throw proficiency in the SRD just use a flat ability modifier too), else 0 if
  // the token has no ability scores recorded at all.
  function savingThrowBonus(token, ability) {
    const stated = token.savingThrows?.[ability];
    if (Number.isFinite(stated)) return stated;
    const score = token.abilityScores?.[ability];
    return Number.isFinite(score) ? abilityModifier(score) : 0;
  }

  // Rolls a saving throw for `tokenId` against `dc`, using its real ability modifier (or
  // stated save bonus, see savingThrowBonus above) rather than a flat guess. Only reports
  // pass/fail -- it does not apply any follow-up effect (e.g. half damage on a success);
  // narration/subsequent actions apply damage or conditions based on the reported result
  // separately, the same way a real table resolves a save before deciding the consequence.
  function rollSavingThrow(state, tokenId, ability, dc) {
    const key = String(ability || "").toUpperCase().slice(0, 3);
    if (!ABILITY_KEYS.includes(key)) {
      return { state, message: `Saving throw failed: "${ability}" is not a valid ability.`, success: false };
    }

    const token = tokensOnCurrentMap(state).find((item) => item.id === tokenId);
    if (!token) return { state, message: "Saving throw failed: token was not found.", success: false };

    const bonus = savingThrowBonus(token, key);
    const roll = rollDie(20);
    const total = roll + bonus;
    const dcNumber = Number(dc) || 0;
    const success = total >= dcNumber;
    const message = `${token.name} rolls a ${key} save: ${roll} ${bonus >= 0 ? "+" : ""}${bonus} = ${total} vs DC ${dcNumber}. ${success ? "Success" : "Failure"}.`;
    return { state: addLogEntry(state, message), message, success, total };
  }

  // Casts a spell for `casterId`: consumes one of the caster's spell slots at `level`
  // (0 = cantrip, never consumes a slot), failing outright with no state change if the
  // caster has none of that level left. When `options.targetId` is also given, rolls a
  // single spell attack against it using the caster's stated spell attack bonus (see
  // normalizeSpellcasting) and applies any resulting damage -- the same resolveOneAttack
  // primitive attack() uses, just with a spell's own damage dice instead of a token's
  // weapon damageDice. A save-based spell (Fireball, Hold Person) has no attack roll to
  // make here; cast it alone to spend the slot, then issue separate rollSavingThrow calls
  // per target using the caster's spellcasting.saveDC, the same one-shot-batch pattern
  // saving_throw already uses for traps/effects (see dm-bridge/watch.js's guidance).
  function castSpell(state, casterId, options = {}) {
    let nextState = clone(state);
    const caster = tokensOnCurrentMap(nextState).find((token) => token.id === casterId);
    if (!caster) return { state, message: "Spellcasting failed: caster was not found." };

    const level = clampNumber(options.level ?? 0, 0, 9);
    const spellName = options.spellName || "a spell";
    const messages = [];

    if (level > 0) {
      const slot = caster.spellSlots?.[level];
      if (!slot || slot.current <= 0) {
        return { state, message: `${caster.name} has no ${ordinal(level)}-level spell slots remaining.` };
      }
      slot.current -= 1;
      messages.push(`${caster.name} casts ${spellName} using a ${ordinal(level)}-level spell slot (${slot.current} remaining).`);
    } else {
      messages.push(`${caster.name} casts ${spellName}.`);
    }

    if (options.targetId) {
      const target = tokensOnCurrentMap(nextState).find((token) => token.id === options.targetId);
      if (target) {
        const bonus = caster.spellcasting?.attackBonus;
        if (Number.isFinite(bonus)) {
          const mode = options.disadvantage ? "disadvantage" : options.advantage ? "advantage" : null;
          const result = resolveOneAttack(caster, target, bonus, options.damageDice, mode, spellName);
          messages.push(result.message);
          if (result.damageTotal > 0) nextState = applyDamage(nextState, target.id, result.damageTotal);
        } else {
          messages.push(`(no stated spell attack bonus for ${caster.name} -- attack roll skipped.)`);
        }
      }
    }

    const message = messages.join(" ");
    return { state: addLogEntry(nextState, message), message };
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

    if (changes.speed !== undefined) {
      token.speed = clampNumber(changes.speed, 0, 999);
    }

    if (changes.abilityScores !== undefined) {
      const merged = normalizeAbilityScores({ ...(token.abilityScores || {}), ...changes.abilityScores });
      if (merged) token.abilityScores = merged;
    }

    if (changes.savingThrows !== undefined) {
      const merged = normalizeSavingThrows({ ...(token.savingThrows || {}), ...changes.savingThrows });
      if (merged) token.savingThrows = merged;
    }

    if (changes.spellcasting !== undefined) {
      const merged = normalizeSpellcasting({ ...(token.spellcasting || {}), ...changes.spellcasting });
      if (merged) token.spellcasting = merged;
    }

    // Spell slots merge per-level -- a change to level 2's {max, current} pair shouldn't
    // touch level 1's, the same way updating one ability score doesn't touch the others.
    // Within a given level, the caller (the token editor's combined "current/max" field)
    // always supplies both max and current together, so a whole-entry replace is correct.
    if (changes.spellSlots !== undefined) {
      const merged = normalizeSpellSlots({ ...(token.spellSlots || {}), ...changes.spellSlots });
      if (merged) token.spellSlots = merged;
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
      tokenSize: clampNumber(settings.tokenSize ?? current.tokenSize ?? 78, 40, 100),
      feetPerSquare: clampNumber(settings.feetPerSquare ?? current.feetPerSquare ?? 5, 1, 30)
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

  // The real-world scale of one grid square on the current map, in feet. Defaults to the
  // standard 5 ft/square (used for both distance-based movement and the diagonal-cost rule).
  function feetPerSquare(state) {
    return clampNumber(state.maps?.[state.mapName]?.feetPerSquare ?? 5, 1, 30);
  }

  // True once a map has real art or an imported campaign location behind it -- distinguishes
  // a genuinely prepared map from a bare name a token happens to reference.
  function hasRealMapData(state, mapName) {
    const mapData = state.maps?.[mapName];
    return Boolean(mapData && (mapData.image || mapData.sourcePath));
  }

  // Switches to an already-prepared map (real art or a campaign sourcePath) -- returns the
  // same state reference, unchanged, if that map doesn't exist or has no real data yet, the
  // same "rejected" convention as setTokenPosition/moveToken. Can't create a map from
  // nothing here: doing that needs image data this pure, DOM-free engine has no access to
  // (see ui/app.js's Map Library "Use" flow, which is how a map actually gets prepared).
  function setActiveMap(state, mapName) {
    if (!hasRealMapData(state, mapName)) return state;
    const nextState = clone(state);
    nextState.mapName = mapName;
    return nextState;
  }

  // PHB movement/diagonals: every *other* diagonal square moved this turn costs double a
  // normal square (5/10/5/10 ft...), not a flat cost per square. `diagonalStepsAlreadyUsed`
  // carries the parity across a token's whole turn, even across separate moveToken() calls,
  // so ending a turn mid-alternation and moving again later still charges correctly.
  function gridMoveCost(state, x1, y1, x2, y2, diagonalStepsAlreadyUsed) {
    const squareFeet = feetPerSquare(state);
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const diagonalSteps = Math.min(dx, dy);
    const straightSteps = Math.max(dx, dy) - diagonalSteps;
    let diagonalFeet = 0;
    for (let step = 0; step < diagonalSteps; step += 1) {
      const stepIndex = diagonalStepsAlreadyUsed + step;
      diagonalFeet += stepIndex % 2 === 0 ? squareFeet : squareFeet * 2;
    }
    return { feet: straightSteps * squareFeet + diagonalFeet, diagonalSteps };
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

  // Advances the current map's turn order (sorted by initiative, same order the sidebar
  // shows) to the next token, resetting that token's movement budget for its new turn.
  // Wraps to the top of the order and increments the round counter after the last token.
  // If a token was removed since the last call (currentIndex === -1 but a turn was already
  // active), resumes at the top of the order without incrementing the round again, since we
  // can't know where in the round the missing token would have been.
  function nextTurn(state) {
    const nextState = clone(state);
    const ordered = sortByInitiative(tokensOnCurrentMap(nextState));
    if (!ordered.length) {
      nextState.turn = { tokenId: null, round: 0 };
      return nextState;
    }

    const hadActiveTurn = Boolean(nextState.turn && nextState.turn.tokenId);
    const currentIndex = ordered.findIndex((token) => token.id === nextState.turn?.tokenId);
    const round = nextState.turn?.round || 0;
    let nextIndex;
    let nextRound;

    if (currentIndex === -1) {
      nextIndex = 0;
      nextRound = hadActiveTurn ? round : round + 1;
    } else if (currentIndex === ordered.length - 1) {
      nextIndex = 0;
      nextRound = round + 1;
    } else {
      nextIndex = currentIndex + 1;
      nextRound = round;
    }

    const activeTokenId = ordered[nextIndex].id;
    nextState.turn = { tokenId: activeTokenId, round: nextRound };

    const activeToken = nextState.tokens.find((token) => token.id === activeTokenId);
    if (activeToken) {
      activeToken.movementUsed = 0;
      activeToken.diagonalStepsThisTurn = 0;
    }

    return nextState;
  }

  // Speed-limited move for the token whose turn is currently active (per state.turn) --
  // computes the RAW grid cost (see gridMoveCost) against that token's remaining movement
  // this turn and rejects the move (same state reference, like setTokenPosition's occupied-
  // tile rejection) if it can't afford it. A token that ISN'T the active turn moves freely
  // via setTokenPosition underneath -- this only enforces speed on your own turn, the same
  // as a real table: setting a scene or repositioning NPCs outside combat stays unrestricted.
  function moveToken(state, tokenId, x, y) {
    const token = tokensOnCurrentMap(state).find((item) => item.id === tokenId);
    if (!token) return { state, message: "Move failed: token was not found." };

    const isActiveTurn = Boolean(state.turn && state.turn.tokenId === tokenId);
    if (!isActiveTurn) {
      const moved = setTokenPosition(state, tokenId, x, y);
      if (moved === state) return { state, message: `${token.name} could not move to (${x}, ${y}) -- tile occupied.` };
      return { state: moved, message: `${token.name} moves to (${x}, ${y}).` };
    }

    const speed = Number(token.speed ?? 30);
    const used = Number(token.movementUsed || 0);
    const diagonalUsed = Number(token.diagonalStepsThisTurn || 0);
    const remaining = speed - used;
    const cost = gridMoveCost(state, token.x, token.y, x, y, diagonalUsed);

    if (cost.feet > remaining) {
      return {
        state,
        message: `${token.name} can't reach (${x}, ${y}) -- needs ${cost.feet} ft of movement, only ${remaining} ft left this turn (speed ${speed} ft).`
      };
    }

    const moved = setTokenPosition(state, tokenId, x, y);
    if (moved === state) return { state, message: `${token.name} could not move to (${x}, ${y}) -- tile occupied.` };

    const movedToken = moved.tokens.find((item) => item.id === tokenId);
    movedToken.movementUsed = used + cost.feet;
    movedToken.diagonalStepsThisTurn = diagonalUsed + cost.diagonalSteps;
    return {
      state: moved,
      message: `${token.name} moves to (${x}, ${y}) -- ${cost.feet} ft (${remaining - cost.feet} ft left this turn).`
    };
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

    const saveMatch = command.match(
      /^(.+?)\s+(?:makes?|rolls?)\s+an?\s+(strength|dexterity|constitution|intelligence|wisdom|charisma|str|dex|con|int|wis|cha)\s+sav(?:e|ing throw)s?\s+(?:against|vs\.?)?\s*dc\s*(\d+)/i
    );
    if (saveMatch) {
      const token = findTokenByName(state, saveMatch[1]);
      if (!token) return { state, message: "I could not find who's making the save." };
      return rollSavingThrow(state, token.id, saveMatch[2], Number(saveMatch[3]));
    }

    // "<caster> casts <spell> [at <target>] (cantrip|Nth level) [for <damage dice>]" --
    // the level/cantrip parenthetical is required so this can't misfire on ordinary
    // narration that happens to contain the word "casts". "at <target>" + "for <dice>"
    // together trigger a spell attack roll; either or both may be omitted for a
    // no-attack-roll spell (buffs, utility, or a save the DM resolves separately).
    const castMatch = command.match(
      /^(.+?)\s+casts?\s+(.+?)(?:\s+at\s+(.+?))?\s*\((cantrip|[1-9](?:st|nd|rd|th))(?:\s+level)?\)(?:\s+for\s+(\d*d\d+(?:\s*[+-]\s*\d+)?))?\s*[.!?]?$/i
    );
    if (castMatch) {
      const caster = findTokenByName(state, castMatch[1]);
      if (!caster) return { state, message: "I could not find who's casting." };
      let target = null;
      if (castMatch[3]) {
        target = findTokenByName(state, castMatch[3]);
        if (!target) return { state, message: "I could not find the spell's target." };
      }
      const level = castMatch[4].toLowerCase() === "cantrip" ? 0 : Number(castMatch[4].match(/\d/)[0]);
      return castSpell(state, caster.id, {
        level,
        spellName: castMatch[2].trim(),
        targetId: target ? target.id : null,
        damageDice: castMatch[5] ? castMatch[5].replace(/\s+/g, "") : undefined
      });
    }

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
    ABILITY_KEYS,
    abilityModifier,
    applyDamage,
    applyHealing,
    attack,
    addToken,
    castSpell,
    conditionList,
    createState,
    currentGrid,
    feetPerSquare,
    gridMoveCost,
    hasRealMapData,
    moveToken,
    nextTurn,
    parseCommand,
    removeToken,
    rollSavingThrow,
    savingThrowBonus,
    setActiveMap,
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
