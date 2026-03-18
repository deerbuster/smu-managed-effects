import { SPELL_EFFECT_DEFINITIONS } from "../definitions/spell-definitions.js";
import { createLogger } from "../utils/log.js";
import {
  deepGet,
  escapeHtml,
  getActorLevel,
  normalizeText,
  parseNumber,
  unique
} from "../utils/common.js";

const log = createLogger("spell-provider");

let spellListFilterPromise = null;
const providerCache = new Map();

function cacheKeyForActor(actor, token) {
  const itemSignature = Array.from(actor?.items ?? [])
    .map((item) => [
      item.id,
      item.type,
      item.name ?? "",
      item.system?.category ?? "",
      item.system?.specialization ?? "",
      item.system?.ranks ?? "",
      item.system?.spellListUuid ?? ""
    ].join("|"))
    .sort()
    .join("::");

  return [
    actor?.uuid ?? "no-actor",
    token?.id ?? "no-token",
    getActorLevel(actor, 1),
    actor?.system?._modifiedTime ?? "",
    itemSignature,
    SPELL_EFFECT_DEFINITIONS.length
  ].join("||");
}

export async function preloadSpellProvider() {
  if (game.system.id !== "rmu") return null;
  return loadSpellListFilter();
}

export function clearSpellProviderCache() {
  providerCache.clear();
}

export function clearSpellProviderCacheForActor(actor) {
  if (!actor?.uuid) {
    clearSpellProviderCache();
    return;
  }

  for (const key of providerCache.keys()) {
    if (key.startsWith(`${actor.uuid}||`)) providerCache.delete(key);
  }
}

async function loadSpellListFilter() {
  if (spellListFilterPromise) return spellListFilterPromise;

  spellListFilterPromise = import("/systems/rmu/module/rmu/spells/spell-list-filter.js")
    .then((mod) => {
      if (!mod?.SpellListFilter) {
        throw new Error("RMU SpellListFilter export not found.");
      }
      return mod.SpellListFilter;
    })
    .catch((err) => {
      spellListFilterPromise = null;
      throw err;
    });

  return spellListFilterPromise;
}

function buildDefinitionsIndex(definitions) {
  const byListLevel = new Map();
  const allSpellDefs = [];

  for (const def of definitions ?? []) {
    if (def?.matching?.provider !== "spell") continue;

    const listName = normalizeText(def.matching.listName);
    const level = parseNumber(def.matching.level, 0);
    const key = `${listName}|${level}`;
    const arr = byListLevel.get(key) ?? [];

    arr.push(Object.freeze(def));
    byListLevel.set(key, arr);
    allSpellDefs.push(Object.freeze(def));
  }

  return {
    byListLevel,
    all: allSpellDefs
  };
}

function matchesSpellDefinition(def, skill, spell) {
  if (def?.matching?.provider !== "spell") return false;
  if (normalizeText(def.matching.listName) !== normalizeText(skill?.specialization)) return false;
  if (parseNumber(def.matching.level, 0) !== parseNumber(spell?.level, 0)) return false;

  const defSpellName = normalizeText(def.matching.spellName);
  if (!defSpellName) return true;

  return defSpellName === normalizeText(spell?.name);
}

function findMatchingDefinitions(index, skill, spell) {
  const key = `${normalizeText(skill?.specialization)}|${parseNumber(spell?.level, 0)}`;
  const candidates = index.byListLevel.get(key) ?? [];
  const exact = candidates.filter((def) => matchesSpellDefinition(def, skill, spell));

  if (exact.length) return exact;
  return candidates.filter((def) => !normalizeText(def?.matching?.spellName));
}

function getSpellSkills(actor) {
  const items = Array.from(actor?.items ?? []);

  const skills = items
    .filter((item) => item?.type === "skill")
    .filter((item) => {
      const category = item.system?.category;
      const specialization = item.system?.specialization;
      const ranks = parseNumber(item.system?.ranks, 0);
      const spellListUuid = item.system?.spellListUuid;

      return category === "Spellcasting" && specialization && ranks > 0 && spellListUuid;
    })
    .map((item) => {
      const ranks = parseNumber(item.system?.ranks, 0);

      return Object.freeze({
        id: item.id,
        item,
        name: item.system?.name ?? item.name ?? "",
        category: item.system?.category ?? "",
        specialization: item.system?.specialization ?? "",
        specializationNorm: normalizeText(item.system?.specialization),
        ranks,
        _totalRanks: ranks,
        spellListUuid: item.system?.spellListUuid,
        otherSpells: Array.isArray(item.system?.otherSpells) ? item.system.otherSpells : []
      });
    });

  log.debug("Discovered spell skills", skills.map((s) => ({
    id: s.id,
    name: s.name,
    specialization: s.specialization,
    ranks: s.ranks,
    _totalRanks: s._totalRanks,
    spellListUuid: s.spellListUuid
  })));

  return skills;
}

function buildTemporalSkillsIndex(actor) {
  const index = new Map();

  for (const item of actor?.items ?? []) {
    if (item?.type !== "skill") continue;

    const category = normalizeText(item.system?.category);
    const specialization = String(item.system?.specialization ?? "").trim();
    const ranks = parseNumber(item.system?.ranks, 0);

    if (category !== "power awareness" || !specialization || ranks <= 0) continue;

    index.set(normalizeText(specialization), {
      specialization,
      ranks,
      tier: Math.max(0, Math.floor(ranks / 10))
    });
  }

  return index;
}

function getTemporalSkillsInfo(index, listName) {
  if (!index?.size || !listName) {
    return {
      tier: 0,
      applied: false,
      source: null
    };
  }

  const direct = index.get(normalizeText(listName));
  if (!direct) {
    return {
      tier: 0,
      applied: false,
      source: null
    };
  }

  const tier = Math.max(0, Math.floor(parseNumber(direct.ranks, 0) / 10));

  return {
    tier,
    applied: tier > 0,
    source: direct.specialization
  };
}

function deriveSpellImg(spell, fallback) {
  return spell?.img
    || spell?.icon
    || fallback
    || "icons/magic/control/buff-flight-wings-runes-blue.webp";
}

function deriveSpellDescription(spell) {
  const candidates = [
    deepGet(spell, "description"),
    deepGet(spell, "system.description"),
    deepGet(spell, "system.desc"),
    deepGet(spell, "system.details.description"),
    deepGet(spell, "text"),
    deepGet(spell, "details")
  ];

  return candidates.find((value) => typeof value === "string" && value.trim()) || "";
}

function deriveSpellAoeText(spell) {
  const candidates = [
    "aoe",
    "areaOfEffect",
    "system.aoe",
    "system.areaOfEffect",
    "system.target",
    "system.targeting",
    "target"
  ];

  for (const path of candidates) {
    const value = deepGet(spell, path);

    if (typeof value === "string" && value.trim()) return value.trim();

    if (value && typeof value === "object") {
      const raw = value.text ?? value.value ?? value.label ?? value.name;
      if (typeof raw === "string" && raw.trim()) return raw.trim();
    }
  }

  return "";
}

const SELF_TARGET_TERMS = new Set([
  "self",
  "caster",
  "self only",
  "caster only"
]);

const SINGLE_TARGET_TERMS = new Set([
  "1 target",
  "one target",
  "single target",
  "1 tgt",
  "one tgt"
]);

function normalizeTargetMode(rawMode) {
  const mode = normalizeText(rawMode);
  if (["self", "target", "targets", "area", "auto"].includes(mode)) return mode;
  return "auto";
}

function resolveTargetMode(effectDef, aoeText) {
  const explicit = normalizeTargetMode(effectDef?.targetMode);
  if (explicit !== "auto") return explicit;

  const normalizedAoe = normalizeText(aoeText);
  if (!normalizedAoe) return "auto";

  if (SELF_TARGET_TERMS.has(normalizedAoe)) return "self";
  if (SINGLE_TARGET_TERMS.has(normalizedAoe)) return "target";

  if (
    normalizedAoe.includes("targets")
    || normalizedAoe.includes("targets")
    || normalizedAoe.includes("area")
    || normalizedAoe.includes("radius")
    || normalizedAoe.includes("cone")
    || normalizedAoe.includes("sphere")
    || normalizedAoe.includes("burst")
    || normalizedAoe.includes("blast")
    || normalizedAoe.includes("up to ")
  ) {
    return "targets";
  }

  return "auto";
}

function resolveMaxTargets(effectDef, aoeText) {
  const explicit = Number(effectDef?.maxTargets);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const normalizedAoe = normalizeText(aoeText);
  if (!normalizedAoe) return null;

  const upToMatch = normalizedAoe.match(/up to (\d+)\s*(target|targets|tgt|tgts)/);
  if (upToMatch) {
    const value = Number(upToMatch[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const flatMatch = normalizedAoe.match(/^(\d+)\s*(target|targets|tgt|tgts)$/);
  if (flatMatch) {
    const value = Number(flatMatch[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return null;
}

function resolveTargetsPerLevel(effectDef, aoeText) {
  const explicit = Number(effectDef?.targetsPerLevel);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const normalizedAoe = normalizeText(aoeText);
  if (!normalizedAoe) return null;

  if (
    normalizedAoe.includes("/lvl")
    || normalizedAoe.includes("/ level")
    || normalizedAoe.includes("per lvl")
    || normalizedAoe.includes("per level")
  ) {
    const match = normalizedAoe.match(/(\d+)\s*(target|targets|tgt|tgts)/);
    const base = match ? Number(match[1]) : 1;
    if (Number.isFinite(base) && base > 0) return base;
    return 1;
  }

  return null;
}

function normalizeUnit(unit) {
  const u = normalizeText(unit);
  if (!u) return "perm";

  const aliases = new Map([
    ["rnd", "rounds"],
    ["rnds", "rounds"],
    ["round", "rounds"],
    ["rounds", "rounds"],
    ["min", "minutes"],
    ["mins", "minutes"],
    ["minute", "minutes"],
    ["minutes", "minutes"],
    ["hr", "hours"],
    ["hrs", "hours"],
    ["hour", "hours"],
    ["hours", "hours"],
    ["day", "days"],
    ["days", "days"],
    ["perm", "perm"],
    ["permanent", "perm"]
  ]);

  return aliases.get(u) ?? "perm";
}

function parseDurationText(text, actorLevel = 1) {
  if (!text || typeof text !== "string") return null;

  const raw = String(text).trim();
  const lower = raw.toLowerCase();
  if (!lower) return null;

  if (lower.includes("permanent") || lower === "perm") {
    return {
      amount: 0,
      unit: "perm",
      source: raw,
      formula: false,
      actorLevel
    };
  }

  const formulaPatterns = [
    /(\d+(?:\.\d+)?)\s*(round|rounds|rnd|rnds|minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\s*\/\s*(level|lvl)\b/i,
    /(\d+(?:\.\d+)?)\s*(round|rounds|rnd|rnds|minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\s*per\s*(level|lvl)\b/i
  ];

  for (const pattern of formulaPatterns) {
    const match = lower.match(pattern);
    if (!match) continue;

    const baseAmount = Number(match[1]);
    const unit = normalizeUnit(match[2]);
    if (!Number.isFinite(baseAmount) || !unit) continue;

    return {
      amount: baseAmount * actorLevel,
      unit,
      source: raw,
      formula: true,
      baseAmount,
      actorLevel
    };
  }

  const staticMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*(round|rounds|rnd|rnds|minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/i
  );

  if (staticMatch) {
    const amount = Number(staticMatch[1]);
    const unit = normalizeUnit(staticMatch[2]);
    if (Number.isFinite(amount) && unit) {
      return {
        amount,
        unit,
        source: raw,
        formula: false,
        actorLevel
      };
    }
  }

  return null;
}

function applyTemporalSkillsBonus(parsed, temporalSkillsInfo) {
  if (!parsed || !temporalSkillsInfo?.tier || parsed.unit === "perm") return parsed;

  const multiplier = 1 + (temporalSkillsInfo.tier * 0.5);

  return {
    ...parsed,
    amount: parseNumber(parsed.amount, 0) * multiplier,
    temporalSkillsTier: temporalSkillsInfo.tier,
    temporalSkillsMultiplier: multiplier
  };
}

function deriveSpellDuration(spell, learnedList, effectDef, temporalSkillsInfo, actorLevel = 1) {
  if (effectDef?.durationOverride) {
    const override = effectDef.durationOverride;

    if (override.unit === "perm") {
      return applyTemporalSkillsBonus({
        amount: 0,
        unit: "perm",
        source: "effectDef.durationOverride",
        formula: false,
        actorLevel
      }, temporalSkillsInfo);
    }

    if (Number.isFinite(Number(override.amountPerLevel)) && override.unit) {
      return applyTemporalSkillsBonus({
        amount: Number(override.amountPerLevel) * actorLevel,
        unit: normalizeUnit(override.unit),
        source: "effectDef.durationOverride",
        formula: true,
        baseAmount: Number(override.amountPerLevel),
        actorLevel
      }, temporalSkillsInfo);
    }

    if (Number.isFinite(Number(override.amount)) && override.unit) {
      return applyTemporalSkillsBonus({
        amount: Number(override.amount),
        unit: normalizeUnit(override.unit),
        source: "effectDef.durationOverride",
        formula: false,
        actorLevel
      }, temporalSkillsInfo);
    }
  }

  const candidates = [
    deepGet(spell, "duration"),
    deepGet(spell, "durationText"),
    deepGet(spell, "durationString"),
    deepGet(spell, "system.duration"),
    deepGet(spell, "system.durationText"),
    deepGet(spell, "system.durationFormula"),
    deepGet(spell, "system.durationBase"),
    deepGet(spell, "system.details.duration"),
    deepGet(spell, "system.details.duration.value"),
    deepGet(spell, "system.details.duration.text"),
    deepGet(spell, "system.spell.duration"),
    deepGet(spell, "system.spell.durationText"),
    deepGet(spell, "data.duration"),
    deepGet(spell, "data.details.duration"),
    deriveSpellDescription(spell),
    effectDef?.description
  ];

  let parsed = null;

  for (const value of candidates) {
    if (typeof value === "string") {
      parsed = parseDurationText(value, actorLevel);
      if (parsed) break;
    }

    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      parsed = {
        amount: value,
        unit: "rounds",
        source: "numeric",
        formula: false,
        actorLevel
      };
      break;
    }

    if (value && typeof value === "object") {
      const raw = value.text ?? value.value ?? value.label ?? value.formula;
      if (typeof raw === "string") {
        parsed = parseDurationText(raw, actorLevel);
        if (parsed) break;
      }
    }
  }

  if (!parsed) {
    parsed = {
      amount: 0,
      unit: "perm",
      source: "default",
      formula: false,
      actorLevel
    };
  }

  const adjusted = applyTemporalSkillsBonus(parsed, temporalSkillsInfo);

  log.debug("Derived duration", {
    spellName: spell?.name,
    listName: learnedList?.listName,
    actorLevel,
    parsed,
    adjusted,
    temporalSkillsInfo
  });

  return adjusted;
}

async function fetchKnownSpellsForActor(actor) {
  const SpellListFilter = await loadSpellListFilter();
  const spellSkills = getSpellSkills(actor);

  if (!spellSkills.length) {
    log.debug("No eligible spellcasting skills found on actor", actor?.name);
    return {
      spellSkills,
      fetchedLists: [],
      rows: []
    };
  }

  const listFilter = new SpellListFilter(spellSkills);
  const fetchedLists = await listFilter.getFetchedSpellLists();
  const rows = [];

  for (let i = 0; i < spellSkills.length; i += 1) {
    const skill = spellSkills[i];
    const spellListDoc = fetchedLists[i];

    if (!spellListDoc?.system) {
      log.debug("Fetched list missing or invalid", {
        skill: skill.specialization,
        spellListUuid: skill.spellListUuid,
        fetched: Boolean(spellListDoc)
      });
      continue;
    }

    let knownSpells = [];
    try {
      knownSpells = listFilter
        .spellsKnown(spellListDoc.system, skill, null)
        .filter((spell) => spell?.known);
    } catch (err) {
      log.error("Failed calling SpellListFilter.spellsKnown", {
        actor: actor?.name,
        skill: skill.specialization,
        spellListUuid: skill.spellListUuid,
        err
      });
      continue;
    }

    rows.push({
      skill,
      spellListDoc,
      knownSpells
    });
  }

  return {
    spellSkills,
    fetchedLists,
    rows
  };
}

function buildLearnedList(skill, spellListDoc) {
  return Object.freeze({
    listName: skill.specialization,
    listNameNorm: skill.specializationNorm,
    listType: skill.name,
    ranks: skill.ranks,
    spellListUuid: skill.spellListUuid,
    realms: spellListDoc?.system?.realms ?? ""
  });
}

function buildEntry({
  actor,
  token,
  spell,
  skill,
  spellListDoc,
  effectDef,
  temporalSkillsInfo,
  actorLevel
}) {
  const learnedList = buildLearnedList(skill, spellListDoc);
  const aoeText = deriveSpellAoeText(spell);
  const targetMode = resolveTargetMode(effectDef, aoeText);
  const maxTargets = resolveMaxTargets(effectDef, aoeText);
  const targetsPerLevel = resolveTargetsPerLevel(effectDef, aoeText);
  const durationInfo = deriveSpellDuration(
    spell,
    learnedList,
    effectDef,
    temporalSkillsInfo,
    actorLevel
  );
  const spellLevel = parseNumber(spell?.level, 0);
  const displayName = effectDef.label || spell?.name || `${learnedList.listName} ${spellLevel}`.trim();
  const sourceSpellUuid = spell?.uuid ?? null;
  const sourceSpellName = spell?.name ?? effectDef.label ?? "";

  const descriptionParts = unique([
    effectDef.description || "",
    deriveSpellDescription(spell)
  ].filter(Boolean));

  return Object.freeze({
    providerId: "spell",
    sourceType: "spell",
    id: `${effectDef.id}|${spell?.id ?? spell?.name ?? "spell"}|${token?.id ?? actor?.id ?? "actor"}`,
    definitionId: effectDef.id,
    identityKey: [
      "spell",
      effectDef.id,
      actor?.uuid ?? "no-caster",
      learnedList.listNameNorm,
      spellLevel,
      sourceSpellUuid ?? normalizeText(sourceSpellName)
    ].join("|"),
    displayName,
    img: deriveSpellImg(spell, effectDef.img),
    description: descriptionParts.join("\n\n"),
    actor,
    token,
    targeting: {
      mode: targetMode,
      aoeText,
      maxTargets,
      targetsPerLevel
    },
    duration: {
      amount: durationInfo.amount ?? 0,
      unit: durationInfo.unit ?? "perm",
      details: durationInfo
    },
    summary: {
      level: spellLevel,
      realm: learnedList.realms ?? "",
      bonus: effectDef.bonusText ?? "",
      sub1: effectDef.summary1 ?? "Spell",
      sub2: effectDef.summary2 ?? learnedList.listName,
      sub3: effectDef.automated === false ? "Reminder Only" : "Automated"
    },
    effectDef,
    changes: Array.isArray(effectDef.changes) ? effectDef.changes : [],
    providerData: Object.freeze({
      spell: {
        uuid: sourceSpellUuid,
        name: sourceSpellName,
        id: spell?.id ?? null
      },
      learnedList,
      temporalSkillsInfo,
      skillId: skill.id,
      spellListUuid: skill.spellListUuid
    })
  });
}

function sortEntries(entries) {
  entries.sort((a, b) => {
    const listA = String(a.providerData?.learnedList?.listName ?? "");
    const listB = String(b.providerData?.learnedList?.listName ?? "");
    const listCmp = listA.localeCompare(listB);
    if (listCmp) return listCmp;

    const levelCmp = parseNumber(a.summary?.level, 0) - parseNumber(b.summary?.level, 0);
    if (levelCmp) return levelCmp;

    return String(a.displayName ?? "").localeCompare(String(b.displayName ?? ""));
  });

  return entries;
}

function buildDebugSummary({ actor, rows, entries, definitionIndex }) {
  return {
    actor: actor?.name,
    actorId: actor?.id,
    actorUuid: actor?.uuid,
    configuredDefinitionCount: definitionIndex.all.length,
    configuredDefinitions: definitionIndex.all.map((def) => ({
      id: def.id,
      listName: def.matching?.listName ?? "",
      level: parseNumber(def.matching?.level, 0),
      spellName: def.matching?.spellName ?? null,
      targetMode: def.targetMode ?? "auto",
      maxTargets: def.maxTargets ?? null,
      targetsPerLevel: def.targetsPerLevel ?? null
    })),
    discoveredLists: rows.map((row) => ({
      listName: row.skill.specialization,
      ranks: row.skill.ranks,
      _totalRanks: row.skill._totalRanks,
      spellListUuid: row.skill.spellListUuid,
      knownSpells: row.knownSpells.map((spell) => ({
        name: spell.name ?? "",
        level: parseNumber(spell.level, 0)
      }))
    })),
    matchedEntries: entries.map((entry) => ({
      definitionId: entry.definitionId,
      displayName: entry.displayName,
      listName: entry.providerData?.learnedList?.listName ?? "",
      level: parseNumber(entry.summary?.level, 0),
      targetMode: entry.targeting?.mode ?? "",
      maxTargets: entry.targeting?.maxTargets ?? null,
      targetsPerLevel: entry.targeting?.targetsPerLevel ?? null,
      spellName: entry.providerData?.spell?.name ?? "",
      duration: entry.duration
    }))
  };
}

export const spellProvider = {
  id: "spell",
  label: "Spells",

  async isAvailable() {
    return game.system.id === "rmu";
  },

  async getAvailableEntries({ actor, token } = {}) {
    if (!actor) {
      log.debug("getAvailableEntries called without actor");
      return [];
    }

    if (game.system.id !== "rmu") {
      log.debug("Skipping spell provider because system is not RMU", game.system.id);
      return [];
    }

    const key = cacheKeyForActor(actor, token);
    const cached = providerCache.get(key);
    if (cached) {
      log.debug("Returning cached spell-provider entries", {
        actor: actor.name,
        actorUuid: actor.uuid,
        count: cached.length
      });
      return cached;
    }

    const actorLevel = getActorLevel(actor, 1);
    const temporalSkillsIndex = buildTemporalSkillsIndex(actor);
    const definitionIndex = buildDefinitionsIndex(SPELL_EFFECT_DEFINITIONS);

    log.debug("Starting spell discovery", {
      actor: actor.name,
      actorId: actor.id,
      actorUuid: actor.uuid,
      actorLevel,
      tokenId: token?.id ?? null,
      configuredDefinitionCount: definitionIndex.all.length
    });

    let fetched;
    try {
      fetched = await fetchKnownSpellsForActor(actor);
    } catch (err) {
      log.error("Failed fetching known spells for actor", actor?.name, err);
      return [];
    }

    const entries = [];

    for (const row of fetched.rows) {
      const { skill, spellListDoc, knownSpells } = row;
      const learnedList = buildLearnedList(skill, spellListDoc);
      const temporalSkillsInfo = getTemporalSkillsInfo(temporalSkillsIndex, learnedList.listName);

      for (const spell of knownSpells) {
        const spellLevel = parseNumber(spell?.level, 0);
        const candidates = findMatchingDefinitions(definitionIndex, skill, spell);

        log.debug("Candidate spell", {
          actor: actor.name,
          listName: skill.specialization,
          spellName: spell?.name ?? "",
          level: spellLevel,
          key: `${normalizeText(skill.specialization)}|${spellLevel}`,
          candidateDefinitionIds: candidates.map((def) => def.id)
        });

        if (!candidates.length) continue;

        for (const effectDef of candidates) {
          const entry = buildEntry({
            actor,
            token,
            spell,
            skill,
            spellListDoc,
            effectDef,
            temporalSkillsInfo,
            actorLevel
          });

          entries.push(entry);

          log.debug("Matched configured spell", {
            actor: actor.name,
            listName: skill.specialization,
            spellName: spell?.name ?? "",
            level: spellLevel,
            definitionId: effectDef.id,
            targetMode: entry.targeting?.mode,
            maxTargets: entry.targeting?.maxTargets,
            targetsPerLevel: entry.targeting?.targetsPerLevel,
            duration: entry.duration
          });
        }
      }
    }

    sortEntries(entries);

    const debugSummary = buildDebugSummary({
      actor,
      rows: fetched.rows,
      entries,
      definitionIndex
    });

    log.debug("Spell provider summary", debugSummary);

    if (!entries.length) {
      log.warn("No configured spell entries matched for actor", {
        actor: actor.name,
        hint: "Check definition matching.listName / matching.level / optional matching.spellName against discovered known spells.",
        discoveredLists: debugSummary.discoveredLists,
        configuredDefinitions: debugSummary.configuredDefinitions
      });
    }

    providerCache.set(key, entries);
    return entries;
  },

  renderEntryOption(entry, index) {
    const listName = entry.providerData?.learnedList?.listName ?? "";
    const level = entry.summary?.level ?? "";
    const spellName = entry.providerData?.spell?.name ?? entry.displayName ?? "";
    const targetMode = entry.targeting?.mode ? ` [${entry.targeting.mode}]` : "";

    return `
      <option value="${index}">
        ${escapeHtml(listName)} ${escapeHtml(level)} - ${escapeHtml(spellName)}${escapeHtml(targetMode)}
      </option>
    `;
  }
};