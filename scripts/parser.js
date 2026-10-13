/**
 * Plain-text parser: turns spells, species, classes, subclasses and feats copied from
 * PDFs, websites or Homebrewery into the importer's entry format.
 * Pure functions (no Foundry calls) except languageLabels(), which reads CONFIG when present.
 */

const SCHOOL = "(abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)";
const ABILITY_NAMES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const DAMAGE_TYPES = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";
const SKILL_NAMES = ["acrobatics", "animal handling", "arcana", "athletics", "deception", "history", "insight", "intimidation",
  "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight of hand", "stealth", "survival"];
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const FULL_CASTERS = ["bard", "cleric", "druid", "sorcerer", "wizard"];
const HALF_CASTERS = ["paladin", "ranger", "artificer"];
const SMALL_WORDS = new Set(["of", "the", "and", "to", "a", "an", "in", "on", "for", "with", "from", "or"]);
const SUBCLASS_WORDS = "path|oath|tradition|domain|circle|archetype|college|patron|origin|subclass|way|school|conclave|order";

const lc = s => String(s ?? "").trim().toLowerCase();
const num = w => NUMBER_WORDS[lc(w)] ?? (Number(w) || 0);
const unique = a => [...new Set(a)];

/* -------------------------------------------- */
/*  Text cleanup                                */
/* -------------------------------------------- */

export const SPLIT = "\u0000SPLIT";

/** Normalize pasted text: Homebrewery markdown, HTML, PDF line breaks. Returns an array of paragraph lines ("" = break). */
export function cleanText(raw) {
  let t = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2013]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const lines = [];
  for (let line of t.split("\n")) {
    const s = line.trim();
    if (/^(-{3,}|={3,}|\\page(break)?\b.*)$/i.test(s)) { lines.push(SPLIT); continue; }
    if (/^(\{\{.*|\}\}|:{2,}|_{3,}|\\column\b.*|\|.*\|)$/.test(s)) { lines.push(""); continue; }
    line = s
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*•]\s+/, "")
      .replace(/(\*{1,3}|_{1,3})(\S(?:.*?\S)?)\1/g, "$2")
      .replace(/\*+/g, "")
      .trim();
    lines.push(line);
  }

  // Re-join lines that a PDF broke mid-sentence.
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (l && prev && prev !== SPLIT) {
      if (/[a-z]-$/.test(prev) && /^[a-z]/.test(l)) { out[out.length - 1] = prev.slice(0, -1) + "-" + l; continue; }
      if (!/[.:!?)"]$/.test(prev) && /^[a-z(0-9]/.test(l) && !matchSpellHead(l)) { out[out.length - 1] = `${prev} ${l}`; continue; }
    }
    out.push(l);
  }
  return out;
}

/* -------------------------------------------- */
/*  Spells                                      */
/* -------------------------------------------- */

export function matchSpellHead(line) {
  const s = String(line ?? "").trim();
  let m = s.match(new RegExp(`^(\\d)(?:st|nd|rd|th)[- ]level\\s+${SCHOOL}(?:\\s*\\((ritual)\\))?\\s*$`, "i"));
  if (m) return { level: Number(m[1]), school: lc(m[2]), ritual: !!m[3], classes: [], rules: "2014" };
  m = s.match(new RegExp(`^level\\s+(\\d)\\s+${SCHOOL}(?:\\s*\\(([^)]*)\\))?\\s*$`, "i"));
  if (m) return { level: Number(m[1]), school: lc(m[2]), ritual: false, classes: splitList(m[3]), rules: "2024" };
  m = s.match(new RegExp(`^${SCHOOL}\\s+cantrip(?:\\s*\\(([^)]*)\\))?\\s*$`, "i"));
  if (m) return { level: 0, school: lc(m[1]), ritual: false, classes: splitList(m[2]), rules: m[2] ? "2024" : null };
  return null;
}

const splitList = s => (s ? s.split(/,|\band\b/).map(x => x.trim()).filter(Boolean) : []);

function parseSpell(lines) {
  const found = [], warnings = [];
  const hi = lines.findIndex(l => matchSpellHead(l));
  const head = matchSpellHead(lines[hi]);
  const name = lines.slice(0, hi).filter(Boolean).pop() ?? "Unnamed spell";
  const e = { name, level: head.level, school: head.school };
  let rules = head.rules;
  found.push(head.level ? `Level ${head.level}` : "Cantrip", cap(head.school));
  if (head.ritual) e.ritual = true;
  if (head.classes.length) e.classes = head.classes;

  const desc = [];
  for (const l of lines.slice(hi + 1)) {
    if (!l || l === SPLIT) continue;
    const m = l.match(/^(casting time|range|components|duration|area|target|classes|spell lists?)\s*:\s*(.+)$/i);
    if (!m) { desc.push(l); continue; }
    const key = lc(m[1]), val = m[2].trim();
    if (key === "casting time") {
      e.castingTime = val; found.push("Casting time");
      if (/\britual\b/i.test(val)) { e.ritual = true; e.castingTime = val.replace(/\s*or ritual/i, ""); }
      if (/^(action|bonus action|reaction|magic action)\b/i.test(val)) rules ??= "2024";
    } else if (key === "range") { e.range = val; found.push("Range"); }
    else if (key === "components") { e.components = val; found.push("Components"); }
    else if (key === "duration") { e.duration = val; found.push("Duration"); }
    else if (key === "area") e.area = val;
    else e.classes = splitList(val);
  }
  for (const [k, label] of [["castingTime", "Casting time"], ["range", "Range"], ["components", "Components"], ["duration", "Duration"]]) {
    if (!e[k]) warnings.push(`${label} not found`);
  }

  // Higher-level text
  const hiIdx = desc.findIndex(p => /^(at higher levels|using a higher-level spell slot|cantrip upgrade)\b/i.test(p));
  if (hiIdx >= 0) {
    const p = desc.splice(hiIdx, 1)[0];
    rules ??= /^at higher levels/i.test(p) ? "2014" : "2024";
    e.higherLevels = p.replace(/^(at higher levels|using a higher-level spell slot|cantrip upgrade)\.?\s*/i, "");
    found.push("Higher levels");
  }
  e.description = desc.join("\n\n");
  if (!e.description) warnings.push("No description text");

  // Mechanics from the rules text
  const text = desc.join(" ");
  const save = text.match(new RegExp(`\\b(${ABILITY_NAMES.join("|")}) saving throw`, "i"));
  const attack = text.match(/\b(melee|ranged) spell attack/i);
  if (attack) { e.attack = lc(attack[1]); found.push(`${cap(e.attack)} spell attack`); }
  else if (save) { e.save = { ability: lc(save[1]).slice(0, 3), onSave: /half as much/i.test(text) ? "half" : "none" }; found.push(`${cap(save[1])} save`); }

  const dmgRe = new RegExp(`(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?)\\s+(${DAMAGE_TYPES})\\s+damage`, "gi");
  const damage = unique([...text.matchAll(dmgRe)].map(m => `${m[1].replace(/\s+/g, "")} ${lc(m[2])}`));
  const heal = text.match(/regains?\s+(?:a number of\s+)?hit points\s+equal to\s+(\d+d\d+)/i) ?? text.match(/regains?\s+(\d+d\d+)\s+hit points/i);
  const scaleDie = (e.higherLevels ?? "").match(/increases?\s+by\s+(\d+d\d+)/i)?.[1];

  if (damage.length) {
    e.damage = damage.map((d, i) => {
      const [dice, type] = d.split(" ");
      return i === 0 && scaleDie && e.level > 0 ? { dice, type, scaling: scaleDie } : { dice, type };
    });
    found.push(`Damage ${damage.join(", ")}`);
  }
  if (heal) {
    e.healing = scaleDie && e.level > 0 && !damage.length ? { dice: heal[1], scaling: scaleDie } : { dice: heal[1] };
    found.push(`Healing ${heal[1]}`);
  }
  if (e.level === 0 && damage.length && e.higherLevels) warnings.push("Cantrip damage scaling: check the formula on the sheet");

  if (!/\(.*(foot|feet)/i.test(e.range ?? "") && !e.area) {
    const area = text.match(/(\d+)-foot(?:[- ](?:radius|long|wide|tall|high))*[^.]{0,30}?\b(sphere|cone|cube|line|cylinder|emanation)\b/i);
    if (area) { e.area = `${area[1]}-foot ${lc(area[2])}`; found.push(`Area ${e.area}`); }
  }
  return { kind: "spell", data: e, rules, found, warnings };
}

/* -------------------------------------------- */
/*  Shared helpers                              */
/* -------------------------------------------- */

const cap = s => String(s ?? "").replace(/\b\w/g, c => c.toUpperCase());

/** "Darkvision. You can see…" or "Size: Medium" → [title, body]; title must look like a heading. */
function splitTrait(line) {
  const m = line.match(/^([A-Z][A-Za-z0-9'(),\- ]{0,48}?)[.:]\s+(.+)$/);
  if (!m) return null;
  const words = m[1].trim().split(/\s+/);
  if (words.length > 6) return null;
  const titled = words.every((w, i) => /^[A-Z0-9(]/.test(w) || (i > 0 && SMALL_WORDS.has(w)));
  return titled ? [m[1].trim(), m[2].trim()] : null;
}

const findAbilities = s => ABILITY_NAMES.filter(a => new RegExp(`\\b${a}\\b`, "i").test(s)).map(a => a.slice(0, 3));
const findSkills = s => SKILL_NAMES.filter(k => new RegExp(`\\b${k}\\b`, "i").test(s));

function languageLabels() {
  const out = {};
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      const label = typeof v === "string" ? v : v?.label;
      if (label) out[lc(game?.i18n?.localize?.(label) ?? label)] = `${prefix}${k}`;
      if (v?.children) walk(v.children, `${prefix}${k}:`);
    }
  };
  if (globalThis.CONFIG?.DND5E?.languages) walk(CONFIG.DND5E.languages, "languages:");
  if (!Object.keys(out).length) {
    for (const l of ["common", "dwarvish", "elvish", "giant", "gnomish", "goblin", "halfling", "orc", "draconic", "infernal", "abyssal", "celestial", "primordial", "sylvan", "undercommon", "deep speech"]) out[l] = l;
  }
  return out;
}

/* -------------------------------------------- */
/*  Species / races                             */
/* -------------------------------------------- */

const LORE_TRAITS = new Set(["age", "alignment", "subrace", "subraces"]);

function parseSpecies(lines) {
  const found = [], warnings = [];
  const body = lines.filter(l => l !== SPLIT);
  const name = body.find(Boolean) ?? "Unnamed species";
  const e = { name, features: [] };
  let rules = null;
  const lore = [];
  let current = null;

  for (const l of body.slice(body.indexOf(name) + 1)) {
    if (!l) continue;
    const t = splitTrait(l);
    if (!t) { if (current) current.description += `\n\n${l}`; else lore.push(l); continue; }
    const [title, text] = t;
    const key = lc(title);
    current = null;

    if (key === "creature type") { e.creatureType = lc(text.split(/[\s(]/)[0]); rules = "2024"; found.push(`Type ${e.creatureType}`); }
    else if (key === "size") {
      e.size = ["tiny", "small", "medium", "large", "huge"].filter(s => new RegExp(`\\b${s}\\b`, "i").test(text));
      found.push(`Size ${e.size.join("/")}`);
    } else if (key === "speed") {
      const speed = { walk: Number(text.match(/(\d+)/)?.[1] ?? 30) };
      for (const m of text.matchAll(/(swim|fly|climb|burrow)(?:ming|ing)?\s+speed\s+(?:of\s+|equal to\s+)?(\d+)?/gi)) speed[lc(m[1])] = Number(m[2] ?? speed.walk);
      e.speed = speed; found.push(`Speed ${speed.walk} ft`);
    } else if (/^ability score (increase|increases)$/.test(key)) {
      const scores = {};
      for (const m of text.matchAll(new RegExp(`(${ABILITY_NAMES.join("|")})\\s+score\\s+increases?\\s+by\\s+(\\d)`, "gi"))) scores[lc(m[1]).slice(0, 3)] = Number(m[2]);
      if (/other ability scores?|ability scores? of your choice/i.test(text)) scores.points = (text.match(/(\w+)\s+other ability scores?/i) ? num(text.match(/(\w+)\s+other ability scores?/i)[1]) : 1);
      e.abilityScores = scores; rules = "2014"; found.push("Ability scores");
    } else if (key === "languages") {
      const labels = languageLabels();
      e.languages = Object.keys(labels).filter(l => new RegExp(`\\b${l}\\b`, "i").test(text)).map(l => labels[l]);
      const extra = text.match(/(\w+)\s+(?:other|extra|additional)\s+languages?/i);
      if (extra) e.languageChoices = num(extra[1]) || 1;
      found.push("Languages");
    } else if (LORE_TRAITS.has(key)) {
      lore.push(`**${title}.** ${text}`);
    } else {
      current = { name: title, description: text };
      e.features.push(current);
    }
  }

  // Mechanics hidden inside traits
  const all = e.features.map(f => `${f.name}. ${f.description}`).join(" ");
  const dvFeature = e.features.find(f => /darkvision/i.test(f.name));
  const dv = (dvFeature?.description.match(/(\d+)\s*feet/i)) ?? all.match(/darkvision[^.]*?(\d+)\s*feet/i);
  if (dv) { e.senses = { darkvision: Number(dv[1]) }; found.push(`Darkvision ${dv[1]} ft`); }
  const res = unique([...all.matchAll(new RegExp(`resistance to (${DAMAGE_TYPES}) damage`, "gi"))].map(m => lc(m[1])));
  if (res.length) { e.resistances = res; found.push(`Resists ${res.join(", ")}`); }
  const skills = unique([...all.matchAll(/proficiency in the ([a-z ]+?) skill/gi)].map(m => lc(m[1])).filter(s => SKILL_NAMES.includes(s)));
  if (skills.length) { e.skills = skills; found.push(`Skills ${skills.join(", ")}`); }
  const swim = all.match(/(swim|fly|climb)(?:ming|ing)? speed (?:of |equal to )?(\d+)?/i);
  if (swim) { e.speed ??= { walk: 30 }; e.speed[lc(swim[1])] ??= Number(swim[2] ?? e.speed.walk); }

  e.description = lore.join("\n\n");
  if (e.features.length) found.push(`${e.features.length} traits`);
  if (!e.size) warnings.push("Size not found (defaulting to Medium)");
  if (!e.speed) warnings.push("Speed not found (defaulting to 30 ft)");
  return { kind: "species", data: e, rules, found, warnings };
}

/* -------------------------------------------- */
/*  Features (classes and subclasses)           */
/* -------------------------------------------- */

const isTableRow = l => /^\d+(st|nd|rd|th)?\s+\+\d/.test(l) || /\t/.test(l) || /^level\s+proficiency bonus/i.test(l);
const looksLikeHeading = l => {
  if (!l || l.length > 60 || /[.:!?]$/.test(l)) return false;
  const words = l.split(/\s+/);
  return words.length <= 7 && words.every((w, i) => /^[A-Z0-9(]/.test(w) || (i > 0 && SMALL_WORDS.has(w)));
};

function parseFeatures(lines, defaultLevel, { stopAtFirst = false } = {}) {
  const features = [];
  const intro = [];
  let cur = null;
  let lastLevel = defaultLevel;
  const has2024 = lines.some(l => /^level\s+\d+\s*:/i.test(l));

  for (const l of lines) {
    if (!l || l === SPLIT || isTableRow(l)) continue;
    const m24 = l.match(/^level\s+(\d+)\s*:\s*(.+)$/i);
    if (m24) { cur = { level: Number(m24[1]), name: m24[2].trim(), description: "" }; features.push(cur); continue; }
    if (!has2024 && looksLikeHeading(l)) { cur = { level: null, name: l, description: "" }; features.push(cur); continue; }
    if (cur) cur.description += (cur.description ? "\n\n" : "") + l;
    else intro.push(l);
  }
  for (const f of features) {
    if (f.level == null) {
      const m = f.description.match(/\b(?:at|starting at|beginning at|when you reach|by)\s+(\d+)(?:st|nd|rd|th)\s+level/i);
      f.level = m ? Number(m[1]) : lastLevel;
    }
    lastLevel = f.level;
  }
  return { features: features.filter(f => f.description || f.name), intro };
}

/* -------------------------------------------- */
/*  Classes                                     */
/* -------------------------------------------- */

const CLASS_FIELD = /^(primary ability|hit point die|hit dice|hit points at (?:1st|first) level|hit points at higher levels|saving throw proficiencies|saving throws|skill proficiencies|skills|weapon proficiencies|weapons|armor training|armor|tool proficiencies|tools|starting equipment|equipment|complex(?:ity)?)\s*:\s*(.+)$/i;

function parseClass(lines) {
  const found = [], warnings = [];
  const body = lines.filter(l => l !== SPLIT);
  const name = body.find(Boolean) ?? "Unnamed class";
  const e = { name };
  let rules = null;
  const rest = [];

  for (const l of body.slice(body.indexOf(name) + 1)) {
    const m = l?.match(CLASS_FIELD);
    if (!m) { rest.push(l); continue; }
    const key = lc(m[1]), val = m[2];
    if (key === "primary ability") { e.primaryAbility = findAbilities(val); rules = "2024"; }
    else if (key === "hit point die" || key === "hit dice") {
      e.hitDie = `d${val.match(/d(\d+)/i)?.[1] ?? 8}`; found.push(`Hit die ${e.hitDie}`);
      if (key === "hit point die") rules = "2024"; else rules ??= "2014";
    } else if (key.startsWith("saving throw")) { e.savingThrows = findAbilities(val); found.push(`Saves ${e.savingThrows.join("/")}`); }
    else if (key.startsWith("skill")) {
      const c = val.match(/choose\s+(any\s+)?(\w+)/i);
      e.skills = { count: c ? num(c[2]) || 2 : 2 };
      if (!c?.[1]) e.skills.from = findSkills(val);
      found.push(`Skills choose ${e.skills.count}`);
    } else if (key.startsWith("weapon")) {
      e.weapons = ["simple", "martial"].filter(w => new RegExp(`\\b${w}\\b`, "i").test(val));
      if (!e.weapons.length && !/none/i.test(val)) warnings.push(`Weapon proficiencies not mapped: "${val}"`);
    } else if (key.startsWith("armor")) {
      e.armor = /all armor/i.test(val) ? ["light", "medium", "heavy"] : ["light", "medium", "heavy"].filter(a => new RegExp(`\\b${a}\\b`, "i").test(val));
      if (/shield/i.test(val)) e.armor.push("shields");
    } else if (key.startsWith("tool")) {
      if (!/none/i.test(val)) warnings.push(`Tool proficiencies not mapped (add by hand): "${val}"`);
    }
  }
  if (e.armor || e.weapons) found.push("Proficiencies");
  if (!e.hitDie) warnings.push("Hit die not found (defaulting to d8)");
  if (!e.savingThrows) warnings.push("Saving throws not found");

  const { features, intro } = parseFeatures(rest, 1);
  e.description = intro.join("\n\n");

  const asi = features.filter(f => /^ability score improvement$/i.test(f.name));
  if (asi.length) {
    const lv = asi.flatMap(f => [f.level, ...[...f.description.matchAll(/(\d+)(?:st|nd|rd|th)\b/g)].map(m => Number(m[1]))]);
    e.asiLevels = unique(lv.filter(l => l >= 1 && l <= 20)).sort((a, b) => a - b);
  }
  const sub = features.find(f => /subclass/i.test(f.name) || new RegExp(`choose (?:a|an|one) [^.]*?\\b(${SUBCLASS_WORDS})\\b`, "i").test(f.description));
  if (sub) { e.subclassLevel = sub.level; e.subclassTitle = sub.name.replace(/^.*subclass$/i, "Subclass"); found.push(`Subclass at ${sub.level}`); }

  const sc = features.find(f => /^(spellcasting|pact magic)$/i.test(f.name));
  if (sc) {
    const ab = sc.description.match(new RegExp(`(${ABILITY_NAMES.join("|")}) is your spellcasting ability`, "i"));
    const n = lc(name);
    let progression = /pact/i.test(sc.name) ? "pact"
      : FULL_CASTERS.includes(n) ? "full"
      : n === "artificer" ? "artificer"
      : HALF_CASTERS.includes(n) || sc.level === 2 ? "half"
      : "full";
    if (!FULL_CASTERS.includes(n) && !HALF_CASTERS.includes(n) && progression !== "pact") warnings.push(`Spellcasting progression guessed as "${progression}" — check it`);
    e.spellcasting = { progression, ability: ab ? lc(ab[1]).slice(0, 3) : "int" };
    if (!ab) warnings.push("Spellcasting ability not found");
    found.push(`Spellcasting (${progression})`);
  }

  e.features = features.filter(f => !asi.includes(f));
  found.push(`${e.features.length} features`);
  return { kind: "class", data: e, rules, found, warnings };
}

/* -------------------------------------------- */
/*  Subclasses                                  */
/* -------------------------------------------- */

function parseSubclass(lines, { className } = {}) {
  const found = [], warnings = [];
  const body = lines.filter(l => l !== SPLIT);
  const name = body.find(Boolean) ?? "Unnamed subclass";
  const e = { name };
  let rules = null;
  const rest = [];
  for (const l of body.slice(body.indexOf(name) + 1)) {
    const m = l?.match(/^(?:an?\s+)?([A-Z][\w']+)\s+subclass\b/i) ?? l?.match(/^subclass\s*:\s*(\w+)/i);
    if (m && !e.class && l.length < 60) { e.class = m[1]; rules = "2024"; continue; }
    rest.push(l);
  }
  if (!e.class && className) e.class = className;
  if (e.class) found.push(`Class ${e.class}`); else warnings.push("Parent class not found: fill in the class box or the parsed data");

  const { features, intro } = parseFeatures(rest, 3);
  if (features.some(f => /^level\s+\d+/i.test(f.name))) rules = "2024";
  e.description = intro.join("\n\n");
  e.features = features;
  const sc = features.find(f => /^spellcasting$/i.test(f.name));
  if (sc) {
    const ab = sc.description.match(new RegExp(`(${ABILITY_NAMES.join("|")}) is your spellcasting ability`, "i"));
    e.spellcasting = { progression: "third", ability: ab ? lc(ab[1]).slice(0, 3) : "int" };
    found.push("Spellcasting (third)");
  }
  found.push(`${features.length} features`);
  if (!features.length) warnings.push("No features found");
  return { kind: "subclass", data: e, rules, found, warnings };
}

/* -------------------------------------------- */
/*  Feats                                       */
/* -------------------------------------------- */

function parseFeat(lines) {
  const found = [], warnings = [];
  const body = lines.filter(l => l && l !== SPLIT);
  const e = { name: body[0] ?? "Unnamed feat" };
  let rules = null;
  const desc = [];
  for (const l of body.slice(1)) {
    const cat = l.match(/^(origin|general|fighting style|epic boon)\s+feat(?:\s*\((?:prerequisite:?\s*)?([^)]*)\))?\s*$/i);
    const pre = l.match(/^prerequisites?\s*:\s*(.+)$/i);
    if (cat && !e.category) { e.category = lc(cat[1]); if (cat[2]) e.prerequisite = cat[2].trim(); rules = "2024"; found.push(`${cap(e.category)} feat`); }
    else if (pre && !e.prerequisite) { e.prerequisite = pre[1].trim(); rules ??= "2014"; found.push("Prerequisite"); }
    else desc.push(l);
  }
  e.description = desc.join("\n\n");
  if (!e.description) warnings.push("No description text");
  return { kind: "feat", data: e, rules, found, warnings };
}


/* -------------------------------------------- */
/*  Backgrounds                                 */
/* -------------------------------------------- */

/** Tool names as printed → dnd5e trait keys ("tool:art:calligrapher", "tool:thief"). */
const TOOL_KEYS = [
  ["alchemist", "art:alchemist"], ["brewer", "art:brewer"], ["calligrapher", "art:calligrapher"], ["carpenter", "art:carpenter"],
  ["cartographer", "art:cartographer"], ["cobbler", "art:cobbler"], ["cook", "art:cook"], ["glassblower", "art:glassblower"],
  ["jeweler", "art:jeweler"], ["leatherworker", "art:leatherworker"], ["mason", "art:mason"], ["painter", "art:painter"],
  ["potter", "art:potter"], ["smith", "art:smith"], ["tinker", "art:tinker"], ["weaver", "art:weaver"], ["woodcarver", "art:woodcarver"],
  ["dice", "game:dice"], ["dragonchess", "game:chess"], ["playing card", "game:card"],
  ["bagpipes", "music:bagpipes"], ["drum", "music:drum"], ["dulcimer", "music:dulcimer"], ["pan flute", "music:panflute"],
  ["flute", "music:flute"], ["horn", "music:horn"], ["lute", "music:lute"], ["lyre", "music:lyre"], ["shawm", "music:shawm"], ["viol", "music:viol"],
  ["disguise", "disg"], ["forgery", "forg"], ["herbalism", "herb"], ["navigator", "navg"], ["poisoner", "pois"], ["thieves", "thief"]
];

/** "Calligrapher's Supplies", "one type of Gaming Set", "a musical instrument of your choice" → { grants, choices, unmapped } */
export function parseTools(text) {
  const grants = [], choices = [], unmapped = [];
  for (let part of String(text ?? "").split(/,|;|\band\b/)) {
    part = part.trim();
    if (!part || /^none\b/i.test(part)) continue;
    const t = lc(part);
    const choice = t.match(/\b(one|two|any|a)\b.*?\b(gaming set|artisan'?s tools?|musical instrument|instrument|kind|type)\b/) || /of your choice/.test(t);
    if (choice) {
      const count = num(t.match(/\b(one|two|three)\b/)?.[1] ?? "1") || 1;
      const pool = /gaming/.test(t) ? "tool:game:*" : /artisan/.test(t) ? "tool:art:*" : /instrument/.test(t) ? "tool:music:*" : "tool:*";
      choices.push({ count, pool: [pool] });
      continue;
    }
    const hit = TOOL_KEYS.find(([n]) => t.includes(n));
    if (hit) grants.push(`tool:${hit[1]}`); else unmapped.push(part);
  }
  return { grants: unique(grants), choices, unmapped };
}

const BG_FIELD = /^(ability scores|feat|skill proficiencies|skills|tool proficienc(?:y|ies)|tools|languages?|equipment|starting equipment|feature)\s*:\s*(.*)$/i;

function parseBackground(lines) {
  const found = [], warnings = [];
  const body = lines.filter(l => l !== SPLIT);
  const name = body.find(Boolean) ?? "Unnamed background";
  const e = { name, features: [] };
  let rules = null;
  const lore = [];
  let feature = null;

  for (const l of body.slice(body.indexOf(name) + 1)) {
    if (!l) continue;
    const m = l.match(BG_FIELD);
    if (!m) {
      if (feature) feature.description += (feature.description ? "\n\n" : "") + l;
      else lore.push(l);
      continue;
    }
    const key = lc(m[1]), val = m[2].trim();
    if (key === "ability scores") {
      e.abilities = findAbilities(val); rules = "2024";
      found.push(`Ability scores ${e.abilities.join("/")}`);
    } else if (key === "feat") {
      e.feat = val.replace(/\s*\((?:see|from)\b[^)]*\)\s*$/i, "").trim(); rules = "2024";
      found.push(`Feat ${e.feat}`);
    } else if (key.startsWith("skill")) {
      e.skills = findSkills(val);
      const c = val.match(/\b(one|two|three)\b[^,.]*?(?:of your choice|skills?)/i);
      if (c && !e.skills.length) e.skillChoices = num(c[1]);
      found.push(`Skills ${e.skills.join(", ") || `choose ${e.skillChoices}`}`);
    } else if (key.startsWith("tool")) {
      const t = parseTools(val);
      e.tools = t.grants; e.toolChoices = t.choices;
      if (t.unmapped.length) warnings.push(`Tool proficiency not recognised (add by hand): ${t.unmapped.join(", ")}`);
      if (t.grants.length || t.choices.length) found.push("Tools");
    } else if (key.startsWith("language")) {
      const labels = languageLabels();
      e.languages = Object.keys(labels).filter(x => new RegExp(`\\b${x}\\b`, "i").test(val)).map(x => labels[x]);
      const c = val.match(/\b(one|two|three)\b/i);
      if (c && /choice|other|extra|additional/i.test(val)) e.languageChoices = num(c[1]);
      rules ??= "2014";
      found.push("Languages");
    } else if (key.includes("equipment")) {
      e.equipment = val;
      const gp = val.match(/\(B\)\s*(\d+)\s*GP/i) ?? val.match(/\bor\s+(\d+)\s*GP\s*$/i);
      if (gp) e.wealth = gp[1];
      found.push(e.wealth ? `Equipment or ${e.wealth} GP` : "Equipment");
    } else if (key === "feature") {
      feature = { name: val.replace(/[.:]$/, ""), description: "" };
      e.features.push(feature); rules ??= "2014";
      found.push(`Feature ${feature.name}`);
    }
  }
  e.description = [...lore, ...(e.equipment ? [`**Equipment:** ${e.equipment}`] : [])].join("\n\n");
  if (!e.skills?.length && !e.skillChoices) warnings.push("No skill proficiencies found");
  if (e.equipment) warnings.push("Starting equipment is kept as text: set up the equipment choices on the sheet if you want them offered");
  return { kind: "background", data: e, rules, found, warnings };
}

/* -------------------------------------------- */
/*  Detection and entry point                   */
/* -------------------------------------------- */

export function detectType(lines) {
  const body = lines.filter(l => l && l !== SPLIT);
  const top = body.slice(0, 6).join("\n");
  const all = body.join("\n");
  if (body.some(l => matchSpellHead(l))) return "spell";
  if (/^(origin|general|fighting style|epic boon)\s+feat\b/im.test(top)) return "feat";
  if (/^(hit point die|hit dice|saving throw proficiencies|saving throws)\s*:/im.test(all)) return "class";
  if (/\bsubclass\b/i.test(top)) return "subclass";
  if (/^ability scores\s*:/im.test(all) && /^(feat|skill proficiencies)\s*:/im.test(all)) return "background";
  if (/^skill proficiencies\s*:/im.test(all) && /^(feature|equipment|languages|tool proficienc(?:y|ies))\s*:/im.test(all)) return "background";
  if (/^(creature type|ability score increase|size|speed)\s*[.:]/im.test(all)) return "species";
  if (/^prerequisites?\s*:/im.test(top)) return "feat";
  if (/^level\s+\d+\s*:/im.test(all)) return "subclass";
  return null;
}

/** Split a block that holds several spells into one block per spell. */
function splitSpells(lines) {
  const heads = lines.map((l, i) => (matchSpellHead(l) ? i : -1)).filter(i => i >= 0);
  if (heads.length < 2) return [lines];
  const starts = heads.map(h => { let i = h - 1; while (i > 0 && !lines[i]) i--; return Math.max(0, i); });
  return starts.map((s, i) => lines.slice(s, starts[i + 1] ?? lines.length));
}

const PARSERS = { spell: parseSpell, species: parseSpecies, class: parseClass, subclass: parseSubclass, feat: parseFeat, background: parseBackground };

/**
 * Parse pasted text.
 * @param {string} raw
 * @param {object} [opts]
 * @param {"auto"|"spell"|"species"|"class"|"subclass"|"feat"|"background"} [opts.type="auto"]
 * @param {"auto"|"2014"|"2024"} [opts.rules="auto"]
 * @param {string} [opts.className]   Parent class for subclasses whose text doesn't name one.
 * @returns {{kind:string,data:object,rules:string,found:string[],warnings:string[]}[]}
 */
export function parseText(raw, { type = "auto", rules = "auto", className = "" } = {}) {
  const lines = cleanText(raw);
  const blocks = [];
  let cur = [];
  for (const l of lines) {
    if (l === SPLIT) { if (cur.some(Boolean)) blocks.push(cur); cur = []; } else cur.push(l);
  }
  if (cur.some(Boolean)) blocks.push(cur);

  const results = [];
  for (const block of blocks) {
    const kind = type === "auto" ? detectType(block) : type;
    if (!kind) {
      results.push({ kind: null, data: { name: block.find(Boolean) }, rules: null, found: [], warnings: ["Couldn't tell what this is. Pick a content type, or separate entries with a line of ---"] });
      continue;
    }
    const parts = kind === "spell" ? splitSpells(block) : [block];
    for (const part of parts) {
      if (kind === "spell" && !part.some(l => matchSpellHead(l))) {
        results.push({ kind: null, data: { name: part.find(Boolean) }, rules: null, found: [], warnings: ["No spell level/school line found (e.g. \"3rd-level evocation\" or \"Level 3 Evocation\")"] });
        continue;
      }
      try {
        const r = PARSERS[kind](part, { className });
        r.rules = rules !== "auto" ? rules : (r.rules ?? "2024");
        r.data.rules = r.rules;
        results.push(r);
      } catch (err) {
        results.push({ kind: null, data: { name: part.find(Boolean) }, rules: null, found: [], warnings: [`Parse error: ${err.message}`] });
      }
    }
  }
  return results;
}

/** Turn parse results into the importer's payload shape. */
export function toPayload(results, source = {}) {
  const key = { spell: "spells", species: "species", class: "classes", subclass: "subclasses", feat: "feats", background: "backgrounds" };
  const payload = { source };
  for (const r of results) {
    if (!r.kind) continue;
    (payload[key[r.kind]] ??= []).push(r.data);
  }
  return payload;
}
