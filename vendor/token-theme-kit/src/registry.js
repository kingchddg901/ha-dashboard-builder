/**
 * Token registry — the "declare a token in a group, it self-assembles" core.
 *
 * A GROUP is a plain object authored in its own file:
 *   { id: "surfaces", label: "Surfaces", tokens: [
 *       { key: "surface-bg", type: "color", default: "#101418" },
 *       { key: "surface-radius", type: "number", default: 12 },
 *   ]}
 *
 * Registering groups assembles a flat token map (key → declaration) plus the
 * grouped structure the editor renders from. No DOM, no events, no globals —
 * this instance IS the registry (killing the animal system let us drop the
 * dynamic document-event rebuild; static assembly is all that's left).
 */

export function createRegistry() {
  const groups = new Map(); // id → normalized group
  const listeners = new Set();

  const emit = () => listeners.forEach((fn) => fn());

  return {
    /** stud #1 — snap in a group of token declarations. Returns an unregister fn. */
    register(group) {
      if (!group || !group.id) throw new Error("a token group needs an { id }");
      groups.set(group.id, normalizeGroup(group));
      emit();
      return () => {
        groups.delete(group.id);
        emit();
      };
    },

    /** Grouped view (authoring/editor order). */
    get groups() {
      return [...groups.values()];
    },

    /** Flat key → declaration map (apply/lookup). */
    get tokens() {
      const flat = new Map();
      for (const g of groups.values()) for (const t of g.tokens) flat.set(t.key, t);
      return flat;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function normalizeGroup(group) {
  const tokens = (group.tokens || []).map((t) => {
    if (!t.key) throw new Error(`token in group "${group.id}" is missing a key`);
    return {
      type: "color",
      ...t,
      group: group.id,
      label: t.label ?? humanize(t.key),
    };
  });
  return { id: group.id, label: group.label ?? humanize(group.id), tokens };
}

export function humanize(key) {
  return String(key)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
