/**
 * Samsung TV Plus — the core.
 *
 * No DOM, no Home Assistant, no Lovelace. Everything here is about channels and
 * time, so it can sit behind a Lovelace card today and a dashboard renderer
 * later without either shape leaking into it.
 *
 * The rules below came from measuring a real set on 2026-09-15 — the reasoning
 * is in ../../docs/samsung-tv-local-control.md.
 */

export const LINEUP_URL = "https://i.mjh.nz/SamsungTVPlus/.channels.json";
export const REGIONS = ["us", "ca", "gb", "de", "fr", "es", "it", "at", "ch", "in", "kr"];
export const DEFAULT_MAX_AGE = 6 * 3600 * 1000;   // the file regenerates daily

/**
 * Shape the raw lineup into a name → channel index.
 *
 * Keyed by NAME on purpose. Samsung renumbers — the whole Kids block moved, so a
 * favourite stored as 3695 = Pokémon now tunes Kidoodle.TV. The number is looked
 * up at press time and is a cache, not the saved thing, so a renumber heals on
 * the next refresh instead of quietly tuning somewhere else.
 */
export function indexLineup(json, region = "us") {
  const list = json?.regions?.[region]?.channels;
  if (!list) throw new Error(`region '${region}' is not in the lineup`);
  const out = {};
  for (const c of Object.values(list)) {
    out[c.name] = { n: c.chno, group: c.group, logo: c.logo, programs: c.programs || [] };
  }
  return out;
}

/** What is on a channel now, and what is next. `now` is epoch SECONDS. */
export function airing(programs, now = Date.now() / 1000) {
  let cur = null, next = null;
  for (let i = 0; i < programs.length; i++) {
    const [ts, title] = programs[i];
    const end = programs[i + 1] ? programs[i + 1][0] : ts + 3600;
    if (ts <= now && now < end) cur = { title, start: ts, end };
    else if (ts > now && !next) next = { title, start: ts };
  }
  return { cur, next };
}

/**
 * The key sequence that tunes a channel: digits, then Enter.
 *
 * Exactly what the remote sends, and exactly what the vendor integration's own
 * `channel()` helper does. The TV reports NOTHING back afterwards — its local
 * API is byte-identical before and after — so a caller may say "sent" and must
 * never say "on".
 */
export function tuneCommand(chno) {
  return String(chno).split("").map((d) => "KEY_" + d).concat("KEY_ENTER");
}

/** Find what is airing right now across every channel, optionally filtered. */
export function whatsOn(index, { match = null, now = Date.now() / 1000 } = {}) {
  const hits = [];
  for (const [name, ch] of Object.entries(index)) {
    const { cur } = airing(ch.programs, now);
    if (!cur) continue;
    if (match && !`${name} ${cur.title}`.toLowerCase().includes(match.toLowerCase())) continue;
    hits.push({ name, chno: ch.n, group: ch.group, ...cur });
  }
  return hits.sort((a, b) => a.chno - b.chno);
}

/** Every programme that STARTS later — the raw material for a reminder. */
export function upcoming(index, { match = null, now = Date.now() / 1000 } = {}) {
  const out = [];
  for (const [name, ch] of Object.entries(index)) {
    for (const [ts, title] of ch.programs) {
      if (ts <= now) continue;
      if (match && !`${name} ${title}`.toLowerCase().includes(match.toLowerCase())) continue;
      out.push({ name, chno: ch.n, title, start: ts });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/* ---------------- storage ----------------
   A per-viewer convenience, never authoritative. Every access is guarded: a
   private window, a cleared profile or a full quota must degrade to a refetch,
   not an exception. */
const safeStorage = () => {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch (e) { return null; }
};

export function readCache(key, storage = safeStorage()) {
  try { return storage ? JSON.parse(storage.getItem(key)) : null; } catch (e) { return null; }
}

export function writeCache(key, value, storage = safeStorage()) {
  try { if (storage) storage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

/**
 * Load the lineup, preferring a fresh cache.
 *
 * Returns `{ index, fromCache, stale }`. A caller that gets `stale: true` has a
 * usable index AND should expect this to have refetched in the background — so
 * it can render immediately rather than waiting on 2 MB.
 */
export async function loadLineup({
  region = "us",
  cacheKey = "stvp-lineup-v1",
  maxAgeMs = DEFAULT_MAX_AGE,
  fetchImpl = typeof fetch !== "undefined" ? fetch : null,
  storage = safeStorage(),
  url = LINEUP_URL,
} = {}) {
  const cached = readCache(cacheKey, storage);
  const fresh = cached && Date.now() - (cached.__at || 0) < maxAgeMs;
  if (fresh) return { index: cached.index, fromCache: true, stale: false };

  if (!fetchImpl) {
    if (cached) return { index: cached.index, fromCache: true, stale: true };
    throw new Error("no fetch available and nothing cached");
  }

  try {
    const res = await fetchImpl(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`lineup fetch failed: ${res.status}`);
    const index = indexLineup(await res.json(), region);
    writeCache(cacheKey, { __at: Date.now(), index }, storage);
    return { index, fromCache: false, stale: false };
  } catch (e) {
    if (cached) return { index: cached.index, fromCache: true, stale: true };
    throw e;
  }
}
