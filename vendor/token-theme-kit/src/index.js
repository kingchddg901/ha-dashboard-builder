/**
 * token-theme-kit — public API barrel.
 *
 * The board + five primitive control types are all a basic user imports.
 * Studs (registerControlType / registerValidator / setAdapter) are on the kit
 * instance. Optional plugins (CVD, adapters) live under their own subpaths so
 * they cost nothing until imported.
 */

export { createThemeKit } from "./kit.js";

// escape hatches / advanced composition
export { createRegistry, humanize } from "./registry.js";
export { createControlTypeRegistry, BUILTIN_CONTROL_TYPES } from "./control-types.js";
export { createValidatorRegistry } from "./validators.js";
export { buildEditorModel, resolveValues } from "./editor-model.js";
export { computeVars, applyVars, createPreview } from "./apply.js";
// reset: remove overrides so tokens fall back through resolution (never write a default back)
export { resetValues, groupKeys, isOverridden } from "./reset.js";
export { parseColor, formatColor, luminance, contrast } from "./color.js";

// default client-side persistence adapter (stud #4 default; HA is a plugin)
export { localStorageAdapter } from "./adapters/local-storage.js";
