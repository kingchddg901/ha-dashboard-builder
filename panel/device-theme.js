/**
 * One browser's own theme - the "this device only" lock. No DOM.
 *
 * Themes are otherwise shared: the library, your saved themes and the draft
 * live in Home Assistant user data, so two people on ONE HA account see one
 * theme. This file is the per-browser piece, for exactly that case - two
 * people, one account, two devices, two looks.
 *
 * Borrowed from Vacuum Agent's per-device theme selection (src/state/theme.js)
 * and kept in its shape: a mode plus a pinned theme, and a pin that survives a
 * library which has not loaded yet.
 *
 * The mode says where this browser's look comes from:
 *
 *   "account" - the HA user data setting, which everyone on the account shares.
 *               The default, and what the panel did before the lock existed.
 *   "device"  - `theme`, whatever the account says. Picking a theme while
 *               locked changes THIS browser and nothing else.
 *
 * `theme` is a theme name, "user:<id>" from the library, or **null**, which is
 * a real choice - Home Assistant's own theme - and never "nothing picked".
 *
 * WHERE VA AND THIS DIFFER: VA keeps only the SELECTION local. Here the draft
 * (your token changes) follows the lock too, because this panel puts the token
 * editor on the same screen: a locked device writing to the shared draft would
 * be editing something it cannot see, and overwriting the other person's work
 * to do it. So a locked browser drafts into its own storage, and the shared
 * draft is left exactly as it was for whoever is still following the account.
 *
 * VA calls the shared half "system". Ours is "account", because this panel
 * already offers HA's own theme by name and "system theme" would read as that.
 */

export const DEVICE_KEY = "dashboard_builder.device_theme";
/** A locked browser's own draft; the shared one stays in HA user data. */
export const DEVICE_TOKENS_KEY = "dashboard_builder.device_theme_tokens";
const MODES = new Set(["account", "device"]);

/** The pick every browser starts with: whatever the account says. */
export function accountPick() { return { mode: "account", theme: null }; }

/**
 * Stored text -> a pick. Anything malformed falls back to following the
 * account, which is the safe direction: a device that loses its pin shows
 * what the account shows, rather than a theme nobody chose.
 */
export function readPick(raw) {
  if (typeof raw !== "string" || !raw) return accountPick();
  let data;
  try { data = JSON.parse(raw); } catch { return accountPick(); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return accountPick();
  if (!MODES.has(data.mode)) return accountPick();
  const theme = typeof data.theme === "string" ? data.theme : null;
  return { mode: data.mode, theme };
}

export function writePick(pick) {
  return JSON.stringify({ mode: MODES.has(pick?.mode) ? pick.mode : "account",
    theme: typeof pick?.theme === "string" ? pick.theme : null });
}

/**
 * Which theme this browser shows, and whether its pin has gone stale.
 *
 * `known(name)` answers "is this theme still there?" - a pin can name a saved
 * theme that has since been deleted on another device. A stale pin is reported
 * so the caller can drop it, but ONLY once the library has loaded: before that
 * every saved theme looks deleted, and the first render would wipe a good pin.
 *
 * Returns { theme, locked, stale }.
 */
export function resolveTheme({ pick, accountTheme = null, known = () => true, libraryLoaded = true } = {}) {
  const p = pick || accountPick();
  if (p.mode === "device") {
    if (p.theme === null || known(p.theme)) return { theme: p.theme, locked: true, stale: false };
    if (!libraryLoaded) return { theme: p.theme, locked: true, stale: false };
    return { theme: accountTheme, locked: false, stale: true };
  }
  return { theme: accountTheme, locked: false, stale: false };
}

export function isLocked(pick) { return pick?.mode === "device"; }

/**
 * Stored text -> a draft (token key to value).
 *
 * Only flat text and numbers are kept. Every one of these ends up in a CSS
 * custom property, and storage is the one input a person can hand-edit, so an
 * object or an array here would paint "[object Object]" onto the panel.
 */
export function readDraft(raw) {
  if (typeof raw !== "string" || !raw) return {};
  let data;
  try { data = JSON.parse(raw); } catch { return {}; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

export function writeDraft(values) {
  return JSON.stringify(readDraft(JSON.stringify(values ?? {})));
}
