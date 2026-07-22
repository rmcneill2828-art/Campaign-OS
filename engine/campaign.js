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

    return {
      id: `${path}-${file.lastModified}`,
      title,
      path,
      category,
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
    const haystack = `${path}\n${text.slice(0, 800)}`;
    const match = categoryRules.find((rule) => rule.patterns.some((pattern) => pattern.test(haystack)));
    return match?.id || "notes";
  }

  function summarize(text) {
    const paragraphs = text
      .replace(/^#.*$/gm, "")
      .split(/\n\s*\n/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return paragraphs[0]?.slice(0, 220) || "No preview text.";
  }

  window.CampaignOSCampaign = {
    categoryRules,
    createCampaign,
    importMarkdownFiles
  };
})();
