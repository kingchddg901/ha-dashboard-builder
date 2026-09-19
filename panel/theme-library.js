/**
 * Saved themes, and themes shared as files - the library half. No DOM.
 *
 * Borrowed from Vacuum Agent's theme library (custom_components/eufy_vacuum/
 * themes/manager.py, export_theme / import_theme) and kept in its shape:
 *
 *   - an export is an envelope: { ok, kind, version, exported_at, theme: {
 *     name, source, tokens, author?, author_url? } }. `kind` is ours - a VA
 *     export has none and speaks a different vocabulary, so it is refused as
 *     nothing usable rather than half-imported;
 *   - an import is DATA, never code - the ingest gate below. Only this panel's
 *     own token keys are kept, each checked by its type: a colour must parse,
 *     a number is clamped to its range, a choice must be one of its options, and
 *     free text (fonts, shadows) is refused if it could escape a CSS value. What
 *     is dropped is reported, never silently lost;
 *   - a theme needs a name; a name already in the library gets " (imported)";
 *     an import never claims to be built in (source is community, generated or
 *     manual); author text is trimmed, and an author link must be http(s).
 *
 * A saved theme holds EVERY token - frame, colours, shape, light - so choosing
 * it later brings the whole look back, whatever the defaults are by then.
 */

import { parseColor } from "./theme-core.js";

export const EXPORT_KIND = "dashboard-builder-theme";
export const EXPORT_VERSION = 1;
export const USER_PREFIX = "user:";
const SOURCES = new Set(["community", "generated", "manual"]);
const NAME_MAX = 60;
const TEXT_MAX = 200;
/** What free text may not contain: anything that could end the value or fetch something. */
const UNSAFE_TEXT = /[;{}<>\\]|url\s*\(|expression\s*\(|@import|image-set\s*\(/i;

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

/* ---------------------------------------------------------------- library */

export function emptyLibrary() { return { v: 1, themes: {} }; }

/** Stored data -> a library; anything malformed is left out rather than trusted. */
export function readLibrary(raw) {
  const lib = emptyLibrary();
  const themes = raw && typeof raw === "object" && raw.themes && typeof raw.themes === "object" ? raw.themes : {};
  for (const [id, t] of Object.entries(themes)) {
    if (!/^t\d+$/.test(id) || !t || typeof t.name !== "string" || !t.tokens || typeof t.tokens !== "object") continue;
    lib.themes[id] = { ...t, id };
  }
  return lib;
}

/** Themes in the order they were made. */
export function listThemes(lib) {
  return Object.values(lib.themes).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

const nextId = (lib) => `t${Math.max(0, ...Object.keys(lib.themes).map((k) => Number(k.slice(1)))) + 1}`;

/** `name`, or `name (2)`, `name (3)`... - whichever is free among `taken`. */
export function freeName(name, taken) {
  const base = String(name || "").trim().slice(0, NAME_MAX) || "My theme";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
}

/** Add a theme; returns { lib, id }. The name is made unique among saved themes and `alsoTaken`. */
export function saveAs(lib, { name, tokens, source = "manual", author, author_url: url, now = new Date() }, { alsoTaken = [] } = {}) {
  const taken = new Set([...listThemes(lib).map((t) => t.name), ...alsoTaken]);
  const id = nextId(lib);
  const theme = { id, name: freeName(name, taken), source: SOURCES.has(source) ? source : "manual",
    tokens: { ...tokens }, saved_at: now.toISOString() };
  if (author) theme.author = author;
  if (url) theme.author_url = url;
  return { lib: { ...lib, themes: { ...lib.themes, [id]: theme } }, id };
}

/** Replace a saved theme's tokens (Save over the active theme). */
export function updateTheme(lib, id, tokens, { now = new Date() } = {}) {
  if (!lib.themes[id]) return lib;
  return { ...lib, themes: { ...lib.themes, [id]: { ...lib.themes[id], tokens: { ...tokens }, saved_at: now.toISOString() } } };
}

export function removeTheme(lib, id) {
  const themes = { ...lib.themes };
  delete themes[id];
  return { ...lib, themes };
}

/* ------------------------------------------------------------ share files */

/** A theme as a portable envelope - what Export copies and Download saves. */
export function exportTheme({ name, tokens, source = "manual", author, author_url: url }, { now = new Date() } = {}) {
  const theme = { name, source: SOURCES.has(source) ? source : "manual", tokens: { ...tokens } };
  if (author) theme.author = author;
  if (url) theme.author_url = url;
  return { ok: true, kind: EXPORT_KIND, version: EXPORT_VERSION, exported_at: now.toISOString(), theme };
}

/** One value through the gate for its token: [value, "ok" | "clamped"] or null to drop it. */
function admit(decl, value) {
  if (decl.type === "color") {
    const c = typeof value === "string" ? parseColor(value) : null;
    return c ? [hex(c), "ok"] : null;
  }
  if (decl.type === "number" || decl.type === "size") {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(n)) return null;
    const lo = Number.isFinite(decl.min) ? decl.min : -Infinity;
    const hi = Number.isFinite(decl.max) ? decl.max : Infinity;
    const v = Math.min(hi, Math.max(lo, n));
    return [v, v === n ? "ok" : "clamped"];
  }
  if (decl.type === "select") {
    const allowed = (decl.options || []).map((o) => (o && typeof o === "object" ? o.value : o));
    return allowed.includes(value) ? [value, "ok"] : null;
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s && s.length <= TEXT_MAX && !UNSAFE_TEXT.test(s) ? [s, "ok"] : null;
}

/**
 * The ingest gate. `payload` is an envelope, a bare theme, or the JSON text of
 * either. `tokens` are this panel's declarations; `names` the names already in
 * use. Returns { ok: true, theme, dropped, clamped } or { ok: false, reason }.
 */
export function ingestTheme(payload, { tokens, names = [] } = {}) {
  let data = payload;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return { ok: false, reason: "not_json" }; }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "invalid_payload" };
  if (has(data, "kind") && data.kind !== EXPORT_KIND) return { ok: false, reason: "wrong_kind" };
  const src = data.theme && typeof data.theme === "object" ? data.theme : data;
  const name = typeof src.name === "string" ? src.name.trim().slice(0, NAME_MAX) : "";
  if (!name) return { ok: false, reason: "missing_name" };
  if (!src.tokens || typeof src.tokens !== "object" || Array.isArray(src.tokens)) return { ok: false, reason: "invalid_tokens" };

  const byKey = new Map(tokens.map((t) => [t.key, t]));
  const clean = {};
  const dropped = [];
  const clamped = [];
  for (const [key, value] of Object.entries(src.tokens)) {
    const decl = byKey.get(key);
    const got = decl ? admit(decl, value) : null;
    if (!got) { dropped.push(key); continue; }
    clean[key] = got[0];
    if (got[1] === "clamped") clamped.push(key);
  }
  if (!Object.keys(clean).length) return { ok: false, reason: "nothing_usable", dropped: dropped.sort() };

  const taken = new Set(names);
  const theme = { name: taken.has(name) ? freeName(`${name} (imported)`, taken) : name,
    source: SOURCES.has(String(src.source || "").toLowerCase()) ? String(src.source).toLowerCase() : "manual",
    tokens: clean };
  if (typeof src.author === "string" && src.author.trim()) theme.author = src.author.trim().slice(0, TEXT_MAX);
  if (typeof src.author_url === "string" && /^https?:\/\/\S+$/i.test(src.author_url.trim())) {
    theme.author_url = src.author_url.trim().slice(0, TEXT_MAX);
  }
  return { ok: true, theme, dropped: dropped.sort(), clamped: clamped.sort() };
}

/** A file name for a theme's download. */
export function fileNameFor(name) {
  const slug = String(name || "theme").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "theme";
  return `${slug}.dashboard-theme.json`;
}
