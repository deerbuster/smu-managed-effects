import { SOURCE_TYPES } from "../constants.js";
import { getEffectProvider } from "../core/provider-registry.js";
import { applyEffectEntry } from "../core/effect-application-service.js";
import { normalizeDurationUnit } from "../utils/duration.js";
import { escapeHtml, getActorLevel } from "../utils/common.js";

function resolveCasterToken(explicitToken) {
  if (explicitToken?.actor) return explicitToken;
  return canvas?.tokens?.controlled?.find((token) => token?.actor) ?? null;
}

function getTargetMode(entry) {
  return entry?.effectDef?.targetMode
    ?? entry?.targeting?.mode
    ?? "auto";
}

function isSelfOnlyEntry(entry) {
  return getTargetMode(entry) === "self";
}

function isSingleTargetEntry(entry) {
  return getTargetMode(entry) === "target";
}

function isMultiTargetEntry(entry) {
  return ["targets", "area"].includes(getTargetMode(entry));
}

function getMaxSelectableTargets(entry, actor) {
  if (isSelfOnlyEntry(entry)) return 0;
  if (isSingleTargetEntry(entry)) return 1;

  const explicitMax = Number(entry?.effectDef?.maxTargets ?? entry?.targeting?.maxTargets);
  if (Number.isFinite(explicitMax) && explicitMax > 0) return explicitMax;

  const actorLevel = Math.max(1, getActorLevel(actor, 1));
  const perLevel = Number(entry?.effectDef?.targetsPerLevel ?? entry?.targeting?.targetsPerLevel);
  if (Number.isFinite(perLevel) && perLevel > 0) {
    return perLevel * actorLevel;
  }

  return null;
}

function getChosenTargetCandidates(casterToken, entry) {
  if (isSelfOnlyEntry(entry)) return [];

  return Array.from(canvas?.tokens?.placeables ?? [])
    .filter((token) => token?.actor)
    .filter((token) => token.id !== casterToken?.id)
    .map((token) => ({
      id: token.id,
      name: token.name ?? token.actor?.name ?? token.id
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildTargetOptionsHtml(candidates, currentTargets, { includeBlank = false } = {}) {
  const currentIds = new Set(Array.from(currentTargets ?? []).map((target) => target.id));

  const options = candidates.map((candidate) => {
    const selected = currentIds.has(candidate.id) ? "selected" : "";
    return `<option value="${escapeHtml(candidate.id)}" ${selected}>${escapeHtml(candidate.name)}</option>`;
  });

  if (includeBlank) {
    options.unshift(`<option value="">Use current user targets / fallback</option>`);
  }

  return options.join("");
}

function buildDurationUnitOptions(selectedUnit) {
  const units = [
    { value: "perm", label: "Permanent" },
    { value: "rounds", label: "Rounds" },
    { value: "minutes", label: "Minutes" },
    { value: "hours", label: "Hours" },
    { value: "days", label: "Days" }
  ];

  return units.map((unit) => {
    const selected = unit.value === selectedUnit ? "selected" : "";
    return `<option value="${unit.value}" ${selected}>${unit.label}</option>`;
  }).join("");
}

function buildEntryPreview(entry) {
  const parts = [];

  if (entry?.displayName) parts.push(entry.displayName);
  if (entry?.summary?.bonus) parts.push(`Bonus: ${entry.summary.bonus}`);
  if (entry?.summary?.sub1) parts.push(`Effect: ${entry.summary.sub1}`);
  if (entry?.summary?.sub2) parts.push(`Detail: ${entry.summary.sub2}`);
  if (getTargetMode(entry)) parts.push(`Target Mode: ${getTargetMode(entry)}`);
  if (entry?.targeting?.aoeText) parts.push(`Targeting: ${entry.targeting.aoeText}`);

  return parts.join(" • ");
}

function buildDerivedDurationLabel(entry) {
  const amount = Number(entry?.duration?.amount ?? 0);
  const unit = normalizeDurationUnit(entry?.duration?.unit ?? "perm");

  if (unit === "perm") return "Derived duration: Permanent";
  return `Derived duration: ${amount} ${unit}`;
}

function parseDurationOverride(formData, entry) {
  const amountRaw = formData.get("durationAmount");
  const unitRaw = formData.get("durationUnit");

  const fallbackAmount = Number(entry?.duration?.amount ?? 0);
  const amount = Number(amountRaw);
  const safeAmount = Number.isFinite(amount) ? amount : fallbackAmount;
  const unit = normalizeDurationUnit(unitRaw ?? entry?.duration?.unit ?? "perm");

  if (unit === "perm") {
    return {
      amount: 0,
      unit: "perm"
    };
  }

  return {
    amount: Math.max(0, safeAmount),
    unit
  };
}

function parseSelectedTargetIds(formData, entry) {
  if (isSelfOnlyEntry(entry)) return [];

  if (isSingleTargetEntry(entry)) {
    const singleValue = String(formData.get("chosenTarget") ?? "").trim();
    return singleValue ? [singleValue] : [];
  }

  return formData.getAll("chosenTargets").map((value) => String(value)).filter(Boolean);
}

function buildTargetsHelpText(entry, actor) {
  const mode = getTargetMode(entry);
  const maxTargets = getMaxSelectableTargets(entry, actor);

  if (mode === "self") {
    return "This effect always applies to the caster.";
  }

  if (mode === "target") {
    return "Choose one target for this spell. If none is chosen here, the current user target will be used. If there is no user target, the effect falls back to self.";
  }

  if ((mode === "targets" || mode === "area") && Number.isFinite(maxTargets) && maxTargets > 1) {
    return `Choose up to ${maxTargets} targets for this spell. If none are chosen here, the current user targets will be used. If there are no user targets, the effect falls back to self.`;
  }

  if (mode === "targets" || mode === "area") {
    return "Choose one or more targets for this spell. If none are chosen here, the current user targets will be used. If there are no user targets, the effect falls back to self.";
  }

  return "If any are selected here, they will be used. Otherwise the current user targets will be used. If there are no user targets, the effect falls back to self.";
}

function buildTargetsFieldHtml(candidates, currentTargets, entry, actor) {
  if (isSelfOnlyEntry(entry)) return "";

  const singleTarget = isSingleTargetEntry(entry);
  const helpText = buildTargetsHelpText(entry, actor);

  if (singleTarget) {
    const optionsHtml = buildTargetOptionsHtml(candidates, currentTargets, { includeBlank: true });

    return `
      <div class="rmu-managed-effects-field" id="rmu-managed-effects-targets-wrapper">
        <label for="rmu-managed-effects-target-single">Chosen Target</label>
        <select
          id="rmu-managed-effects-target-single"
          name="chosenTarget"
          class="rmu-managed-effects-target-select"
        >
          ${optionsHtml}
        </select>
        <p class="notes">${escapeHtml(helpText)}</p>
      </div>
    `;
  }

  const optionsHtml = buildTargetOptionsHtml(candidates, currentTargets);
  const maxTargets = getMaxSelectableTargets(entry, actor);
  const targetListSize = Math.min(Math.max(6, candidates.length || 6), 12);
  const limitText = Number.isFinite(maxTargets) && maxTargets > 0
    ? ` data-max-targets="${maxTargets}"`
    : "";

  return `
    <div class="rmu-managed-effects-field" id="rmu-managed-effects-targets-wrapper">
      <label for="rmu-managed-effects-targets">Chosen Targets</label>
      <select
        id="rmu-managed-effects-targets"
        name="chosenTargets"
        multiple
        size="${targetListSize}"
        class="rmu-managed-effects-target-list"${limitText}
      >
        ${optionsHtml}
      </select>
      <p class="notes">${escapeHtml(helpText)}</p>
    </div>
  `;
}

function enforceMultiTargetLimit(root, entry, actor) {
  const select = root.querySelector("#rmu-managed-effects-targets");
  if (!select) return;

  const maxTargets = getMaxSelectableTargets(entry, actor);
  if (!Number.isFinite(maxTargets) || maxTargets <= 0) return;

  const syncLimit = () => {
    const selected = Array.from(select.selectedOptions);
    if (selected.length <= maxTargets) return;

    const keep = new Set(selected.slice(0, maxTargets).map((opt) => opt.value));
    for (const option of select.options) {
      option.selected = keep.has(option.value);
    }

    ui.notifications.warn(`This effect allows up to ${maxTargets} selected target${maxTargets === 1 ? "" : "s"}.`);
  };

  select.addEventListener("change", syncLimit);
}

function syncChosenTargetsUi(root, entry, casterToken) {
  const targetsHost = root.querySelector("#rmu-managed-effects-targets-host");
  const currentTargets = Array.from(game.user?.targets ?? []).filter((token) => token?.id !== casterToken?.id);

  if (!targetsHost) return;

  const candidates = getChosenTargetCandidates(casterToken, entry);
  targetsHost.innerHTML = buildTargetsFieldHtml(candidates, currentTargets, entry, casterToken.actor);
  enforceMultiTargetLimit(root, entry, casterToken.actor);
}

export async function openApplyEffectDialog({ casterToken, sourceType } = {}) {
  if (game.system.id !== "rmu") {
    ui.notifications.warn("RMU Managed Effects currently supports RMU only.");
    return;
  }

  if (!canvas?.ready) {
    ui.notifications.warn("The canvas must be ready before applying a managed effect.");
    return;
  }

  const token = resolveCasterToken(casterToken);
  if (!token?.actor) {
    ui.notifications.warn("Select a token with an actor first.");
    return;
  }

  const actor = token.actor;
  const selectedSourceType = sourceType ?? SOURCE_TYPES.SPELL;
  const provider = getEffectProvider(selectedSourceType);

  if (!provider) {
    ui.notifications.error(`No provider registered for source type "${selectedSourceType}".`);
    return;
  }

  const entries = await provider.getAvailableEntries({ actor, token });

  if (!entries.length) {
    ui.notifications.info(`No configured ${provider.label.toLowerCase()} found for ${actor.name}.`);
    return;
  }

  const selectedEntry = entries[0];
  const durationUnit = normalizeDurationUnit(selectedEntry?.duration?.unit ?? "perm");
  const durationAmount = Number(selectedEntry?.duration?.amount ?? 0);
  const initialCandidates = getChosenTargetCandidates(token, selectedEntry);
  const currentTargets = Array.from(game.user?.targets ?? []).filter((target) => target?.id !== token.id);

  const entryOptions = entries
    .map((entry, index) => provider.renderEntryOption(entry, index))
    .join("");

  const durationUnitOptions = buildDurationUnitOptions(durationUnit);
  const targetsFieldHtml = buildTargetsFieldHtml(initialCandidates, currentTargets, selectedEntry, actor);

  return foundry.applications.api.DialogV2.wait({
    window: { title: "Apply Effect" },
    content: `
      <form class="rmu-managed-effects-dialog">
        <div class="rmu-managed-effects-field">
          <label>Actor</label>
          <div class="rmu-managed-effects-static">${escapeHtml(actor.name)}</div>
        </div>

        <div class="rmu-managed-effects-field">
          <label>Source Type</label>
          <div class="rmu-managed-effects-static">${escapeHtml(provider.label)}</div>
        </div>

        <div class="rmu-managed-effects-field">
          <label for="rmu-managed-effects-entry">Effect Source</label>
          <select id="rmu-managed-effects-entry" name="entryIndex">
            ${entryOptions}
          </select>
          <p class="notes" id="rmu-managed-effects-preview">${escapeHtml(buildEntryPreview(selectedEntry))}</p>
        </div>

        <div id="rmu-managed-effects-targets-host">
          ${targetsFieldHtml}
        </div>

        <div class="rmu-managed-effects-field">
          <label for="rmu-managed-effects-duration-amount">Duration Override</label>
          <div class="rmu-managed-effects-duration-row">
            <input
              id="rmu-managed-effects-duration-amount"
              type="number"
              name="durationAmount"
              min="0"
              step="1"
              value="${Number.isFinite(durationAmount) ? durationAmount : 0}"
            />
            <select id="rmu-managed-effects-duration-unit" name="durationUnit">
              ${durationUnitOptions}
            </select>
          </div>
          <p class="notes" id="rmu-managed-effects-duration-notes">${escapeHtml(buildDerivedDurationLabel(selectedEntry))}</p>
        </div>
      </form>
    `,
    modal: true,
    buttons: [
      {
        action: "apply",
        label: "Apply",
        default: true,
        callback: async (_event, button, dialog) => {
          const form = button.form ?? dialog.element?.querySelector("form");
          const formData = new FormData(form);

          const index = Number(formData.get("entryIndex") ?? 0);
          const entry = entries[index] ?? null;

          if (!entry) {
            ui.notifications.warn("No effect entry selected.");
            return null;
          }

          const chosenTargetIds = parseSelectedTargetIds(formData, entry);
          const maxTargets = getMaxSelectableTargets(entry, actor);

          if (Number.isFinite(maxTargets) && maxTargets > 0 && chosenTargetIds.length > maxTargets) {
            ui.notifications.warn(`This effect allows up to ${maxTargets} selected target${maxTargets === 1 ? "" : "s"}.`);
            return null;
          }

          const durationOverride = parseDurationOverride(formData, entry);

          return applyEffectEntry(entry, {
            casterToken: token,
            overrides: {
              chosenTargetIds,
              duration: durationOverride
            }
          });
        }
      },
      {
        action: "cancel",
        label: "Cancel"
      }
    ],
    render: (_event, dialog) => {
      const root = dialog.element;
      if (!root) return;

      const entrySelect = root.querySelector("#rmu-managed-effects-entry");
      const preview = root.querySelector("#rmu-managed-effects-preview");
      const durationAmountInput = root.querySelector("#rmu-managed-effects-duration-amount");
      const durationUnitSelect = root.querySelector("#rmu-managed-effects-duration-unit");
      const durationNotes = root.querySelector("#rmu-managed-effects-duration-notes");

      const syncFormFromEntry = () => {
        const index = Number(entrySelect?.value ?? 0);
        const entry = entries[index] ?? entries[0];
        if (!entry) return;

        if (preview) preview.textContent = buildEntryPreview(entry);

        if (durationAmountInput) {
          durationAmountInput.value = String(Number(entry.duration?.amount ?? 0));
        }

        if (durationUnitSelect) {
          durationUnitSelect.value = normalizeDurationUnit(entry.duration?.unit ?? "perm");
        }

        if (durationNotes) {
          durationNotes.textContent = buildDerivedDurationLabel(entry);
        }

        syncChosenTargetsUi(root, entry, token);
      };

      entrySelect?.addEventListener("change", syncFormFromEntry);
      syncFormFromEntry();
    }
  });
}