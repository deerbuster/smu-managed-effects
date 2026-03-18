import { openApplyEffectDialog } from "./ui/apply-effect-dialog.js";

export function createApi() {
  return {
    async openApplyEffectDialog(options = {}) {
      return openApplyEffectDialog(options);
    },

    async openSpellEffectsDialog(options = {}) {
      return openApplyEffectDialog({ sourceType: "spell", ...options });
    }
  };
}