/**
 * createThemeKit — the board. Composes the registry and the four studs into one
 * instance, with zero domain knowledge.
 *
 * Minimum (a basic user):
 *   const kit = createThemeKit();
 *   kit.registerTokenGroup({ id: "brand", tokens: [{ key: "accent", default: "#3b82f6" }] });
 *   kit.applyTheme(document.body, { accent: "#e11d48" });   // done — CSS var set
 *
 * Limit (you): also registerControlType(...), registerValidator(cvd),
 * setAdapter(haStore), register a dozen domain groups. Same core.
 */

import { createRegistry } from "./registry.js";
import { createControlTypeRegistry } from "./control-types.js";
import { createValidatorRegistry } from "./validators.js";
import { computeVars, applyVars, createPreview } from "./apply.js";
import { buildEditorModel } from "./editor-model.js";

export function createThemeKit({ prefix = "--", adapter = null } = {}) {
  const registry = createRegistry();
  const controlTypes = createControlTypeRegistry();
  const validators = createValidatorRegistry();
  let store = adapter;

  return {
    prefix,
    registry,
    controlTypes,

    // ---- the four studs -------------------------------------------------
    /** #1 tokens */ registerTokenGroup: (g) => registry.register(g),
    /** #2 controls */ registerControlType: (name, spec) => controlTypes.register(name, spec),
    /** #3 verdicts */ registerValidator: (fn) => validators.register(fn),
    /** #4 storage  */ setAdapter(a) { store = a; return this; },

    // ---- reads ----------------------------------------------------------
    get tokens() { return registry.tokens; },
    get groups() { return registry.groups; },
    subscribe: (fn) => registry.subscribe(fn),

    // ---- apply / preview / model ---------------------------------------
    computeVars(values = {}) {
      return computeVars(registry.tokens, values, controlTypes, prefix);
    },
    applyTheme(el, values = {}) {
      applyVars(el, this.computeVars(values));
      return el;
    },
    preview(el, baseline = {}) {
      return createPreview(el, { tokens: () => registry.tokens, controlTypes, prefix, baseline });
    },
    editorModel(values = {}) {
      return buildEditorModel({ registry, controlTypes, validators, values });
    },

    // ---- persistence (adapter is a plugin; core assumes nothing) -------
    async load() {
      return store ? (await store.load()) || {} : {};
    },
    async save(values) {
      if (store) await store.save(values);
      return values;
    },
  };
}
