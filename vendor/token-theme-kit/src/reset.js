/**
 * Reset — three tiers, one rule: a reset REMOVES an override, it never writes a default.
 *
 * Ported from the eufy_vacuum card's theme editor, which has run this shape in
 * production. Its per-token reset sends `null` for the key so the backend POPS it
 * from the draft bucket, and the value then falls out of normal resolution again.
 * It does not look the default up and store a copy of it.
 *
 * That distinction is load-bearing. Writing the default back LOOKS identical on
 * screen and is not the same thing: the key stays present, so it is still an
 * override, and the moment the declared default changes -- a new kit version, a
 * re-declared token -- every "reset" token is pinned to the OLD value with
 * nothing to show that it was ever reset. Deleting the key means resolution
 * re-derives it every time, which is what `resolveValues` already does:
 *
 *     values?.[key] !== undefined ? values[key] : decl.default
 *
 * So `delete` is the whole mechanism. There is no default-lookup here on purpose.
 *
 * Pure and DOM-free -> unit-testable in Node.
 */

/**
 * Remove overrides. Returns a NEW values object; the input is not mutated.
 *
 * @param {Record<string,any>} values   current overrides
 * @param {Iterable<string>|null} keys  keys to clear, or `null` for "all"
 * @returns {{values: Record<string,any>, changed: number}}
 *   `changed` counts keys that were actually present. Zero means the caller
 *   should do nothing -- no repaint, and above all no persist. The eufy card
 *   guards the same way (`if (!Object.keys(payload).length) return`), because a
 *   group reset over an untouched group would otherwise be a write that says a
 *   change happened when none did.
 */
export function resetValues(values, keys = null) {
  const src = values || {};

  if (keys === null) {
    return { values: {}, changed: Object.keys(src).length };
  }

  const next = { ...src };
  let changed = 0;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      delete next[key];
      changed++;
    }
  }
  return { values: next, changed };
}

/** Every token key declared in one editor-model group. */
export function groupKeys(model, groupId) {
  const group = model?.groups?.find((g) => g.id === groupId);
  return group ? group.controls.map((c) => c.key) : [];
}

/** Is this key currently overridden (i.e. is a reset meaningful)? */
export function isOverridden(values, key) {
  return Object.prototype.hasOwnProperty.call(values || {}, key);
}
