/**
 * Editor model — the self-building editor, as pure data.
 *
 * Walk the registry, and for each token emit a CONTROL descriptor: its label,
 * its control type's input hint, the current value, and any validator verdicts.
 * The VIEW renders this however it likes (your stacked layout, a grid, tabs) —
 * the model has no opinion on arrangement. This is what makes the editor
 * "self-building": add a token, a control appears; register a control type, the
 * editor knows how to render it — all without touching editor code.
 *
 * Pure and DOM-free → unit-testable in Node.
 */

export function buildEditorModel({ registry, controlTypes, validators, values = {} }) {
  const resolved = resolveValues(registry.tokens, values, controlTypes);
  const verdicts = validators ? validators.run(resolved, { tokens: registry.tokens }) : [];
  const byKey = groupBy(verdicts, (v) => v.key);

  const groups = registry.groups.map((g) => ({
    id: g.id,
    label: g.label,
    controls: g.tokens.map((t) => {
      const ct = controlTypes.get(t.type); // unknown → `raw`, not color
      return {
        key: t.key,
        label: t.label,
        type: t.type,
        input: t.input || ct.input, // token can override the widget hint
        value: resolved[t.key],
        // pass-through widget metadata (options for selects, min/max/step for ranges)
        ...pickDefined(t, ["options", "min", "max", "step", "help"]),
        ...pickDefined(ct, ["min", "max", "step"]),
        verdicts: byKey.get(t.key) || [],
      };
    }),
  }));

  return { groups, verdicts, values: resolved };
}

/** Resolve every token to its effective value (override → default → type default). */
export function resolveValues(tokens, values, controlTypes) {
  const out = {};
  for (const [key, decl] of tokens) {
    const ct = controlTypes.get(decl.type); // unknown → `raw`, not color
    const raw = values?.[key] !== undefined ? values[key] : decl.default;
    out[key] = raw !== undefined ? (ct.coerce ? ct.coerce(raw) : raw) : ct.defaultValue;
  }
  return out;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (k == null) continue;
    (m.get(k) || m.set(k, []).get(k)).push(x);
  }
  return m;
}

function pickDefined(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}
