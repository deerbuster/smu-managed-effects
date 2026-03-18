export function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

export function unique(array) {
  return Array.from(new Set(array ?? []));
}

export function deepGet(obj, path) {
  return foundry.utils.getProperty(obj, path);
}

export function getActorLevel(actor, fallback = 1) {
  const candidatePaths = [
    "system.experience.level",
    "system.level",
    "system.levels.total",
    "system.advancement.level",
    "system.details.level"
  ];

  for (const path of candidatePaths) {
    const value = Number(foundry.utils.getProperty(actor, path));
    if (Number.isFinite(value) && value > 0) return value;
  }

  return fallback;
}