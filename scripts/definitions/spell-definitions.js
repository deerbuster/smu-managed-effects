// scripts/definitions/spell-definitions.js

const AE_MODES = CONST.ACTIVE_EFFECT_MODES;

function freezeChanges(changes = []) {
  return Object.freeze(
    changes.map((change) =>
      Object.freeze({
        key: change.key,
        mode: change.mode,
        value: change.value,
        priority: change.priority ?? 20
      })
    )
  );
}

function makeChanges(paths, value, mode = AE_MODES.ADD, priority = 20) {
  return freezeChanges(
    paths.map((key) => ({
      key,
      mode,
      value,
      priority
    }))
  );
}

function freezeDurationOverride(durationOverride = null) {
  if (!durationOverride) return null;
  return Object.freeze({ ...durationOverride });
}

function makeSpellDefinition({
  id,
  label,
  listName,
  level,
  spellName = null,
  automated = true,
  bonusText = "",
  summary1 = "Spell",
  summary2 = "",
  description = "",
  img = "icons/svg/aura.svg",
  targetMode = "auto",
  changes = [],
  durationOverride = null
}) {
  return Object.freeze({
    id,
    sourceType: "spell",
    label,
    matching: Object.freeze({
      provider: "spell",
      listName,
      level,
      ...(spellName ? { spellName } : {})
    }),
    automated,
    bonusText,
    summary1,
    summary2,
    description: String(description ?? ""),
    img,
    targetMode,
    changes: freezeChanges(changes),
    ...(durationOverride ? { durationOverride: freezeDurationOverride(durationOverride) } : {})
  });
}

function makeTieredSpellDefs({
  prefix,
  listName,
  entries,
  summary1,
  summary2,
  description,
  img,
  paths,
  targetMode = "auto",
  automated = true,
  durationOverride = null,
  mode = AE_MODES.ADD,
  priority = 20,
  spellName = null
}) {
  return entries.map(({ idSuffix, level, value, label, bonusText, spellName: entrySpellName }) =>
    makeSpellDefinition({
      id: `${prefix}-${idSuffix}`,
      label: label ?? `${listName} ${level}`,
      listName,
      level,
      spellName: entrySpellName ?? spellName,
      automated,
      bonusText: bonusText ?? (value >= 0 ? `+${value}` : `${value}`),
      summary1,
      summary2,
      description: typeof description === "function" ? description(value) : String(description ?? ""),
      img,
      targetMode,
      durationOverride,
      changes: makeChanges(paths, value, mode, priority)
    })
  );
}

/**
 * Target policy notes for the dialog / application layer:
 *
 * - "self"    -> always self-target only
 * - "target"  -> exactly one intended target
 * - "targets" -> multiple discrete targets
 * - "area"    -> area / mass-style spell; dialog may still choose multiple tokens
 * - "auto"    -> let provider/dialog infer from spell data
 *
 * Keep these explicit where possible so the UI does not need to guess.
 */
export const SPELL_EFFECT_DEFINITIONS = Object.freeze([
  makeSpellDefinition({
    id: "shield-mastery-shield",
    label: "Shield",
    listName: "Shield Mastery",
    level: 2,
    spellName: "Shield",
    automated: true,
    bonusText: "+25",
    summary1: "DB Bonus",
    summary2: "Other DB",
    description: "Adds +25 to DB.",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-blue.webp",
    targetMode: "self",
    changes: [
      {
        key: "system.defense.other",
        mode: AE_MODES.ADD,
        value: 25,
        priority: 20
      }
    ]
  }),

  makeSpellDefinition({
    id: "shield-mastery-blur",
    label: "Blur",
    listName: "Shield Mastery",
    level: 3,
    spellName: "Blur",
    automated: true,
    bonusText: "+10",
    summary1: "DB Bonus",
    summary2: "Other DB",
    description: "Adds +10 to DB.",
    img: "icons/magic/air/fog-gas-smoke-dense-blue.webp",
    targetMode: "target",
    changes: [
      {
        key: "system.defense.other",
        mode: AE_MODES.ADD,
        value: 10,
        priority: 20
      }
    ]
  }),

  makeSpellDefinition({
    id: "shield-mastery-greater-shield",
    label: "Greater Shield",
    listName: "Shield Mastery",
    level: 14,
    spellName: "Greater Shield",
    automated: true,
    bonusText: "+40",
    summary1: "DB Bonus",
    summary2: "Other DB",
    description: "Adds +40 to DB.",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-blue.webp",
    targetMode: "self",
    changes: [
      {
        key: "system.defense.other",
        mode: AE_MODES.ADD,
        value: 40,
        priority: 20
      }
    ]
  }),

  makeSpellDefinition({
    id: "shield-mastery-mass-blur",
    label: "Mass Blur",
    listName: "Shield Mastery",
    level: 16,
    spellName: "Mass Blur",
    automated: true,
    bonusText: "+10",
    summary1: "DB Bonus",
    summary2: "Other DB",
    description: "Adds +10 to DB.",
    img: "icons/magic/air/fog-gas-smoke-dense-blue.webp",
    targetMode: "targets",
    changes: [
      {
        key: "system.defense.other",
        mode: AE_MODES.ADD,
        value: 10,
        priority: 20
      }
    ]
  }),

  makeSpellDefinition({
    id: "attack-avoidance-shield",
    label: "Shield",
    listName: "Attack Avoidance",
    level: 3,
    spellName: "Shield",
    automated: true,
    bonusText: "+25",
    summary1: "DB Bonus",
    summary2: "Other DB",
    description: "Adds +25 to DB.",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-blue.webp",
    targetMode: "self",
    changes: [
      {
        key: "system.defense.other",
        mode: AE_MODES.ADD,
        value: 25,
        priority: 20
      }
    ]
  }),

  makeSpellDefinition({
    id: "cloaking-blur",
    label: "Blur",
    listName: "Cloaking",
    level: 1,
    spellName: "Blur",
    automated: true,
    bonusText: "+10",
    summary1: "DB Bonus",
    summary2: "Other DB",
    description: "Adds +10 to DB.",
    img: "icons/magic/air/fog-gas-smoke-dense-blue.webp",
    targetMode: "self",
    changes: [
      {
        key: "system.defense.other",
        mode: AE_MODES.ADD,
        value: 10,
        priority: 20
      }
    ]
  }),

  makeSpellDefinition({
    id: "holy-shields-aura",
    label: "Aura",
    listName: "Holy Shields",
    level: 2,
    spellName: "Aura",
    automated: true,
    bonusText: "+10",
    summary1: "DB Bonus",
    summary2: "Other DB",
    description: "Adds +10 to DB.",
    img: "icons/magic/air/fog-gas-smoke-dense-blue.webp",
    targetMode: "self",
    changes: [
      {
        key: "system.defense.other",
        mode: AE_MODES.ADD,
        value: 10,
        priority: 20
      }
    ]
  }),

  makeSpellDefinition({
    id: "holy-shields-true-aura",
    label: "True Aura",
    listName: "Holy Shields",
    level: 8,
    spellName: "True Aura",
    automated: true,
    bonusText: "+15",
    summary1: "DB Bonus",
    summary2: "Other DB",
    description: "Adds +15 to DB.",
    img: "icons/magic/air/fog-gas-smoke-dense-blue.webp",
    targetMode: "self",
    changes: [
      {
        key: "system.defense.other",
        mode: AE_MODES.ADD,
        value: 15,
        priority: 20
      }
    ]
  }),

  makeSpellDefinition({
    id: "inspiring-ways-leadership",
    label: "Leadership",
    listName: "Inspiring Ways",
    level: 11,
    spellName: "Leadership",
    automated: true,
    bonusText: "+25 / +5",
    summary1: "Social Bonus",
    summary2: "Leadership + Influence",
    description: "Adds +25 to Leadership and +5 to Influence.",
    img: "icons/skills/social/diplomacy-handshake.webp",
    targetMode: "self",
    changes: [
      {
        key: "system.skills.Social.Leadership.bonus",
        mode: AE_MODES.ADD,
        value: 25,
        priority: 20
      },
      {
        key: "system.skills.Social.Influence.bonus",
        mode: AE_MODES.ADD,
        value: 5,
        priority: 20
      }
    ]
  }),

  makeSpellDefinition({
    id: "inspiring-ways-leadership-true",
    label: "True Leadership",
    listName: "Inspiring Ways",
    level: 35,
    spellName: "True Leadership",
    automated: true,
    bonusText: "+50 / +15",
    summary1: "Social Bonus",
    summary2: "Leadership + Influence",
    description: "Adds +50 to Leadership and +15 to Influence.",
    img: "icons/skills/social/diplomacy-handshake.webp",
    targetMode: "self",
    changes: [
      {
        key: "system.skills.Social.Leadership.bonus",
        mode: AE_MODES.ADD,
        value: 50,
        priority: 20
      },
      {
        key: "system.skills.Social.Influence.bonus",
        mode: AE_MODES.ADD,
        value: 15,
        priority: 20
      }
    ]
  }),

  ...makeTieredSpellDefs({
    prefix: "inspirations",
    listName: "Inspiring Ways",
    entries: [
      { idSuffix: "1", level: 2, value: 5, label: "Inspiration I" },
      { idSuffix: "2", level: 4, value: 10, label: "Inspiration II" },
      { idSuffix: "3", level: 6, value: 15, label: "Inspiration III" },
      { idSuffix: "4", level: 9, value: 20, label: "Inspiration IV" },
      { idSuffix: "5", level: 12, value: 25, label: "Inspiration V" },
      { idSuffix: "6", level: 15, value: 30, label: "Inspiration VI" },
      { idSuffix: "7", level: 17, value: 35, label: "Inspiration VII" },
      { idSuffix: "8", level: 19, value: 40, label: "Inspiration VIII" },
      { idSuffix: "true", level: 25, value: 50, label: "True Inspiration" },
      { idSuffix: "masstrue", level: 40, value: 50, label: "Mass True Inspiration" }
    ],
    summary1: "OB Bonus",
    summary2: "Melee + Unarmed",
    description: (v) => `Adds +${v} to OB.`,
    img: "icons/magic/air/fog-gas-smoke-dense-blue.webp",
    targetMode: "target",
    paths: [
      "system.skills.Combat Training.Melee Weapons.bonus",
      "system.skills.Combat Training.Unarmed.bonus"
    ]
  }),

  ...makeTieredSpellDefs({
    prefix: "holyattack",
    listName: "Holy Arms",
    entries: [
      { idSuffix: "1", level: 1, value: 5, label: "Holy Attack I" },
      { idSuffix: "2", level: 4, value: 10, label: "Holy Attack II" },
      { idSuffix: "3", level: 7, value: 15, label: "Holy Attack III" },
      { idSuffix: "4", level: 10, value: 20, label: "Holy Attack IV" },
      { idSuffix: "5", level: 13, value: 25, label: "Holy Attack V" },
      { idSuffix: "6", level: 16, value: 30, label: "Holy Attack VI" },
      { idSuffix: "7", level: 19, value: 35, label: "Holy Attack VII" },
      { idSuffix: "8", level: 25, value: 40, label: "Holy Attack VIII" },
      { idSuffix: "10", level: 35, value: 50, label: "Holy Attack X" }
    ],
    summary1: "OB Bonus",
    summary2: "Melee + Unarmed + Ranged",
    description: (v) => `Adds +${v} to melee or missile attacks.`,
    img: "icons/magic/air/fog-gas-smoke-dense-blue.webp",
    targetMode: "self",
    paths: [
      "system.skills.Combat Training.Melee Weapons.bonus",
      "system.skills.Combat Training.Unarmed.bonus",
      "system.skills.Combat Training.Ranged Weapons.bonus"
    ]
  }),

  ...makeTieredSpellDefs({
    prefix: "holystrength",
    listName: "Holy Arms",
    entries: [
      { idSuffix: "1", level: 3, value: 5, label: "Holy Strength I" },
      { idSuffix: "2", level: 12, value: 10, label: "Holy Strength II" },
      { idSuffix: "3", level: 17, value: 15, label: "Holy Strength III" }
    ],
    summary1: "Stat Bonus",
    summary2: "Strength",
    description: (v) => `Adds +${v} to Strength bonus.`,
    img: "icons/magic/air/fog-gas-smoke-dense-blue.webp",
    targetMode: "self",
    paths: [
      "system.stats.St.bonus"
    ]
  }),

  makeSpellDefinition({
    id: "holy-shields-shield-of-faith",
    label: "Shield of Faith",
    listName: "Holy Shields",
    level: 3,
    spellName: "Shield of Faith",
    automated: true,
    bonusText: "+25",
    summary1: "DB Bonus",
    summary2: "Other DB",
    description: "Adds +25 DB against up to 3 frontal attacks per round. Assumes the no-free-arm version of the spell.",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-gold.webp",
    targetMode: "self",
    durationOverride: {
      amountPerLevel: 1,
      unit: "rounds"
    },
    changes: [
      {
        key: "system.defense.other",
        mode: AE_MODES.ADD,
        value: 25,
        priority: 20
      }
    ]
  })
]);