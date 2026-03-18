import { MODULE_ID, SETTINGS } from "./constants.js";
import { createApi } from "./api.js";
import { registerEffectProvider } from "./core/provider-registry.js";
import { registerEffectApplicationSocket } from "./core/effect-application-service.js";
import {
  spellProvider,
  clearSpellProviderCache,
  clearSpellProviderCacheForActor,
  preloadSpellProvider
} from "./providers/spell-provider.js";
import { createLogger } from "./utils/log.js";

const log = createLogger("main");

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.DEBUG, {
    name: "Enable Debug Logging",
    hint: "Write debug information to the browser console.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.SHOW_TOKEN_CONTROL, {
    name: "Show Token Control Button",
    hint: "Add an Apply Effect button to the Token controls.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
}

function registerModuleApi() {
  const module = game.modules.get(MODULE_ID);
  if (!module) {
    log.warn("Module record not found during init; API not attached.");
    return;
  }

  module.api = createApi();
  log.info("API attached", Object.keys(module.api ?? {}));
}

function registerProviders() {
  registerEffectProvider(spellProvider);
  log.info("Providers registered", ["spell"]);
}

function getTokenControlGroup(controls) {
  if (Array.isArray(controls)) {
    return controls.find((control) => control?.name === "token" || control?.name === "tokens") ?? null;
  }

  if (controls instanceof Map) {
    return Array.from(controls.values()).find((control) => control?.name === "token" || control?.name === "tokens") ?? null;
  }

  if (controls?.tokens?.name === "tokens" || controls?.tokens?.name === "token") {
    return controls.tokens;
  }

  return Object.values(controls ?? {}).find((control) => control?.name === "token" || control?.name === "tokens") ?? null;
}

function addTokenControlButton(controls) {
  if (!game.settings.get(MODULE_ID, SETTINGS.SHOW_TOKEN_CONTROL)) return;
  if (game.system.id !== "rmu") return;

  const tokenControls = getTokenControlGroup(controls);
  if (!tokenControls) {
    log.warn("Token controls not found in getSceneControlButtons hook payload.", controls);
    return;
  }

  const toolDef = {
    name: MODULE_ID,
    title: "Apply Effect",
    icon: "fa-solid fa-wand-magic-sparkles",
    button: true,
    visible: true,
    onClick: async () => {
      try {
        await game.modules.get(MODULE_ID)?.api?.openApplyEffectDialog();
      } catch (err) {
        log.error("Failed to open Apply Effect dialog from token control.", err);
        ui.notifications.error("Failed to open Apply Effect dialog. See console for details.");
      }
    }
  };

  if (Array.isArray(tokenControls.tools)) {
    if (!tokenControls.tools.some((tool) => tool?.name === MODULE_ID)) {
      tokenControls.tools.push(toolDef);
      log.debug("Token control button registered on array-shaped controls.");
    }
    return;
  }

  if (tokenControls.tools && typeof tokenControls.tools === "object") {
    if (!tokenControls.tools[MODULE_ID]) {
      tokenControls.tools[MODULE_ID] = {
        ...toolDef,
        onChange: toolDef.onClick
      };
      log.debug("Token control button registered on object-shaped controls.");
    }
    return;
  }

  log.warn("Token controls tools payload had an unsupported shape; button not registered.", tokenControls);
}

function invalidateCacheFromDocument(document) {
  const actor = document?.actor ?? document?.parent ?? document;
  if (actor?.documentName === "Actor") {
    clearSpellProviderCacheForActor(actor);
  } else {
    clearSpellProviderCache();
  }
}

Hooks.once("init", () => {
  log.info("init start");

  try {
    registerSettings();
    registerModuleApi();
    registerProviders();
  } catch (err) {
    log.error("Init failed.", err);
  }

  log.info("init complete");
});

Hooks.once("ready", async () => {
  try {
    registerEffectApplicationSocket();

    if (game.system.id === "rmu") {
      await preloadSpellProvider();
    }

    const module = game.modules.get(MODULE_ID);
    log.info("ready", {
      active: Boolean(module?.active),
      hasApi: Boolean(module?.api),
      apiKeys: module?.api ? Object.keys(module.api) : [],
      coreVersion: game.version,
      systemId: game.system.id,
      systemVersion: game.system.version
    });
  } catch (err) {
    log.error("Ready hook failed.", err);
  }
});

Hooks.on("getSceneControlButtons", (controls) => {
  try {
    addTokenControlButton(controls);
  } catch (err) {
    log.error("Error thrown in getSceneControlButtons handler.", err, controls);
  }
});

Hooks.on("updateActor", (actor) => invalidateCacheFromDocument(actor));
Hooks.on("createItem", (item) => invalidateCacheFromDocument(item));
Hooks.on("updateItem", (item) => invalidateCacheFromDocument(item));
Hooks.on("deleteItem", (item) => invalidateCacheFromDocument(item));
Hooks.on("canvasReady", () => clearSpellProviderCache());