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
 * The pause between keys when tuning, in milliseconds.
 *
 * The SPACING decides whether the set gets the whole number. Tuning was measured
 * working through core `samsungtv`, whose websocket library waits 1 s after
 * every key (samsungtvws `key_press_delay=1`, which HA leaves at its default).
 * `samsungtv_smart` waits only 0.5 s between chained keys, and through it the set
 * stopped getting full channel numbers. So the default is the spacing that was
 * measured working.
 */
export const KEY_GAP_MS = 1000;

/**
 * Integrations that read a bare number inside a key chain as a PAUSE, and the
 * range they clamp it to. `samsungtv_smart` does (media_player.py,
 * `_async_send_keys`: 200-2000 ms). Core `samsungtv` does not - it would send
 * the number to the TV as a key - and spaces keys itself, so it gets plain keys.
 */
export const CHAIN_PAUSES = Object.freeze({ samsungtv_smart: Object.freeze({ min: 200, max: 2000 }) });

/**
 * The key sequence that tunes a channel: digits, then Enter.
 *
 * Exactly what the remote sends, and exactly what the vendor integration's own
 * `channel()` helper does. On an integration that takes pauses in the chain,
 * one goes between every key. The TV reports NOTHING back afterwards — its local
 * API is byte-identical before and after — so a caller may say "sent" and must
 * never say "on".
 */
export function tuneCommand(chno, { platform = null, gapMs = KEY_GAP_MS } = {}) {
  const keys = String(chno).split("").map((d) => "KEY_" + d).concat("KEY_ENTER");
  const range = CHAIN_PAUSES[platform];
  if (!range) return keys;
  const gap = String(Math.round(Math.min(range.max, Math.max(range.min, Number(gapMs) || KEY_GAP_MS))));
  return keys.flatMap((k, i) => (i ? [gap, k] : [k]));
}

/** Roughly how long a tune takes to finish sending, so "sending" lasts that long. */
export function tuneDuration(chno, { platform = null, gapMs = KEY_GAP_MS } = {}) {
  const gaps = String(chno).length;               // one after each digit, before Enter
  const per = CHAIN_PAUSES[platform] ? Number(gapMs) || KEY_GAP_MS : 1000;
  return gaps * per;
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

/* ---------------- search ---------------- */

/** Lower case with accents stripped, so "Pokémon" and "pokemon" compare equal. */
const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** The lineup's categories, largest first. Every channel carries exactly one. */
export function groupsOf(index) {
  const counts = new Map();
  for (const ch of Object.values(index)) {
    if (ch.group) counts.set(ch.group, (counts.get(ch.group) || 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Search the lineup.
 *
 * Every word of the query has to appear somewhere in the channel's name, its
 * category, or what is on now or next - so "court cam" finds the show and
 * "news" finds the category. A word that is all digits also matches a channel
 * NUMBER by prefix, so "18" finds 1833. Case and accents are ignored - nobody
 * types "Pokémon" on a phone. Name matches rank first, then number matches, then
 * everything else; ties go in channel order.
 *
 * Returns `{ results, total }` - `total` counts every match, `results` stops at
 * `limit`, so a caller can say how many it is not showing.
 */
export function searchChannels(index, { query = "", group = null, now = Date.now() / 1000, limit = 40 } = {}) {
  const q = fold(query).trim();
  const words = q ? q.split(/\s+/) : [];
  const hits = [];
  for (const [name, ch] of Object.entries(index)) {
    if (group && ch.group !== group) continue;
    const { cur, next } = airing(ch.programs || [], now);
    const lname = fold(name);
    const hay = `${lname} ${fold(ch.group)} ${fold(cur?.title)} ${fold(next?.title)}`;
    const num = String(ch.n);
    const ok = words.every((w) => hay.includes(w) || (/^\d+$/.test(w) && num.startsWith(w)));
    if (!ok) continue;
    const rank = !q ? 0 : lname.startsWith(q) ? 0 : lname.includes(q) ? 1
      : /^\d+$/.test(q) && num.startsWith(q) ? 2 : 3;
    hits.push({ name, n: ch.n, group: ch.group || null, cur, next, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.n - b.n);
  return { results: hits.slice(0, limit), total: hits.length };
}

/* ---------------- the saved list ----------------
   Channel NAMES, in the order the user keeps them (see indexLineup for why
   names). Pure list operations; where the list is stored is the card's job. */

/** Add a channel to the end, or take it out if it is already there. */
export function toggleSaved(list, name) {
  const cur = Array.isArray(list) ? list : [];
  return cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
}

/** Move a saved channel up (-1) or down (+1); at either end it stays put. */
export function moveSaved(list, name, delta) {
  const cur = Array.isArray(list) ? list.slice() : [];
  const i = cur.indexOf(name);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cur.length) return cur;
  [cur[i], cur[j]] = [cur[j], cur[i]];
  return cur;
}

/** The HA storage key for a named list. One list per user unless the card names another. */
export function savedKey(list = "default") {
  const id = String(list || "default").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "default";
  return `samsung_tvplus.saved.${id}`;
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
