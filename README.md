# Homebrew Importer (D&D 5e) — Foundry VTT module

Paste homebrew **spells, species/races, classes, subclasses and feats** straight from a PDF, a website
or Homebrewery, press **Parse**, check what was detected, and import them as ready-to-use dnd5e items.
Works with both **2014** and **2024** layouts. Built for **Foundry v13–v14** and **dnd5e 5.3 / 6.x**.

## Install
1. In Foundry's setup screen open **Add-on Modules → Install Module**.
2. Paste this into **Manifest URL** and click **Install**:
   ```
   https://raw.githubusercontent.com/siller94-art/foundry-homebrew-importer/main/module.json
   ```
3. Enable **Homebrew Importer (D&D 5e)** in your world. The **Items** sidebar gets an **Import Homebrew** button.

## Using it
1. Paste text into the left box (or **Open file** for a .txt/.md file). Several entries can go in at once:
   spells split automatically, and other entries are separated with a line of `---`
   (Homebrewery `\page` breaks also work).
2. With **Auto parse** on, the right side updates as you paste. Each entry gets a card with a ✓ for every
   field it found and a ⚠ for anything it couldn't work out.
3. Fix anything flagged: change the content type or edition at the top, set **Parent class** for subclasses
   that don't name one, or open **Edit parsed data** and change it directly.
4. Pick a source book name and destination (world items or an unlocked compendium) and press **Import**.

See `examples/example-paste.txt` for sample text in both editions.

### What the parser reads
| Type | Recognised by | Pulls out |
|---|---|---|
| Spell | `3rd-level evocation`, `Level 3 Evocation (Wizard)`, `Evocation Cantrip` | Casting time, range, components, duration, ritual, saves, spell attacks, damage, healing, area, higher-level scaling, class list |
| Species | `Creature Type:`, `Size`, `Speed`, `Ability Score Increase.` | Type, size, speeds, darkvision, languages, resistances, skills, 2014 ability increases, every trait as a feature |
| Class | `Hit Point Die:` / `Hit Dice:`, `Saving Throws` | Hit die, saves, skills, armor and weapons, spellcasting, subclass level, ASI levels, features by level (`Level 3: X` or "At 3rd level…") |
| Subclass | `Barbarian Subclass` line or the Parent class box | Features by level, third-caster spellcasting |
| Feat | `Origin Feat`, `General Feat (Prerequisite: …)`, `Prerequisite:` | Category, prerequisite, description |

Pasting the module's JSON format (below) instead of text also works and skips the parser.

### Macro API
```js
const hbi = game.modules.get("homebrew-importer").api;
hbi.open();                                             // open the window
await hbi.importText(text, { book: "Marks of Aeyra", target: "world.homebrew" });
```

## JSON format (advanced)
### What it creates
| JSON key | Foundry item | Notes |
|---|---|---|
| `spells` | `spell` | Parses casting time, range, area, components, duration; builds attack/save/damage/heal **activities** |
| `species` / `races` | `race` | Size, speed, senses, languages, resistances, skills, optional fixed ASIs (2014); features become linked feat items via ItemGrant |
| `classes` | `class` | Hit die, saves, proficiencies, skill choices, multiclass profs, spellcasting progression, subclass level, ASI levels, scale values, features by level |
| `subclasses` | `subclass` | Linked to the class via `class` name → identifier |
| `feats` | `feat` | `category`: origin / general / fighting style / epic boon |
| `items` | any | Raw passthrough: any entry with `type` + `system` is imported as-is |

Any entry in any list that already contains a `system` object is passed through untouched, so you
can hand-tune anything the simple format doesn't cover (backgrounds, magic items, monsters' features).

## Editions
Set `"source": { "book": "...", "rules": "2014" | "2024" }` at the top, or `"rules"` per entry.
The edition is stored in `system.source.rules` and is part of the duplicate-matching key, so you can
import a 2014 and a 2024 version of the same spell side by side. Higher-level text is labelled
"At Higher Levels" (2014) or "Using a Higher-Level Spell Slot" / "Cantrip Upgrade" (2024).

## Re-importing
Every imported item is flagged with a key (`type:name:rules`). Re-importing with **Update previously
imported** checked overwrites those items in place (keeping their IDs, so links on actors stay
valid); unchecked, they're skipped.

## Field reference (simple format)
**Spell:** `name, level, school, castingTime, range, area, components, duration, concentration, ritual,
attack ("melee"|"ranged"), save ({ability, onSave}), damage (["2d6 fire"] or [{dice,type,scaling}]),
healing ({dice, scaling}), targets ({count,type}), description, higherLevels, classes, img`

**Species:** `name, creatureType, size, speed ({walk,swim,fly,climb,burrow,hover}), senses ({darkvision,...}),
languages, languageChoices, resistances, immunities, conditionImmunities, skills, skillChoices,
abilityScores ({str:2, con:1}), features [{name, description, uses}]`

**Class:** `name, hitDie, primaryAbility, savingThrows, armor, weapons, tools, skills ({count, from}),
multiclass ({armor, weapons, tools}), spellcasting ({progression: full|half|third|pact|artificer, ability}),
subclassLevel, subclassTitle, asiLevels, scaleValues [{title, values:{level:value}}], features [{level, name, description, uses}]`

**Subclass:** `name, class, spellcasting, scaleValues, features [{level, ...}]`

**Feature uses:** `{ "max": "@prof", "recovery": "lr" | "sr" | "day" | "dawn" | "dusk" }`

Descriptions accept plain text (blank line = new paragraph, `**bold**`, `*italic*`) or raw HTML.

## Known limits
- Homebrew **languages** that aren't registered in `CONFIG.DND5E.languages` won't display in the
  Trait advancement; register them with a small world script or mention them in the description.
- Spell **class lists** are stored in `flags.homebrew-importer.classes` (dnd5e manages spell lists separately).
- Complex mechanics (conditional riders, effects) import as description text; add Active Effects by hand
  or via raw `system`/`effects` passthrough.
- dnd5e changes its data model between major versions; if a field is ignored after a system update,
  check the console and adjust the matching builder in `scripts/importer.js`.
