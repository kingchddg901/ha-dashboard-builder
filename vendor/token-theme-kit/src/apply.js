/**
 * Apply + preview — turning token VALUES into live CSS custom properties.
 *
 * This is the "no CSS for users" runtime: the consuming dev authors their CSS
 * once against `var(--token)`, and end users only ever change token *values*
 * through the editor. Nobody hand-edits CSS to re-theme.
 *
 * `computeVars` is pure (token decls + values → { cssVar: string }) so it is
 * unit-testable in Node with no DOM. `applyVars` is the thin DOM write.
 * `createPreview` scopes pending values to one element so any view gets live
 * preview — with commit/revert — for free.
 */

/**
 * Pure: resolve each token to its CSS custom-property name and string value.
 * @returns {Record<string,string>} e.g. { "--surface-bg": "#101418" }
 */
export function computeVars(tokens, values, controlTypes, prefix = "--") {
  const out = {};
  for (const [key, decl] of tokens) {
    const ct = controlTypes.get(decl.type); // unknown types fall back to `raw`, not color
    const value = pick(values?.[key], decl.default, ct.defaultValue);
    const cssVar = decl.cssVar || prefix + key;
    out[cssVar] = ct.toCss(value, decl); // decl lets toCss read a token's `unit`, etc.
  }
  return out;
}

/** Thin DOM write — set/remove the computed vars on an element's inline style. */
export function applyVars(el, varMap) {
  if (!el?.style) return;
  for (const [name, value] of Object.entries(varMap)) {
    if (value === "" || value == null) el.style.removeProperty(name);
    else el.style.setProperty(name, value);
  }
}

/**
 * Scoped live preview: apply *pending* values to one element, then commit
 * (persist as the new baseline) or revert (drop back to the baseline).
 */
export function createPreview(el, { tokens, controlTypes, prefix, baseline = {} }) {
  let committed = { ...baseline };
  const paint = (values) => applyVars(el, computeVars(tokens(), values, controlTypes, prefix));
  paint(committed);
  return {
    apply(pending) {
      paint({ ...committed, ...pending });
    },
    commit(pending = {}) {
      committed = { ...committed, ...pending };
      paint(committed);
      return { ...committed };
    },
    revert() {
      paint(committed);
      return { ...committed };
    },
    get values() {
      return { ...committed };
    },
  };
}

const pick = (...xs) => xs.find((x) => x !== undefined);
