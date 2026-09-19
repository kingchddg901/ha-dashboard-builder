/**
 * localStorage adapter — the zero-install default (stud #4).
 *
 * Themes persist per-browser with no integration required, which is the easy
 * on-ramp: a card dev imports the JS and theming just works. The richer
 * HA-`Store`-backed adapter (cross-device sync) is a separate plugin that
 * implements this same { load, save } shape.
 */
export function localStorageAdapter(storeKey = "theme-kit:values", storage = globalThis.localStorage) {
  return {
    async load() {
      try {
        return JSON.parse(storage?.getItem(storeKey) || "null") || {};
      } catch {
        return {};
      }
    },
    async save(values) {
      try {
        storage?.setItem(storeKey, JSON.stringify(values || {}));
      } catch {
        /* quota / unavailable — non-fatal for a theming layer */
      }
    },
  };
}
