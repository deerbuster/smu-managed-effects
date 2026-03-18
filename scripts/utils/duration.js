import { parseNumber } from "./common.js";

export function normalizeDurationUnit(unit) {
  const u = String(unit ?? "").trim().toLowerCase();
  if (!u) return "perm";

  if (["round", "rounds", "rnd", "rnds"].includes(u)) return "rounds";
  if (["minute", "minutes", "min", "mins"].includes(u)) return "minutes";
  if (["hour", "hours", "hr", "hrs"].includes(u)) return "hours";
  if (["day", "days"].includes(u)) return "days";
  if (["perm", "permanent"].includes(u)) return "perm";

  return u;
}

export function isPermanentDuration(duration) {
  return normalizeDurationUnit(duration?.unit) === "perm";
}

export function cloneDuration(duration) {
  return {
    amount: parseNumber(duration?.amount, 0),
    unit: normalizeDurationUnit(duration?.unit ?? "perm")
  };
}

export function secondsFromDuration(amount, unit) {
  const n = parseNumber(amount, 0);
  const normalized = normalizeDurationUnit(unit);

  if (!n || normalized === "perm") return null;

  switch (normalized) {
    case "rounds":
      return n * 6;
    case "minutes":
      return n * 60;
    case "hours":
      return n * 3600;
    case "days":
      return n * 86400;
    default:
      return null;
  }
}

export function formatDurationLabel(duration) {
  if (!duration) return "—";

  const unit = normalizeDurationUnit(duration.unit);
  const amount = parseNumber(duration.amount, 0);

  if (unit === "perm" || !amount) return "—";

  switch (unit) {
    case "rounds":
      return `${amount} round${amount === 1 ? "" : "s"}`;
    case "minutes":
      return `${amount} minute${amount === 1 ? "" : "s"}`;
    case "hours":
      return `${amount} hour${amount === 1 ? "" : "s"}`;
    case "days":
      return `${amount} day${amount === 1 ? "" : "s"}`;
    default:
      return `${amount} ${unit}`;
  }
}