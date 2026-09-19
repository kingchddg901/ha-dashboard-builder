/**
 * Widget renderers — the "plugin for the plugins" (the VIEW-side extension point).
 *
 * The core's `registerControlType` (stud #2) teaches the kit the DATA/logic of a
 * token type — parse, toCss, default. But something still has to DRAW the control.
 * The core can't (it's framework-agnostic), so the drawing lives here: a registry
 * of `input`-type → renderer. The element ships renderers for the five primitives;
 * when a domain author adds a custom control type (e.g. `input: "texture-picker"`)
 * they register a matching widget here, and the self-building editor renders it
 * with zero editor-code changes.
 *
 * A renderer is `(control, ctx) => HTMLElement`:
 *   control = { key, label, type, input, value, options, min, max, step, verdicts }
 *   ctx     = { onChange(value), document }
 * Keep renderers dumb: build an input, reflect `value`, call `onChange` on change.
 * `document` is injected (not the global) so renderers are testable without a browser.
 */

function make(document, tag, props) {
  const node = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) node[k] = v;
  return node;
}

export const BUILTIN_WIDGETS = {
  color: (c, { onChange, document }) => {
    const i = make(document, "input", { type: "color", value: c.value ?? "#000000" });
    i.addEventListener("input", () => onChange(i.value));
    return i;
  },
  range: (c, { onChange, document }) => {
    const i = make(document, "input", { type: "range", value: c.value });
    i.min = c.min ?? 0;
    i.max = c.max ?? 1;
    i.step = c.step ?? 0.01;
    i.addEventListener("input", () => onChange(Number(i.value)));
    return i;
  },
  number: (c, { onChange, document }) => {
    const i = make(document, "input", { type: "number", value: c.value });
    if (c.min != null) i.min = c.min;
    if (c.max != null) i.max = c.max;
    if (c.step != null) i.step = c.step;
    i.addEventListener("input", () => onChange(Number(i.value)));
    return i;
  },
  select: (c, { onChange, document }) => {
    const s = make(document, "select");
    for (const o of c.options || []) {
      s.appendChild(make(document, "option", { value: o.value ?? o, textContent: o.label ?? o }));
    }
    s.value = c.value;
    s.addEventListener("change", () => onChange(s.value));
    return s;
  },
  checkbox: (c, { onChange, document }) => {
    const i = make(document, "input", { type: "checkbox", checked: !!c.value });
    i.addEventListener("change", () => onChange(i.checked));
    return i;
  },
  text: (c, { onChange, document }) => {
    const i = make(document, "input", { type: "text", value: c.value ?? "" });
    i.addEventListener("input", () => onChange(i.value));
    return i;
  },
};

/** The view-side widget registry: built-ins plus whatever a consumer snaps in. */
export function createWidgetRegistry() {
  const widgets = new Map(Object.entries(BUILTIN_WIDGETS));
  return {
    /** Register a renderer for an input type (the meta-plugin). Returns an unregister fn. */
    register(input, renderer) {
      if (!input || typeof renderer !== "function") {
        throw new Error(`widget "${input}" needs a (control, ctx) => element renderer`);
      }
      widgets.set(input, renderer);
      return () => widgets.delete(input);
    },
    /** Resolve a renderer; unknown input types fall back to a plain text field. */
    get: (input) => widgets.get(input) || widgets.get("text"),
    has: (input) => widgets.has(input),
    list: () => [...widgets.keys()],
  };
}
