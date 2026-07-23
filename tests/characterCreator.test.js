const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScriptsInto } = require("./load-script");

const sharedWindow = loadScriptsInto({}, ["engine/characterCreator.js"]);
const Creator = sharedWindow.CampaignOSCharacterCreator;

test("abilityModifier follows the standard 5e modifier table", () => {
  assert.equal(Creator.abilityModifier(10), 0);
  assert.equal(Creator.abilityModifier(11), 0);
  assert.equal(Creator.abilityModifier(15), 2);
  assert.equal(Creator.abilityModifier(8), -1);
  assert.equal(Creator.abilityModifier(20), 5);
  assert.equal(Creator.abilityModifier(1), -5);
});

test("proficiencyBonus scales in the standard four-level bands", () => {
  assert.equal(Creator.proficiencyBonus(1), 2);
  assert.equal(Creator.proficiencyBonus(4), 2);
  assert.equal(Creator.proficiencyBonus(5), 3);
  assert.equal(Creator.proficiencyBonus(8), 3);
  assert.equal(Creator.proficiencyBonus(9), 4);
  assert.equal(Creator.proficiencyBonus(12), 4);
  assert.equal(Creator.proficiencyBonus(13), 5);
  assert.equal(Creator.proficiencyBonus(16), 5);
  assert.equal(Creator.proficiencyBonus(17), 6);
  assert.equal(Creator.proficiencyBonus(20), 6);
});

test("computeHp uses max hit die at level 1 plus the average roll for each level after", () => {
  // Fighter is a d10 class; average roll per PHB's fixed-HP rule is floor(10/2)+1 = 6.
  assert.equal(Creator.computeHp("Fighter", 1, 2), 12); // 10 + 2
  assert.equal(Creator.computeHp("Fighter", 5, 2), 44); // 12 + (6 + 2) * 4
  // A very low CON at level 1 should still floor at 1 HP, not go negative.
  assert.equal(Creator.computeHp("Wizard", 1, -5), 1);
});

test("computeCharacter derives AC, saves, skills, and attack from a level-1 Fighter draft", () => {
  const character = Creator.computeCharacter({
    name: "Test Fighter",
    className: "Fighter",
    level: 1,
    abilityScores: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
    proficientSkills: ["Athletics", "Perception"],
    attack: { weaponName: "Longsword", diceSize: "1d8", ability: "STR" }
  });

  assert.equal(character.proficiencyBonus, 2);
  assert.equal(character.ac, 12); // 10 + DEX mod (+2), no override given
  assert.equal(character.hp, 12); // 10 (d10) + CON mod (+2)
  assert.equal(character.initiativeBonus, 2);
  // Fighter is proficient in STR and CON saves: +5 (STR +3 mod +2 prof), +4 (CON +2 mod +2 prof)
  assert.deepEqual(character.savingThrows, [
    { ability: "STR", bonus: 5 },
    { ability: "CON", bonus: 4 }
  ]);
  assert.deepEqual(character.skills, [
    { name: "Athletics", bonus: 5 }, // STR +3 mod + 2 prof
    { name: "Perception", bonus: 3 } // WIS +1 mod + 2 prof
  ]);
  assert.equal(character.passivePerception, 13); // 10 + WIS(+1) + prof(2), proficient
  assert.equal(character.attack.toHit, 5); // STR +3 mod + 2 prof
  assert.equal(character.attack.damageDice, "1d8+3");
  assert.equal(character.spellcasting, null);
});

test("computeCharacter respects an explicit AC override instead of the default formula", () => {
  const character = Creator.computeCharacter({
    name: "Armored", className: "Cleric", level: 1,
    abilityScores: { STR: 12, DEX: 10, CON: 14, INT: 10, WIS: 15, CHA: 10 },
    ac: 18
  });
  assert.equal(character.ac, 18);
});

test("computeCharacter fills in spellcasting numbers only when isCaster is set", () => {
  const wizard = Creator.computeCharacter({
    name: "Test Wizard", className: "Wizard", level: 3,
    abilityScores: { STR: 8, DEX: 14, CON: 12, INT: 17, WIS: 10, CHA: 10 },
    spellcasting: { isCaster: true, ability: "INT", spellsKnown: "Magic Missile, Shield" }
  });
  assert.ok(wizard.spellcasting);
  assert.equal(wizard.spellcasting.ability, "INT");
  assert.equal(wizard.spellcasting.dc, 13); // 8 + prof(2) + INT mod(3)
  assert.equal(wizard.spellcasting.attackBonus, 5);
  assert.equal(wizard.spellcasting.spellsKnown, "Magic Missile, Shield");
});

test("characterMarkdown renders the ability score table, attacks table, and N/A spellcasting for a non-caster", () => {
  const character = Creator.computeCharacter({
    name: "Grix Ironhide", race: "Dwarf", className: "Barbarian", level: 2,
    background: "Soldier", alignment: "Chaotic Neutral",
    abilityScores: { STR: 17, DEX: 13, CON: 16, INT: 8, WIS: 10, CHA: 8 },
    attack: { weaponName: "Greataxe", diceSize: "1d12", ability: "STR" },
    personality: { traits: "Loud", ideals: "Freedom", bonds: "Clan", flaws: "Reckless" },
    backstory: "Left the mountain to see the world."
  });
  const markdown = Creator.characterMarkdown(character);

  assert.match(markdown, /^# Grix Ironhide/);
  assert.match(markdown, /\*\*Race:\*\* Dwarf/);
  assert.match(markdown, /\*\*Class & Level:\*\* Barbarian 2/);
  assert.match(markdown, /\| 17 \(\+3\) \| 13 \(\+1\) \| 16 \(\+3\) \| 8 \(-1\) \| 10 \(\+0\) \| 8 \(-1\) \|/);
  assert.match(markdown, /### Attacks/);
  assert.match(markdown, /\| Greataxe \| \+5 \| 1d12\+3 \|/);
  assert.match(markdown, /Spellcasting ability: N\/A/);
  assert.match(markdown, /Spell save DC \/ attack bonus: N\/A/);
  assert.match(markdown, /Left the mountain to see the world\./);
});

test("fileNameForCharacter sanitizes filesystem-unsafe characters", () => {
  assert.equal(Creator.fileNameForCharacter("Darkhawk Blondin"), "Darkhawk Blondin.md");
  assert.equal(Creator.fileNameForCharacter('Bad/Name:"Test"'), "BadNameTest.md");
  assert.equal(Creator.fileNameForCharacter("  "), "Character.md");
});

test("validateDraft reports missing name, invalid class, and out-of-range ability scores", () => {
  const errors = Creator.validateDraft({
    name: "",
    className: "Necromancer",
    abilityScores: { STR: 40, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }
  });
  assert.ok(errors.some((e) => /Name is required/.test(e)));
  assert.ok(errors.some((e) => /Class must be one of/.test(e)));
  assert.ok(errors.some((e) => /Strength score must be between/.test(e)));
});

test("validateDraft returns no errors for a valid draft", () => {
  const errors = Creator.validateDraft({
    name: "Valid Character",
    className: "Fighter",
    abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }
  });
  assert.deepEqual(errors, []);
});
