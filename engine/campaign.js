(function () {
  const categoryRules = [
    { id: "characters", label: "Characters", patterns: [/character/i, /player/i, /npc/i, /characters?[\\/]/i, /npcs?[\\/]/i] },
    { id: "locations", label: "Locations", patterns: [/location/i, /place/i, /settlement/i, /locations?[\\/]/i, /maps?[\\/]/i] },
    { id: "sessions", label: "Sessions", patterns: [/session/i, /recap/i, /journal/i, /sessions?[\\/]/i] },
    { id: "notes", label: "Notes", patterns: [] }
  ];

  function createCampaign() {
    return {
      name: "No campaign imported",
      importedAt: null,
      files: [],
      categories: {
        characters: [],
        locations: [],
        sessions: [],
        notes: []
      }
    };
  }

  async function importMarkdownFiles(fileList) {
    const files = Array.from(fileList).filter((file) => file.name.toLowerCase().endsWith(".md"));
    const campaign = createCampaign();
    campaign.name = inferCampaignName(files);
    campaign.importedAt = new Date().toISOString();

    for (const file of files) {
      const text = await file.text();
      const item = buildItem(file, text);
      campaign.files.push(item);
      campaign.categories[item.category].push(item);

      extractLocationEntries(item).forEach((locationItem) => {
        campaign.files.push(locationItem);
        campaign.categories.locations.push(locationItem);
      });

      extractSessionEntries(item).forEach((sessionItem) => {
        campaign.files.push(sessionItem);
        campaign.categories.sessions.push(sessionItem);
      });
    }

    return campaign;
  }

  function inferCampaignName(files) {
    if (!files.length) return "Empty import";
    const firstPath = files[0].webkitRelativePath || files[0].name;
    return firstPath.split(/[\\/]/)[0] || "Imported campaign";
  }

  function buildItem(file, text) {
    const path = file.webkitRelativePath || file.name;
    const title = extractTitle(text) || titleFromFileName(file.name);
    const category = classify(path, text);
    const isCharacterToken = canSpawnCharacterToken(path, category);

    return {
      id: `${path}-${file.lastModified}`,
      title,
      path,
      category,
      canSpawnToken: isCharacterToken,
      isTemplate: isTemplatePath(path),
      summary: summarize(text),
      wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
      text
    };
  }

  function extractTitle(text) {
    const heading = text.match(/^#\s+(.+)$/m);
    return heading ? heading[1].trim() : "";
  }

  function titleFromFileName(name) {
    return name
      .replace(/\.md$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function classify(path, text) {
    if (isWorldState(path)) return "notes";
    if (isSessionLog(path)) return "notes";
    if (isCampaignIndex(path)) return "notes";
    if (/(^|[\\/])characters?[\\/]/i.test(path) || /(^|[\\/])npcs?[\\/]/i.test(path)) return "characters";
    if (/(^|[\\/])locations?[\\/]/i.test(path) || /(^|[\\/])maps?[\\/]/i.test(path)) return "locations";
    if (/(^|[\\/])sessions?[\\/]/i.test(path)) return "sessions";

    const haystack = `${path}\n${text.slice(0, 800)}`;
    const match = categoryRules.find((rule) => rule.patterns.some((pattern) => pattern.test(haystack)));
    return match?.id || "notes";
  }

  function isCampaignIndex(path) {
    return /(^|[\\/])(active|overview|campaign)\.md$/i.test(path);
  }

  function isWorldState(path) {
    return /(^|[\\/])world-state\.md$/i.test(path);
  }

  function isSessionLog(path) {
    return /(^|[\\/])session-log\.md$/i.test(path);
  }

  // session-log.md keeps every session in one running file (## Session N -- date
  // headings), so the campaign browser only ever showed a single "Session Log" item --
  // no way to jump straight to session 15. Split on those headings into individually
  // browsable/searchable entries instead, the same way extractLocationEntries pulls
  // named places out of world-state.md's table.
  function extractSessionEntries(item) {
    if (!isSessionLog(item.path)) return [];
    const lines = (item.text || "").split(/\r?\n/);
    const headingIndices = [];
    lines.forEach((line, index) => {
      if (/^##\s+.*session\s+\d+/i.test(line)) headingIndices.push(index);
    });
    if (!headingIndices.length) return [];

    return headingIndices.map((startIndex, position) => {
      const endIndex = position + 1 < headingIndices.length ? headingIndices[position + 1] : lines.length;
      const heading = lines[startIndex].replace(/^##\s+/, "").trim();
      const body = lines.slice(startIndex + 1, endIndex).join("\n");
      return buildSessionItem(item, heading, body);
    });
  }

  function buildSessionItem(sourceItem, heading, body) {
    return {
      id: `${sourceItem.path}#session-${slugify(heading)}`,
      title: heading,
      path: sourceItem.path,
      category: "sessions",
      canSpawnToken: false,
      isTemplate: sourceItem.isTemplate,
      summary: summarize(body),
      wordCount: body.trim() ? body.trim().split(/\s+/).length : 0,
      text: `# ${heading}\n\n${body}`,
      sourceKind: "session-entry"
    };
  }

  // Matches a path segment that is "template" once an optional leading underscore
  // (this campaign's convention: characters/_template.md, campaigns/_template/) and a
  // trailing file extension are stripped -- not just any file/folder with "template" in it.
  function isTemplatePath(path) {
    return /(^|[\\/])_?template(\.[a-z0-9]+)?([\\/]|$)/i.test(path || "");
  }

  // world-state.md never gets its own per-place files in this campaign format --
  // named locations only exist as rows in a "Known Locations" style table inside it.
  // Pull those rows out as individually browsable/openable location items instead of
  // treating the whole tracker file as one oddly-titled "location".
  function extractLocationEntries(item) {
    if (!isWorldState(item.path)) return [];
    const lines = (item.text || "").split(/\r?\n/);
    const entries = [];
    let index = 0;

    while (index < lines.length) {
      if (/^#{1,4}\s*.*location/i.test(lines[index])) {
        index = consumeLocationTable(lines, index + 1, entries, item);
      } else {
        index += 1;
      }
    }

    return entries;
  }

  function consumeLocationTable(lines, start, entries, item) {
    let index = start;
    while (index < lines.length && !lines[index].trim()) index += 1;
    if (!isTableRow(lines[index]) || !isSeparatorRow(lines[index + 1])) return index;
    index += 2;

    while (index < lines.length && isTableRow(lines[index])) {
      const cells = splitTableRow(lines[index]);
      const name = cleanLocationName(cells[0] || "");
      if (name) entries.push(buildLocationItem(item, name, cells.slice(1).join(" -- ")));
      index += 1;
    }

    return index;
  }

  function buildLocationItem(sourceItem, name, status) {
    const plainStatus = (status || "").replace(/\*+/g, "").trim();
    return {
      id: `${sourceItem.path}#location-${slugify(name)}`,
      title: name,
      path: sourceItem.path,
      category: "locations",
      canSpawnToken: false,
      isTemplate: sourceItem.isTemplate,
      summary: plainStatus.slice(0, 220) || "No status recorded.",
      wordCount: plainStatus ? plainStatus.split(/\s+/).length : 0,
      text: `# ${name}\n\n${status || ""}`,
      sourceKind: "location-entry"
    };
  }

  function cleanLocationName(rawCell) {
    return rawCell
      .replace(/\*+/g, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();
  }

  function slugify(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "location";
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

  function canSpawnCharacterToken(path, category) {
    return category === "characters" && !isCampaignIndex(path) && /(^|[\\/])(characters?|npcs?)[\\/]/i.test(path);
  }

  function isNpcPath(path) {
    return /(^|[\\/])npcs?[\\/]/i.test(path || "");
  }

  function summarize(text) {
    const paragraphs = text
      .replace(/^#.*$/gm, "")
      .split(/\n\s*\n/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return paragraphs[0]?.slice(0, 220) || "No preview text.";
  }

  function tokenDraftFromItem(item) {
    const fields = extractFields(item.text || "");
    const attackRows = extractAttackRows(item.text || "");
    const attack = attackRows ? attackRows[0] : null;
    const name = item.title || fields.name || "Campaign Character";
    const maxHp = readNumber(fields.hp || fields.hitpoints || fields["hit points"], 12);
    const initiativeBonus = readNumber(fields["initiative bonus"] || fields.initiative || fields.init, 0);
    const draft = {
      name,
      icon: name.slice(0, 2).toUpperCase(),
      type: /npc/i.test(item.path) ? "monster" : "hero",
      hp: maxHp,
      maxHp,
      ac: readNumber(fields.ac || fields["armor class"], 12),
      attackBonus: attack?.attackBonus ?? readNumber(fields.attack || fields["attack bonus"], 3),
      damageDice: attack?.damageDice || fields.damage || fields["damage dice"] || "1d6+1",
      speed: readNumber(fields.speed, 30),
      initiative: rollDie(20) + initiativeBonus,
      conditions: [],
      sourcePath: item.path
    };

    // Multiattack: an NPC sheet's Attacks table can list every attack in a Multiattack
    // action (e.g. a devil's two Claws + one Sting) as separate rows. Fold all of them into
    // `attacks` so the encounter engine resolves the whole action, not just the first row.
    // Scoped to npcs/ -- PC sheets under characters/ use that same table shape to list
    // weapon *options* (main-hand/off-hand/javelin), not a Multiattack fired every turn.
    if (isNpcPath(item.path) && attackRows && attackRows.length > 1) {
      draft.attacks = attackRows.map((row) => ({
        name: row.name,
        attackBonus: row.attackBonus ?? draft.attackBonus,
        damageDice: row.damageDice || draft.damageDice
      }));
    }

    return draft;
  }

  function extractFields(text) {
    const fields = {};
    text.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*(?:[-*]\s*)?\*{0,2}([A-Za-z ]+)\*{0,2}\s*[:|-]\s*(.+?)\s*$/);
      if (match) fields[match[1].trim().toLowerCase()] = match[2].replace(/\*+/g, "").trim();
    });
    return fields;
  }

  // Character sheets in this campaign format put real combat numbers in an "### Attacks"
  // markdown table (columns like "To Hit" / "Damage"), not a flat "Attack Bonus:" line --
  // extractFields alone can't see them, so imported PCs were defaulting to a generic +3/1d6+1.
  // Returns every consecutive data row as {name, attackBonus, damageDice} (name from the
  // row's first cell, e.g. "Claw" or "Main-hand longsword"), or null if there's no table.
  function extractAttackRows(text) {
    const lines = text.split(/\r?\n/);
    const headingIndex = lines.findIndex((line) => /^#{1,4}\s+attacks\b/i.test(line.trim()));
    if (headingIndex === -1) return null;

    const searchLimit = Math.min(lines.length, headingIndex + 8);
    let index = headingIndex + 1;
    while (index < searchLimit) {
      if (/^#{1,4}\s+/.test(lines[index])) return null;
      if (isTableRow(lines[index]) && isSeparatorRow(lines[index + 1])) break;
      index += 1;
    }
    if (index >= searchLimit || !isTableRow(lines[index]) || !isSeparatorRow(lines[index + 1])) return null;

    const headerCells = splitTableRow(lines[index]).map((cell) => cell.toLowerCase());
    const toHitIndex = headerCells.findIndex((cell) => cell.includes("to hit"));
    const damageIndex = headerCells.findIndex((cell) => cell.includes("damage"));
    if (toHitIndex === -1 || damageIndex === -1) return null;

    const rows = [];
    let rowIndex = index + 2;
    while (rowIndex < lines.length && isTableRow(lines[rowIndex])) {
      const cells = splitTableRow(lines[rowIndex]);
      const attackBonus = readNumber(cells[toHitIndex], null);
      const damageMatch = (cells[damageIndex] || "").match(/\d*d\d+(?:\s*[+-]\s*\d+)?/i);
      const damageDice = damageMatch ? damageMatch[0].replace(/\s+/g, "") : null;
      if (attackBonus !== null || damageDice) {
        const name = (cells[0] || "").replace(/\*+/g, "").trim() || null;
        rows.push({ name, attackBonus, damageDice });
      }
      rowIndex += 1;
    }

    return rows.length ? rows : null;
  }

  function readNumber(value, fallback) {
    const match = String(value || "").match(/-?\d+/);
    return match ? Number(match[0]) : fallback;
  }

  function rollDie(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }

  window.CampaignOSCampaign = {
    categoryRules,
    createCampaign,
    importMarkdownFiles,
    classify,
    canSpawnCharacterToken,
    isTemplatePath,
    tokenDraftFromItem
  };
})();
