import { MODULE_ID, SETTINGS } from "../constants.js";

function debugEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS.DEBUG);
  } catch {
    return false;
  }
}

export function createLogger(scope = "") {
  const prefix = scope ? `${MODULE_ID} | [${scope}]` : `${MODULE_ID} |`;

  return {
    debug(...args) {
      if (!debugEnabled()) return;
      console.log(prefix, ...args);
    },

    info(...args) {
      console.log(prefix, ...args);
    },

    warn(...args) {
      console.warn(prefix, ...args);
    },

    error(...args) {
      console.error(prefix, ...args);
    }
  };
}

export { debugEnabled };