import { FLAGS, MODULE_ID, SOCKET_ACTIONS } from "../constants.js";
import {
  cloneDuration,
  formatDurationLabel,
  isPermanentDuration,
  normalizeDurationUnit,
  secondsFromDuration
} from "../utils/duration.js";
import { parseNumber } from "../utils/common.js";
import { createLogger } from "../utils/log.js";

const log = createLogger("effect-application");
const SOCKET_NAME = `module.${MODULE_ID}`;

const socketRequests = new Map();
let socketRegistered = false;

function getTargetMode(entry) {
  return entry?.effectDef?.targetMode
    ?? entry?.targeting?.mode
    ?? "auto";
}

function requiresExplicitTarget(entry) {
  return ["target", "targets", "area"].includes(getTargetMode(entry));
}

function isSelfOnly(entry) {
  return getTargetMode(entry) === "self";
}

function getExplicitMaxTargets(entry) {
  const maxTargets = Number(entry?.effectDef?.maxTargets ?? entry?.targeting?.maxTargets);
  if (Number.isFinite(maxTargets) && maxTargets > 0) return maxTargets;
  return null;
}

function canUserManageActorEffects(actor, user = game.user) {
  if (!actor || !user) return false;
  if (user.isGM) return true;

  return actor.testUserPermission(
    user,
    CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
  );
}

function canApplyDirectly(entry, casterActor, targets) {
  if (game.user?.isGM) return true;
  if (!casterActor) return false;

  const allTargets = Array.isArray(targets) ? targets : [];
  if (!allTargets.length) return false;

  return allTargets.every((target) => canUserManageActorEffects(target?.actor, game.user));
}

function buildEffectName(entry) {
  return entry.effectDef?.label ?? entry.providerData?.spell?.name ?? entry.displayName ?? "Effect";
}

function buildEffectIcon(entry) {
  return entry.img || "icons/svg/aura.svg";
}

function buildEffectDescription(entry, casterActor, targetActor, appliedDuration) {
  const lines = [];

  if (entry.summary?.sub1 || entry.summary?.bonus) {
    lines.push([entry.summary.sub1, entry.summary.bonus].filter(Boolean).join(": "));
  }

  if (entry.summary?.sub2) lines.push(entry.summary.sub2);
  if (entry.summary?.sub3) lines.push(entry.summary.sub3);
  if (entry.providerData?.learnedList?.listName) lines.push(`Source List: ${entry.providerData.learnedList.listName}`);
  if (casterActor?.name) lines.push(`Caster: ${casterActor.name}`);
  if (targetActor?.name) lines.push(`Target: ${targetActor.name}`);

  if (appliedDuration) {
    const label = formatDurationLabel(appliedDuration);
    lines.push(`Duration: ${label === "—" ? "Permanent" : label}`);
  }

  if (entry.description) {
    lines.push("");
    lines.push(entry.description);
  }

  return lines.filter(Boolean).join("\n");
}

function buildSummaryData(entry, appliedDuration, automated = true) {
  return {
    type: "activeEffect",
    level: parseNumber(entry.summary?.level, 0),
    realm: entry.summary?.realm ?? "",
    bonus: entry.summary?.bonus ?? "",
    sub1: entry.summary?.sub1 ?? "Spell",
    sub1Label: "",
    sub2: entry.summary?.sub2 ?? "",
    sub2Label: "",
    sub3: entry.summary?.sub3 ?? (automated ? "Automated" : "Reminder Only"),
    sub3Label: "",
    duration: formatDurationLabel(appliedDuration)
  };
}

function buildSourceIdentity(entry, casterActor) {
  return [
    entry.providerId ?? "unknown-provider",
    entry.definitionId ?? "unknown-definition",
    casterActor?.uuid ?? entry.actor?.uuid ?? "no-caster",
    entry.providerData?.spell?.uuid ?? entry.providerData?.spell?.name ?? entry.displayName ?? "no-source"
  ].join("|");
}

function buildIdentityKey(entry, casterActor, targetActor) {
  return [
    buildSourceIdentity(entry, casterActor),
    targetActor?.uuid ?? "no-target"
  ].join("|");
}

function buildManagedFlag(entry, casterActor, casterToken, targetActor, targetToken, appliedDuration, identityKey) {
  return {
    managed: true,
    definitionId: entry.definitionId,
    sourceType: entry.sourceType,
    providerId: entry.providerId,
    sourceId: entry.id,
    sourceName: entry.providerData?.spell?.name ?? entry.displayName ?? "",
    sourceCategory: entry.providerData?.learnedList?.listName ?? "",
    sourceTier: parseNumber(entry.summary?.level, 0),
    sourceUuid: entry.providerData?.spell?.uuid ?? null,
    actorUuid: casterActor?.uuid ?? null,
    actorTokenId: casterToken?.id ?? null,
    targetActorUuid: targetActor?.uuid ?? null,
    targetTokenId: targetToken?.id ?? null,
    identityKey,
    duration: appliedDuration ?? null,
    targeting: {
      ...(entry.targeting ?? {}),
      mode: getTargetMode(entry)
    },
    providerData: {
      spellName: entry.providerData?.spell?.name ?? null,
      spellLevel: parseNumber(entry.summary?.level, 0),
      spellList: entry.providerData?.learnedList?.listName ?? null,
      spellListUuid: entry.providerData?.spellListUuid ?? null
    }
  };
}

function buildDurationData(duration) {
  if (!duration || isPermanentDuration(duration)) {
    return {
      flags: {
        rmu: {
          expires: false
        }
      }
    };
  }

  const amount = parseNumber(duration.amount, 0);
  const unit = normalizeDurationUnit(duration.unit);

  if (!amount) {
    return {
      flags: {
        rmu: {
          expires: false
        }
      }
    };
  }

  if (unit === "rounds" && game.combat) {
    return {
      duration: {
        combat: game.combat.id,
        startRound: game.combat.round ?? 0,
        rounds: amount
      },
      flags: {
        rmu: {
          expires: true
        }
      }
    };
  }

  const seconds = secondsFromDuration(amount, unit);
  if (!seconds) {
    return {
      flags: {
        rmu: {
          expires: false
        }
      }
    };
  }

  return {
    duration: {
      startTime: game.time?.worldTime ?? 0,
      seconds
    },
    flags: {
      rmu: {
        expires: true
      }
    }
  };
}

function getManagedEffectFlag(effect) {
  return effect?.flags?.[MODULE_ID]?.[FLAGS.MANAGED_EFFECT] ?? null;
}

function findExistingManagedEffect(targetActor, identityKey) {
  return targetActor?.effects?.find((effect) => {
    const flag = getManagedEffectFlag(effect);
    return flag?.managed && flag?.identityKey === identityKey;
  }) ?? null;
}

function buildEffectData(entry, casterActor, casterToken, targetActor, targetToken, appliedDuration) {
  const automated = entry.effectDef?.automated !== false;
  const description = buildEffectDescription(entry, casterActor, targetActor, appliedDuration);
  const summaryData = buildSummaryData(entry, appliedDuration, automated);
  const durationData = buildDurationData(appliedDuration);
  const identityKey = buildIdentityKey(entry, casterActor, targetActor);

  const payload = {
    name: buildEffectName(entry),
    img: buildEffectIcon(entry),
    origin: entry.providerData?.spell?.uuid ?? casterActor?.uuid ?? null,
    transfer: false,
    disabled: false,
    description,
    statuses: [],
    sort: 0,
    system: {
      sourceName: entry.providerData?.learnedList?.listName ?? "Spell",
      _allowDelete: true,
      summary: summaryData,
      managedEffectDescription: description
    },
    changes: Array.isArray(entry.changes)
      ? entry.changes.map((change) => ({
        key: change.key,
        mode: change.mode,
        value: change.value,
        priority: change.priority ?? 20
      }))
      : [],
    flags: foundry.utils.mergeObject(
      {
        [MODULE_ID]: {
          [FLAGS.MANAGED_EFFECT]: buildManagedFlag(
            entry,
            casterActor,
            casterToken,
            targetActor,
            targetToken,
            appliedDuration,
            identityKey
          )
        }
      },
      durationData.flags ?? {},
      { inplace: false }
    )
  };

  if (durationData.duration) payload.duration = durationData.duration;

  log.debug("Built effect data", payload);
  return payload;
}

function getSceneById(sceneId) {
  return sceneId ? game.scenes?.get(sceneId) ?? null : canvas?.scene ?? null;
}

function getTokenReference({ sceneId, tokenId } = {}) {
  if (!tokenId) return null;

  if (canvas?.scene?.id === sceneId) {
    return canvas.tokens?.placeables?.find((token) => token.id === tokenId) ?? null;
  }

  const scene = getSceneById(sceneId);
  const tokenDoc = scene?.tokens?.get(tokenId) ?? null;
  if (!tokenDoc) return null;

  return {
    id: tokenDoc.id,
    name: tokenDoc.name,
    scene: tokenDoc.parent,
    document: tokenDoc,
    actor: tokenDoc.actor
  };
}

function resolveAppliedDuration(entry, overrides = {}) {
  const base = cloneDuration(entry?.duration ?? { amount: 0, unit: "perm" });
  const override = overrides?.duration;

  if (!override) return base;

  const unit = normalizeDurationUnit(override.unit ?? base.unit);
  const amount = unit === "perm" ? 0 : Math.max(0, parseNumber(override.amount, base.amount));

  return { amount, unit };
}

function targetIdentityParts(target) {
  const actorUuid = target?.actor?.uuid ?? target?.actorUuid ?? "no-actor";
  const tokenId = target?.token?.id ?? target?.tokenId ?? "no-token";
  const sceneId = target?.sceneId
    ?? target?.token?.scene?.id
    ?? target?.token?.document?.parent?.id
    ?? canvas?.scene?.id
    ?? "no-scene";

  return { actorUuid, tokenId, sceneId };
}

function dedupeTargets(targets) {
  const seen = new Set();
  const deduped = [];

  for (const target of targets ?? []) {
    const { actorUuid, tokenId, sceneId } = targetIdentityParts(target);
    const key = `${actorUuid}|${sceneId}|${tokenId}`;

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(target);
  }

  return deduped;
}

function clampTargetsToEntry(entry, targets) {
  const maxTargets = getExplicitMaxTargets(entry);
  if (!Number.isFinite(maxTargets) || maxTargets <= 0) return targets;
  return targets.slice(0, maxTargets);
}

function collectChosenTargetsFromIds(chosenIds = []) {
  return dedupeTargets(
    chosenIds
      .map((id) => getTokenReference({ sceneId: canvas?.scene?.id ?? null, tokenId: id }))
      .filter((token) => token?.actor)
      .map((token) => ({
        actor: token.actor,
        token,
        actorUuid: token.actor.uuid,
        tokenId: token.id,
        sceneId: canvas?.scene?.id ?? token.scene?.id ?? token.document?.parent?.id ?? null
      }))
  );
}

function collectUserTargets() {
  return dedupeTargets(
    Array.from(game.user?.targets ?? [])
      .filter((token) => token?.actor)
      .map((token) => ({
        actor: token.actor,
        token,
        actorUuid: token.actor.uuid,
        tokenId: token.id,
        sceneId: canvas?.scene?.id ?? token.scene?.id ?? null
      }))
  );
}

function buildSelfTarget(casterToken) {
  return {
    actor: casterToken.actor,
    token: casterToken,
    actorUuid: casterToken.actor.uuid,
    tokenId: casterToken.id,
    sceneId: canvas?.scene?.id ?? casterToken.scene?.id ?? null
  };
}

function resolveTargets(entry, casterToken, overrides = {}) {
  if (!casterToken?.actor) return [];

  const mode = getTargetMode(entry);
  const chosenIds = Array.isArray(overrides?.chosenTargetIds) ? overrides.chosenTargetIds : [];
  const chosenTargets = collectChosenTargetsFromIds(chosenIds);
  const userTargets = collectUserTargets();
  const selfTarget = buildSelfTarget(casterToken);

  if (mode === "self") {
    return [selfTarget];
  }

  if (mode === "target") {
    const explicitTarget = chosenTargets[0] ?? userTargets[0] ?? null;
    return explicitTarget ? [explicitTarget] : [];
  }

  if (mode === "targets" || mode === "area") {
    const explicitTargets = chosenTargets.length ? chosenTargets : userTargets;
    return clampTargetsToEntry(entry, explicitTargets);
  }

  if (chosenTargets.length) {
    return clampTargetsToEntry(entry, chosenTargets);
  }

  if (userTargets.length) {
    return clampTargetsToEntry(entry, userTargets);
  }

  return [selfTarget];
}

function serializeEntry(entry) {
  return {
    providerId: entry.providerId,
    sourceType: entry.sourceType,
    id: entry.id,
    definitionId: entry.definitionId,
    identityKey: entry.identityKey,
    displayName: entry.displayName,
    img: entry.img,
    description: entry.description,
    targeting: {
      ...(entry.targeting ?? {}),
      mode: getTargetMode(entry)
    },
    duration: entry.duration,
    summary: entry.summary,
    effectDef: {
      automated: entry.effectDef?.automated !== false,
      label: entry.effectDef?.label ?? entry.displayName ?? "",
      targetMode: entry.effectDef?.targetMode ?? null,
      maxTargets: entry.effectDef?.maxTargets ?? null,
      targetsPerLevel: entry.effectDef?.targetsPerLevel ?? null
    },
    changes: Array.isArray(entry.changes) ? entry.changes.map((change) => ({ ...change })) : [],
    providerData: {
      spell: entry.providerData?.spell ?? null,
      learnedList: entry.providerData?.learnedList ?? null,
      temporalSkillsInfo: entry.providerData?.temporalSkillsInfo ?? null,
      skillId: entry.providerData?.skillId ?? null,
      spellListUuid: entry.providerData?.spellListUuid ?? null
    }
  };
}

function serializeTargets(targets) {
  return dedupeTargets(targets).map((target) => ({
    actorUuid: target.actorUuid ?? target.actor?.uuid ?? null,
    tokenId: target.tokenId ?? target.token?.id ?? null,
    sceneId: target.sceneId ?? target.token?.scene?.id ?? target.token?.document?.parent?.id ?? canvas?.scene?.id ?? null
  }));
}

function resolveSerializedTargets(targets) {
  return dedupeTargets(
    (targets ?? [])
      .map((target) => {
        const token = getTokenReference(target);
        const actor = token?.actor ?? (target.actorUuid ? fromUuidSync(target.actorUuid) : null);

        return {
          actor,
          token,
          actorUuid: actor?.uuid ?? target.actorUuid ?? null,
          tokenId: target.tokenId ?? token?.id ?? null,
          sceneId: target.sceneId ?? token?.scene?.id ?? token?.document?.parent?.id ?? null
        };
      })
      .filter((target) => target.actor)
  );
}

async function upsertManagedEffect(targetActor, effectData, identityKey) {
  const existing = findExistingManagedEffect(targetActor, identityKey);

  if (existing) {
    log.debug("Updating existing managed effect", {
      targetActor: targetActor.name,
      effectId: existing.id,
      identityKey
    });

    await existing.update(effectData);
    return existing;
  }

  log.debug("Creating managed effect", {
    targetActor: targetActor.name,
    identityKey,
    effectName: effectData.name
  });

  const created = await targetActor.createEmbeddedDocuments("ActiveEffect", [effectData]);
  return created?.[0] ?? null;
}

async function applyResolvedEffectEntry(entry, { casterToken, casterActor, appliedDuration, targets } = {}) {
  const results = [];

  for (const target of targets ?? []) {
    const effectData = buildEffectData(
      entry,
      casterActor,
      casterToken,
      target.actor,
      target.token,
      appliedDuration
    );

    const identityKey = buildIdentityKey(entry, casterActor, target.actor);
    const applied = await upsertManagedEffect(target.actor, effectData, identityKey);

    if (applied) {
      results.push({
        actor: target.actor,
        token: target.token ?? null,
        effect: applied
      });
    }
  }

  return results;
}

function buildSocketError(message, details = null) {
  return {
    ok: false,
    error: message,
    details
  };
}

function emitSocket(message) {
  game.socket?.emit(SOCKET_NAME, message);
}

function requestGmApplyEffect(payload) {
  return new Promise((resolve, reject) => {
    const requestId = foundry.utils.randomID();

    const timer = window.setTimeout(() => {
      socketRequests.delete(requestId);
      reject(new Error("Timed out waiting for GM to apply the managed effect."));
    }, 15000);

    socketRequests.set(requestId, {
      resolve,
      reject,
      timer
    });

    emitSocket({
      action: SOCKET_ACTIONS.APPLY_EFFECTS_REQUEST,
      requestId,
      userId: game.user.id,
      payload
    });
  });
}

async function handleApplyEffectsRequest(message) {
  if (!game.user?.isGM) return;

  const activeGm = game.users?.activeGM;
  if (activeGm?.id && activeGm.id !== game.user.id) return;

  const { requestId, userId, payload } = message ?? {};
  if (!requestId || !userId || !payload) return;

  let response;

  try {
    const casterToken = getTokenReference(payload.casterContext ?? {});
    const casterActor = casterToken?.actor ?? (payload.casterContext?.actorUuid ? fromUuidSync(payload.casterContext.actorUuid) : null);

    if (!casterActor) {
      throw new Error("Caster actor could not be resolved on the GM client.");
    }

    const mode = getTargetMode(payload.entry);
    const targets = clampTargetsToEntry(payload.entry, resolveSerializedTargets(payload.targets));

    if (isSelfOnly(payload.entry)) {
      if (!casterToken?.actor) {
        throw new Error("Self-targeted effect requires a valid caster token on the GM client.");
      }
    } else if (requiresExplicitTarget(payload.entry) && !targets.length) {
      throw new Error(`This effect requires ${mode === "target" ? "a target" : "one or more targets"}.`);
    } else if (!targets.length) {
      throw new Error("No valid targets could be resolved on the GM client.");
    }

    const finalTargets = isSelfOnly(payload.entry) ? [buildSelfTarget(casterToken)] : targets;

    const results = await applyResolvedEffectEntry(payload.entry, {
      casterToken,
      casterActor,
      appliedDuration: payload.appliedDuration,
      targets: finalTargets
    });

    response = {
      ok: true,
      result: {
        count: results.length,
        names: results.map((result) => result.actor?.name).filter(Boolean)
      }
    };
  } catch (err) {
    log.error("GM application request failed.", err, payload);
    response = buildSocketError(err.message ?? "GM application failed.");
  }

  emitSocket({
    action: SOCKET_ACTIONS.APPLY_EFFECTS_RESPONSE,
    requestId,
    userId,
    payload: response
  });
}

function handleApplyEffectsResponse(message) {
  const { requestId, userId, payload } = message ?? {};
  if (!requestId || userId !== game.user.id) return;

  const pending = socketRequests.get(requestId);
  if (!pending) return;

  socketRequests.delete(requestId);
  window.clearTimeout(pending.timer);

  if (payload?.ok) {
    pending.resolve(payload.result ?? {});
    return;
  }

  pending.reject(new Error(payload?.error ?? "GM application failed."));
}

function onSocketMessage(message) {
  switch (message?.action) {
    case SOCKET_ACTIONS.APPLY_EFFECTS_REQUEST:
      void handleApplyEffectsRequest(message);
      break;
    case SOCKET_ACTIONS.APPLY_EFFECTS_RESPONSE:
      handleApplyEffectsResponse(message);
      break;
    default:
      break;
  }
}

export function registerEffectApplicationSocket() {
  if (socketRegistered) return;
  game.socket?.on(SOCKET_NAME, onSocketMessage);
  socketRegistered = true;
}

export async function applyEffectEntry(entry, { casterToken, overrides = {} } = {}) {
  if (!entry) {
    ui.notifications.warn("No effect entry was provided.");
    return [];
  }

  const resolvedCasterToken = casterToken ?? entry.token ?? null;
  const casterActor = resolvedCasterToken?.actor ?? entry.actor ?? null;

  if (!resolvedCasterToken?.actor || !casterActor) {
    ui.notifications.warn("A valid caster token is required.");
    return [];
  }

  const appliedDuration = resolveAppliedDuration(entry, overrides);
  const targets = clampTargetsToEntry(entry, resolveTargets(entry, resolvedCasterToken, overrides));
  const mode = getTargetMode(entry);

  if (isSelfOnly(entry)) {
    log.debug("Applying self-targeted effect", {
      entryId: entry.id,
      definitionId: entry.definitionId,
      caster: casterActor.name
    });
  } else if (requiresExplicitTarget(entry) && !targets.length) {
    ui.notifications.warn(`This effect requires ${mode === "target" ? "a target" : "one or more targets"}.`);
    return [];
  } else if (!targets.length) {
    ui.notifications.warn("No valid targets found.");
    return [];
  }

  const finalTargets = isSelfOnly(entry) ? [buildSelfTarget(resolvedCasterToken)] : targets;
  const directApply = canApplyDirectly(entry, casterActor, finalTargets);

  log.debug("Applying effect entry", {
    entryId: entry.id,
    definitionId: entry.definitionId,
    sourceType: entry.sourceType,
    targetMode: mode,
    caster: casterActor.name,
    appliedDuration,
    chosenTargetIds: overrides?.chosenTargetIds ?? [],
    directApply,
    targets: finalTargets.map((target) => target.actor?.name)
  });

  try {
    let results;

    if (directApply) {
      results = await applyResolvedEffectEntry(entry, {
        casterToken: resolvedCasterToken,
        casterActor,
        appliedDuration,
        targets: finalTargets
      });
    } else {
      const response = await requestGmApplyEffect({
        entry: serializeEntry(entry),
        casterContext: {
          actorUuid: casterActor.uuid,
          tokenId: resolvedCasterToken.id,
          sceneId: canvas?.scene?.id ?? resolvedCasterToken.scene?.id ?? null
        },
        appliedDuration,
        targets: serializeTargets(finalTargets)
      });

      results = (response?.names ?? []).map((name) => ({
        actor: { name },
        token: null,
        effect: null
      }));
    }

    if (results.length) {
      const names = results.map((result) => result.actor?.name).filter(Boolean).join(", ");
      ui.notifications.info(`Applied ${entry.displayName} to ${names}.`);
    }

    return results;
  } catch (err) {
    log.error("Failed applying effect entry.", err);
    ui.notifications.error(err.message ?? "Failed to apply managed effect.");
    return [];
  }
}