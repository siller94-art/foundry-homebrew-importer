/**
 * Homebrew Importer (D&D 5e)
 * Imports spells, species/races, classes, subclasses and feats from a simple JSON format.
 * Target: Foundry VTT v12–v13, dnd5e system 4.x+.
 */

const MODULE_ID = "homebrew-importer";

const DEFAULT_IMG = {
  spell: "icons/svg/aura.svg",
  race: "icons/svg/mystery-man.svg",
  class: "icons/svg/sword.svg",
  subclass: "icons/svg/sword.svg",
  feat: "icons/svg/book.svg",
  background: "icons/sundries/documents/document-sealed-signatures-red.webp"
};

const SCHOOLS = {
  abjuration: "abj", conjuration: "con", divination: "div", enchantment: "enc",
  evocation: "evo", illusion: "ill", necromancy: "nec", transmutation: "trs"
};
const SKILLS = {
  acrobatics: "acr", "animal handling": "ani", arcana: "arc", athletics: "ath", deception: "dec",
  history: "his", insight: "ins", intimidation: "itm", investigation: "inv", medicine: "med",
  nature: "nat", perception: "prc", performance: "prf", persuasion: "per", religion: "rel",
  "sleight of hand": "slt", stealth: "ste", survival: "sur"
};
const ABILITIES = {
  strength: "str", dexterity: "dex", constitution: "con",
  intelligence: "int", wisdom: "wis", charisma: "cha"
};
const SIZES = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };
const ARMOR = { light: "armor:lgt", medium: "armor:med", heavy: "armor:hvy", shield: "armor:shl", shields: "armor:shl" };
const WEAPONS = { simple: "weapon:sim", martial: "weapon:mar" };
const FEAT_CATEGORIES = { origin: "origin", general: "general", "fighting style": "fightingStyle", fightingstyle: "fightingStyle", "epic boon": "epicBoon", epicboon: "epicBoon" };

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

const lc = s => String(s ?? "").trim().toLowerCase();
const rid = () => foundry.utils.randomID();
const slugify = s => String(s ?? "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const escapeHTML = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ability = a => ABILITIES[lc(a)] ?? lc(a).slice(0, 3);
const skill = s => (lc(s).startsWith("skills:") ? lc(s) : `skills:${SKILLS[lc(s)] ?? lc(s)}`);
const arr = v => (v == null ? [] : [].concat(v));

/** Plain text (paragraphs separated by blank lines, **bold**, *italic*) or raw HTML → HTML. */
function toHTML(text) {
  if (!text) return "";
  if (Array.isArray(text)) text = text.join("\n\n");
  text = String(text);
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text.split(/\n\s*\n/).map(p => {
    const inner = escapeHTML(p.trim())
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
    return `<p>${inner}</p>`;
  }).join("");
}

/** "8d6+3" → { number: 8, denomination: 6, bonus: "3" } */
function parseDice(str) {
  const m = String(str ?? "").replace(/\s+/g, "").match(/^(\d+)?d(\d+)([+-].+)?$/i);
  if (!m) return null;
  return { number: m[1] ? Number(m[1]) : null, denomination: Number(m[2]), bonus: m[3] ? m[3].replace(/^\+/, "") : "" };
}

/** "8d6 fire" or { dice: "8d6", type: "fire", scaling: "1d6" } → dnd5e DamageData */
function damagePart(d) {
  if (typeof d === "string") {
    const m = d.trim().match(/^(\S+)\s*(.*)$/);
    d = { dice: m[1], type: m[2] };
  }
  const formula = d.dice ?? d.formula ?? "";
  const part = {
    number: null, denomination: null, bonus: "",
    types: arr(d.type ?? d.types).map(lc).filter(Boolean),
    custom: { enabled: false, formula: "" },
    scaling: { mode: "", number: null, formula: "" }
  };
  const p = parseDice(formula);
  if (p) Object.assign(part, p, { number: p.number ?? 1 });
  else part.custom = { enabled: true, formula: String(formula) };
  if (d.scaling) {
    const s = parseDice(d.scaling);
    part.scaling = s ? { mode: "whole", number: s.number ?? 1, formula: "" } : { mode: "whole", number: null, formula: String(d.scaling) };
  }
  return part;
}

function parseActivation(v) {
  if (v && typeof v === "object") return v;
  const s = lc(v || "1 action");
  const m = s.match(/(\d+)?\s*(bonus action|action|reaction|minute|hour|day|special)/);
  if (!m) return { type: "special", value: null, condition: String(v) };
  const map = { "bonus action": "bonus", action: "action", reaction: "reaction", minute: "minute", hour: "hour", day: "day", special: "special" };
  const condition = s.includes(",") ? String(v).split(",").slice(1).join(",").trim() : "";
  return { type: map[m[2]], value: Number(m[1] ?? 1), condition };
}

/** "20-foot-radius sphere", "15-foot cone", "30-foot emanation" → template data */
function parseTemplate(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  const m = lc(v).match(/(\d+)[\s-]*(?:foot|feet|ft)\.?[\s-]*(?:radius[\s-]*)?(cone|cube|sphere|line|cylinder|radius|emanation|square|wall)?/);
  if (!m) return null;
  const type = { emanation: "radius" }[m[2]] ?? m[2] ?? "radius";
  return { count: "", contiguous: false, type, size: m[1], width: type === "line" ? "5" : "", height: "", units: "ft" };
}

function parseRange(v) {
  if (v && typeof v === "object") return { range: v, template: null };
  const s = lc(v);
  if (s.startsWith("self")) return { range: { units: "self", value: null, special: "" }, template: parseTemplate(s) };
  if (s.startsWith("touch")) return { range: { units: "touch", value: null, special: "" }, template: null };
  if (s.startsWith("sight")) return { range: { units: "spec", value: null, special: "Sight" }, template: null };
  if (s.startsWith("unlimited")) return { range: { units: "any", value: null, special: "" }, template: null };
  const m = s.match(/(\d+)\s*(feet|foot|ft|miles?|mi)/);
  if (m) return { range: { value: Number(m[1]), units: m[2].startsWith("m") ? "mi" : "ft", special: "" }, template: null };
  return { range: { units: "spec", value: null, special: String(v ?? "") }, template: null };
}

function parseDuration(v) {
  if (v && typeof v === "object") return { duration: v, concentration: false };
  const s = lc(v || "instantaneous");
  const concentration = s.includes("concentration");
  if (s.includes("instant")) return { duration: { units: "inst", value: "" }, concentration };
  if (s.includes("until dispelled") || s.includes("permanent")) return { duration: { units: "perm", value: "" }, concentration };
  const m = s.match(/(\d+)\s*(round|minute|hour|day|month|year)/);
  if (m) return { duration: { value: m[1], units: m[2] }, concentration };
  return { duration: { units: "spec", value: "" }, concentration };
}

/** "V, S, M (a pinch of sulfur)" or { verbal, somatic, material } */
function parseComponents(c) {
  const props = [];
  let material = "";
  if (typeof c === "string") {
    if (/\bV\b/.test(c)) props.push("vocal");
    if (/\bS\b/.test(c)) props.push("somatic");
    if (/\bM\b/.test(c)) { props.push("material"); material = (c.match(/\((.*)\)/) ?? [])[1] ?? ""; }
  } else if (c) {
    if (c.verbal || c.v) props.push("vocal");
    if (c.somatic || c.s) props.push("somatic");
    const m = c.material ?? c.m;
    if (m) { props.push("material"); material = typeof m === "string" ? m : ""; }
  } else {
    props.push("vocal", "somatic");
  }
  const cost = Number((material.match(/(\d[\d,]*)\s*\+?\s*gp/i) ?? [])[1]?.replace(/,/g, "") ?? 0);
  const consumed = /consume/i.test(material);
  return { props, materials: { value: material, consumed, cost, supply: 0 } };
}

function languageKey(l) {
  const s = lc(l);
  if (s.startsWith("languages:")) return s;
  if (s.includes(":")) return `languages:${s}`;
  for (const [group, data] of Object.entries(CONFIG.DND5E.languages ?? {})) {
    if (group === s) return `languages:${s}`;
    if (data?.children && s in data.children) return `languages:${group}:${s}`;
  }
  return `languages:standard:${s}`;
}

function profKey(p) {
  const s = lc(p);
  if (s.includes(":")) return s;
  return ARMOR[s] ?? WEAPONS[s] ?? `tool:${s}`;
}

function common(e, ctx) {
  const rules = String(e.rules ?? ctx.source.rules ?? "2024");
  return {
    description: { value: toHTML(e.description), chat: "" },
    source: {
      book: e.book ?? ctx.source.book ?? "Homebrew",
      page: String(e.page ?? ""),
      custom: "",
      license: ctx.source.license ?? "",
      rules
    }
  };
}

function uses(u) {
  if (!u) return undefined;
  return {
    max: String(u.max ?? ""),
    spent: 0,
    recovery: u.recovery ? [{ period: u.recovery, type: "recoverAll" }] : []
  };
}

const trait = (level, grants, choices = [], title = "", extra = {}) => ({
  _id: rid(), type: "Trait", level, title,
  configuration: { mode: "default", allowReplacements: false, grants, choices },
  ...extra
});

/* -------------------------------------------- */
/*  Builders                                    */
/* -------------------------------------------- */

function raw(e, fallbackType) {
  const type = e.type ?? fallbackType;
  if (!type) throw new Error("Raw entries need a \"type\".");
  return {
    name: e.name, type, img: e.img ?? DEFAULT_IMG[type] ?? "icons/svg/item-bag.svg",
    system: foundry.utils.deepClone(e.system ?? {}),
    effects: e.effects ?? [],
    flags: e.flags ?? {}
  };
}

function buildSpellActivities(e) {
  const acts = {};
  const add = a => { a._id = rid(); acts[a._id] = a; };
  const parts = arr(e.damage).map(damagePart);

  if (e.attack) {
    add({
      type: "attack",
      attack: { type: { value: lc(e.attack).startsWith("melee") ? "melee" : "ranged", classification: "spell" } },
      damage: { includeBase: false, parts }
    });
  } else if (e.save) {
    const s = typeof e.save === "string" ? { ability: e.save } : e.save;
    add({
      type: "save",
      save: { ability: arr(s.ability).map(ability), dc: { calculation: "spellcasting", formula: "" } },
      damage: { onSave: s.onSave ?? (parts.length ? "half" : "none"), parts }
    });
  } else if (parts.length) {
    add({ type: "damage", damage: { parts } });
  }

  if (e.healing) {
    const h = typeof e.healing === "string" ? { dice: e.healing } : e.healing;
    add({ type: "heal", healing: damagePart({ ...h, type: "healing" }) });
  }

  if (!Object.keys(acts).length) add({ type: "utility" });
  return acts;
}

function buildSpell(e, ctx) {
  const comps = parseComponents(e.components);
  const dur = parseDuration(e.duration);
  const rng = parseRange(e.range);
  const properties = [...comps.props];
  if (e.concentration || dur.concentration) properties.push("concentration");
  if (e.ritual) properties.push("ritual");

  const sys = common(e, ctx);
  if (e.higherLevels) {
    const label = sys.source.rules === "2014" ? "At Higher Levels." : (Number(e.level) === 0 ? "Cantrip Upgrade." : "Using a Higher-Level Spell Slot.");
    sys.description.value += `<p><strong><em>${label}</em></strong> ${escapeHTML(e.higherLevels)}</p>`;
  }

  return {
    name: e.name, type: "spell", img: e.img ?? DEFAULT_IMG.spell,
    system: {
      ...sys,
      identifier: slugify(e.identifier ?? e.name),
      level: Number(e.level ?? 0),
      method: "spell",
      prepared: 0,
      school: SCHOOLS[lc(e.school)] ?? lc(e.school).slice(0, 3),
      properties,
      materials: comps.materials,
      activation: parseActivation(e.castingTime ?? e.casting_time),
      range: rng.range,
      duration: dur.duration,
      target: {
        template: parseTemplate(e.area) ?? rng.template ?? { type: "" },
        affects: e.targets ? { count: String(e.targets.count ?? ""), type: e.targets.type ?? "creature", choice: false, special: "" } : {}
      },
      activities: buildSpellActivities(e)
    },
    flags: { [MODULE_ID]: { classes: arr(e.classes) } }
  };
}

function buildFeature(f, ctx, kind, requirements) {
  if (f.system) return raw(f, "feat");
  return {
    name: f.name, type: "feat", img: f.img ?? DEFAULT_IMG.feat,
    system: {
      ...common(f, ctx),
      identifier: slugify(f.identifier ?? f.name),
      type: { value: kind, subtype: f.subtype ?? "" },
      requirements: requirements ?? f.requirements ?? f.prerequisite ?? "",
      ...(f.uses ? { uses: uses(f.uses) } : {}),
      ...(f.activation ? { activation: parseActivation(f.activation) } : {})
    }
  };
}

/** Create/update feature items and return ItemGrant advancements grouped by level. */
async function grantFeatures(list, ctx, kind, reqFn, defaultLevel, parent, folder = "Features") {
  const byLevel = new Map();
  for (const f of arr(list)) {
    const level = Number(f.level ?? defaultLevel);
    const fe = { rules: parent.rules, book: parent.book, ...f };
    const data = buildFeature(fe, ctx, kind, reqFn?.(level));
    const owner = `${slugify(parent.name)}:${data.system?.source?.rules ?? ""}`;
    const doc = await upsert(data, ctx, folder, owner);
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push({ uuid: doc.uuid, optional: !!f.optional });
  }
  return [...byLevel].sort((a, b) => a[0] - b[0]).map(([level, items]) => ({
    _id: rid(), type: "ItemGrant", level, title: "Features", configuration: { items }
  }));
}

function scaleValue(s) {
  const values = s.values ?? {};
  const type = s.type ?? (Object.values(values).some(v => /d\d/i.test(String(v))) ? "dice" : "number");
  const scale = {};
  for (const [lvl, v] of Object.entries(values)) {
    if (type === "dice") {
      const d = parseDice(String(v));
      scale[lvl] = { number: d?.number ?? null, faces: d?.denomination ?? 6 };
    } else if (type === "number" || type === "distance") scale[lvl] = { value: Number(v) };
    else scale[lvl] = { value: String(v) };
  }
  const title = s.title ?? s.name;
  return {
    _id: rid(), type: "ScaleValue", title,
    configuration: { identifier: s.identifier ?? slugify(title), type, distance: { units: s.units ?? "" }, scale }
  };
}

async function buildRace(e, ctx) {
  const L = 0; // species/race advancements apply at character level 0
  const adv = [];

  adv.push({ _id: rid(), type: "Size", level: L, configuration: { sizes: arr(e.size ?? "medium").map(s => SIZES[lc(s)] ?? lc(s)) } });

  if (e.abilityScores) { // 2014-style fixed racial ASIs
    const { points = 0, ...fixed } = e.abilityScores;
    const mapped = Object.fromEntries(Object.entries(fixed).map(([k, v]) => [ability(k), Number(v)]));
    adv.push({ _id: rid(), type: "AbilityScoreImprovement", level: L, configuration: { points, fixed: mapped, cap: 2 } });
  }

  const langGrants = arr(e.languages).map(languageKey);
  const langChoices = e.languageChoices ? [{ count: Number(e.languageChoices), pool: ["languages:*"] }] : [];
  if (langGrants.length || langChoices.length) adv.push(trait(L, langGrants, langChoices, "Languages"));

  const dmg = [...arr(e.resistances).map(r => `dr:${lc(r)}`), ...arr(e.immunities).map(r => `di:${lc(r)}`), ...arr(e.conditionImmunities).map(r => `ci:${lc(r)}`)];
  if (dmg.length) adv.push(trait(L, dmg, [], "Resistances"));

  const skills = arr(e.skills).map(skill);
  const skillChoices = e.skillChoices ? [{ count: Number(e.skillChoices.count ?? e.skillChoices), pool: e.skillChoices.from ? arr(e.skillChoices.from).map(skill) : ["skills:*"] }] : [];
  if (skills.length || skillChoices.length) adv.push(trait(L, skills, skillChoices, "Skills"));

  adv.push(...await grantFeatures(e.features, ctx, "race", null, L, e));

  const speed = typeof e.speed === "object" ? e.speed : { walk: e.speed ?? 30 };
  const senses = e.senses ?? {};
  return {
    name: e.name, type: "race", img: e.img ?? DEFAULT_IMG.race,
    system: {
      ...common(e, ctx),
      identifier: slugify(e.identifier ?? e.name),
      movement: buildMovement(speed),
      senses: {
        ranges: Object.fromEntries(["darkvision", "blindsight", "tremorsense", "truesight"]
          .map(k => [k, senses[k] ?? (k === "darkvision" ? e.darkvision : null) ?? null])),
        units: "ft", special: senses.special ?? ""
      },
      type: { value: lc(e.creatureType ?? "humanoid"), subtype: e.subtype ?? "", custom: "" },
      advancement: adv
    }
  };
}

/** dnd5e 6.x stores speeds under movement.speeds (as formulas); 5.x keeps them flat. */
function buildMovement(speed) {
  const types = ["walk", "fly", "swim", "climb", "burrow"];
  if (foundry.utils.isNewerVersion(game.system.version, "5.99.99")) {
    const speeds = Object.fromEntries(types.map(t => [t, speed[t] != null ? String(speed[t]) : ""]));
    return { speeds, hover: !!speed.hover, units: "ft" };
  }
  return { ...Object.fromEntries(types.map(t => [t, speed[t] ?? null])), hover: !!speed.hover, units: "ft" };
}

async function buildClass(e, ctx) {
  const hd = "d" + String(e.hitDie ?? "d8").replace(/^d/i, "");
  const adv = [{ _id: rid(), type: "HitPoints", configuration: {}, value: {} }];

  const saves = arr(e.savingThrows).map(a => `saves:${ability(a)}`);
  if (saves.length) adv.push(trait(1, saves, [], "Saving Throws", { classRestriction: "primary" }));

  const profs = [...arr(e.armor), ...arr(e.weapons), ...arr(e.tools)].map(profKey);
  if (profs.length) adv.push(trait(1, profs, [], "Proficiencies", { classRestriction: "primary" }));

  if (e.multiclass) {
    const mc = [...arr(e.multiclass.armor), ...arr(e.multiclass.weapons), ...arr(e.multiclass.tools)].map(profKey);
    if (mc.length) adv.push(trait(1, mc, [], "Multiclass Proficiencies", { classRestriction: "secondary" }));
  }

  if (e.skills) {
    adv.push(trait(1, [], [{ count: Number(e.skills.count ?? 2), pool: e.skills.from ? arr(e.skills.from).map(skill) : ["skills:*"] }], "Skills", { classRestriction: "primary" }));
  }

  adv.push({ _id: rid(), type: "Subclass", level: Number(e.subclassLevel ?? 3), title: e.subclassTitle ?? "Subclass", configuration: {} });

  for (const lvl of arr(e.asiLevels ?? [4, 8, 12, 16, 19])) {
    adv.push({ _id: rid(), type: "AbilityScoreImprovement", level: Number(lvl), configuration: { points: 2, fixed: {}, cap: 2 } });
  }

  adv.push(...arr(e.scaleValues).map(scaleValue));
  adv.push(...await grantFeatures(e.features, ctx, "class", lvl => `${e.name} ${lvl}`, 1, e));

  const sc = e.spellcasting;
  return {
    name: e.name, type: "class", img: e.img ?? DEFAULT_IMG.class,
    system: {
      ...common(e, ctx),
      identifier: slugify(e.identifier ?? e.name),
      levels: 1,
      hd: { denomination: hd, spent: 0, additional: "" },
      primaryAbility: { value: arr(e.primaryAbility).map(ability), all: e.primaryAbilityAll ?? true },
      spellcasting: { progression: sc ? lc(sc.progression ?? "full") : "none", ability: sc ? ability(sc.ability) : "" },
      advancement: adv
    }
  };
}

async function buildSubclass(e, ctx) {
  const className = e.class ?? "";
  const adv = await grantFeatures(e.features, ctx, "class", lvl => `${e.name} ${lvl}`, e.level ?? 3, e);
  adv.push(...arr(e.scaleValues).map(scaleValue));
  const sc = e.spellcasting;
  return {
    name: e.name, type: "subclass", img: e.img ?? DEFAULT_IMG.subclass,
    system: {
      ...common(e, ctx),
      identifier: slugify(e.identifier ?? e.name),
      classIdentifier: slugify(e.classIdentifier ?? className),
      ...(sc ? { spellcasting: { progression: lc(sc.progression ?? "third"), ability: ability(sc.ability) } } : {}),
      advancement: adv
    }
  };
}

/** Find a feat by name: one imported in this run, a world item, then any Item compendium (2024 packs first for 2024). */
async function findFeat(name, rules, ctx) {
  const full = lc(name), base = lc(name.replace(/\s*\([^)]*\)\s*$/, ""));
  const match = n => [full, base].includes(lc(n));
  for (const doc of ctx.existing.values()) if (doc.type === "feat" && match(doc.name)) return doc.uuid;
  const world = game.items.find(i => i.type === "feat" && match(i.name));
  if (world) return world.uuid;
  const packs = game.packs.filter(p => p.documentName === "Item")
    .sort((a, b) => Number(/24\b|2024/.test(b.collection) === (rules === "2024")) - Number(/24\b|2024/.test(a.collection) === (rules === "2024")));
  for (const pack of packs) {
    const index = await pack.getIndex({ fields: ["type"] });
    const hit = index.find(i => i.type === "feat" && match(i.name));
    if (hit) return hit.uuid ?? `Compendium.${pack.collection}.Item.${hit._id}`;
  }
  return null;
}

async function buildBackground(e, ctx) {
  const L = 0;
  const adv = [];
  const sys = common(e, ctx);

  if (e.abilities?.length) {
    const all = ["str", "dex", "con", "int", "wis", "cha"];
    adv.push({
      _id: rid(), type: "AbilityScoreImprovement", level: L, title: "Background Ability Score Improvement",
      configuration: { points: 3, cap: 2, fixed: Object.fromEntries(all.map(a => [a, 0])), locked: all.filter(a => !e.abilities.includes(a)) }
    });
  }

  const grants = [...arr(e.skills).map(skill), ...arr(e.tools).map(t => (t.startsWith("tool:") ? t : `tool:${t}`))];
  const choices = [
    ...(e.skillChoices ? [{ count: Number(e.skillChoices), pool: ["skills:*"] }] : []),
    ...arr(e.toolChoices).map(c => ({ count: Number(c.count ?? 1), pool: arr(c.pool) }))
  ];
  if (grants.length || choices.length) adv.push(trait(L, grants, choices, "Background Proficiencies"));

  const langs = arr(e.languages).map(languageKey);
  const langChoices = e.languageChoices ? [{ count: Number(e.languageChoices), pool: ["languages:*"] }] : [];
  if (langs.length || langChoices.length) adv.push(trait(L, langs, langChoices, "Languages"));

  if (e.feat) {
    const uuid = await findFeat(e.feat, sys.source.rules, ctx);
    if (uuid) adv.push({ _id: rid(), type: "ItemGrant", level: L, title: "Background Feat", configuration: { items: [{ uuid, optional: false }], optional: false, spell: null } });
    else ctx.report.warnings.push(`${e.name}: feat "${e.feat}" wasn't found in your world or compendiums. Import it first, then re-import the background (or add it on the sheet).`);
  }

  adv.push(...await grantFeatures(e.features, ctx, "background", null, L, e, "Background Features"));

  return {
    name: e.name, type: "background", img: e.img ?? DEFAULT_IMG.background,
    system: {
      ...sys,
      identifier: slugify(e.identifier ?? e.name),
      advancement: adv,
      startingEquipment: [],
      wealth: e.wealth ? String(e.wealth) : ""
    }
  };
}

function buildFeat(e, ctx) {
  const data = buildFeature(e, ctx, "feat", e.prerequisite);
  if (!e.system) data.system.type.subtype = FEAT_CATEGORIES[lc(e.category)] ?? "";
  return data;
}

/* -------------------------------------------- */
/*  Persistence                                 */
/* -------------------------------------------- */

async function indexExisting(pack) {
  const docs = pack ? await pack.getDocuments() : game.items.contents;
  return new Map(docs.filter(d => d.getFlag(MODULE_ID, "key")).map(d => [d.getFlag(MODULE_ID, "key"), d]));
}

async function getFolder(ctx, name) {
  if (ctx.folderIds[name]) return ctx.folderIds[name];
  const packOpt = ctx.pack ? { pack: ctx.pack.collection } : {};
  const all = () => (ctx.pack ? ctx.pack.folders.contents : game.folders.filter(f => f.type === "Item"));
  const find = (n, parentId) => all().find(f => f.name === n && (f.folder?.id ?? null) === parentId);

  if (!ctx.rootFolderId) {
    const root = find(ctx.rootName, null) ?? await Folder.create({ name: ctx.rootName, type: "Item", color: "#1f4e79" }, packOpt);
    ctx.rootFolderId = root.id;
  }
  const sub = find(name, ctx.rootFolderId) ?? await Folder.create({ name, type: "Item", folder: ctx.rootFolderId }, packOpt);
  ctx.folderIds[name] = sub.id;
  return sub.id;
}

async function upsert(data, ctx, folderName, owner = "") {
  const key = `${data.type}:${slugify(data.name)}:${data.system?.source?.rules ?? ""}${owner ? `@${owner}` : ""}`;
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.key`, key);
  const existing = ctx.existing.get(key);
  if (existing) {
    if (!ctx.update) { ctx.report.skipped++; return existing; }
    data.folder = existing.folder?.id ?? null;
    await existing.update(data, { recursive: false, diff: false });
    ctx.report.updated++;
    return existing;
  }
  data.folder = await getFolder(ctx, folderName);
  const doc = await Item.implementation.create(data, ctx.pack ? { pack: ctx.pack.collection } : {});
  ctx.existing.set(key, doc);
  ctx.report.created++;
  return doc;
}

/* -------------------------------------------- */
/*  Public API                                  */
/* -------------------------------------------- */

const STEPS = [
  ["feats", "Feats", buildFeat, "feat"],
  ["spells", "Spells", buildSpell, "spell"],
  ["races", "Species", buildRace, "race"],
  ["species", "Species", buildRace, "race"],
  ["backgrounds", "Backgrounds", buildBackground, "background"],
  ["classes", "Classes", buildClass, "class"],
  ["subclasses", "Subclasses", buildSubclass, "subclass"],
  ["items", "Other", e => raw(e), null]
];

/**
 * Import homebrew content.
 * @param {string|object} input  JSON string or parsed object.
 * @param {object} [options]
 * @param {string} [options.target="world"]  "world" or a compendium collection id.
 * @param {boolean} [options.update=true]   Update previously imported items instead of skipping them.
 */
export async function importHomebrew(input, { target = "world", update = true } = {}) {
  if (game.system.id !== "dnd5e") throw new Error("Homebrew Importer requires the dnd5e system.");
  if (foundry.utils.isNewerVersion("5.3.0", game.system.version)) throw new Error(`Homebrew Importer needs dnd5e 5.3 or newer (you have ${game.system.version}).`);
  let data = typeof input === "string" ? JSON.parse(input) : input;
  if (Array.isArray(data)) data = { items: data };

  const pack = target === "world" ? null : game.packs.get(target);
  if (target !== "world" && !pack) throw new Error(`Compendium "${target}" not found.`);
  if (pack?.locked) throw new Error(`Compendium "${pack.title}" is locked. Unlock it first.`);
  if (pack && pack.documentName !== "Item") throw new Error(`Compendium "${pack.title}" is not an Item compendium.`);

  const source = data.source ?? {};
  const ctx = {
    pack, update, source,
    rootName: source.folder ?? `Homebrew – ${source.book ?? "Imported"}`,
    rootFolderId: null, folderIds: {},
    existing: await indexExisting(pack),
    report: { created: 0, updated: 0, skipped: 0, errors: [], warnings: [] }
  };

  for (const [key, folder, build, type] of STEPS) {
    for (const entry of arr(data[key])) {
      try {
        const docData = entry.system ? raw(entry, type) : await build(entry, ctx);
        await upsert(docData, ctx, folder);
      } catch (err) {
        console.error(`${MODULE_ID} | ${entry?.name ?? "(unnamed)"}`, err);
        ctx.report.errors.push(`${entry?.name ?? "(unnamed)"} [${key}]: ${err.message}`);
      }
    }
  }
  return ctx.report;
}

export { escapeHTML, MODULE_ID };
