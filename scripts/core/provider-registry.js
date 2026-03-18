const providers = new Map();

/**
 * Register a source provider.
 * @param {object} provider
 */
export function registerEffectProvider(provider) {
  if (!provider?.id) throw new Error("Provider must have an id.");
  providers.set(provider.id, provider);
}

/**
 * Get one provider by id.
 * @param {string} id
 * @returns {object|null}
 */
export function getEffectProvider(id) {
  return providers.get(id) ?? null;
}

/**
 * Get all registered providers.
 * @returns {object[]}
 */
export function getEffectProviders() {
  return Array.from(providers.values());
}