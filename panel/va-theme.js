/**
 * A Vacuum Agent theme, read into this panel's tokens. No DOM.
 *
 * VA and this panel both let a person re-theme, and neither speaks the other's
 * vocabulary: VA has 342 CSS custom properties named `--evcc-*` for a card with
 * chips, a map, floor textures and a queue; this panel has about forty for an
 * LCARS shell with tiles, a rail and frames. Most of VA's tokens describe
 * surfaces this panel does not have, and most of this panel's shape tokens
 * describe a frame VA does not have.
 *
 * So this is a READING, not a conversion, and it says so:
 *
 *   - COLOUR is what crosses. VA's semantic colours - the base surface, card,
 *     accent, text, borders, and the three status colours - have obvious
 *     counterparts here, and they are the ones a person recognises as "their
 *     theme". They are listed in MAP below, one line each, deliberately short:
 *     a guessed mapping is worse than an absent one, because a wrong colour
 *     looks like a bug in the panel rather than a gap in the map.
 *   - VA's `colors` and `alpha` are two dicts, so a colour can be transparent
 *     without saying so in its own value. A token here is a flat value painted
 *     onto a surface, so a colour with alpha is FLATTENED over VA's own base
 *     surface (or black when it has none) and reported as flattened. Reading
 *     the colour and ignoring its alpha would silently lighten every surface.
 *   - SHAPE mostly does not cross. VA's four radii are read, because they are
 *     real and they land somewhere sensible; its textures, shadows, motion,
 *     spacing and every card-specific surface do not, and are reported as left
 *     behind rather than dropped in silence.
 *   - The FRAME is never set. A frame is this panel's structure, and nothing in
 *     a VA theme knows about it, so a read theme wears whichever frame the
 *     panel is already on.
 *
 * What comes out is a plain `{ name, tokens }` for `saveAs`, plus a report of
 * what landed, what was flattened, and what was left behind.
 */

import { parseColor } from "./theme-core.js";

/** VA's key -> ours. Colour first, then the four radii; nothing else is guessed. */
export const MAP = Object.freeze({
  // the ground and the words on it
  "--evcc-surface-base": "background",
  "--evcc-text-primary": "background-text",
  // the panel's own furniture: VA's panel surface is the closest thing to the rail
  "--evcc-surface-panel": "ui-primary",
  "--evcc-text-strong": "ui-primary-text",
  "--evcc-surface-raised": "ui-secondary",
  "--evcc-text-secondary": "ui-secondary-text",
  "--evcc-surface-subtle": "ui-quaternary",
  "--evcc-text-muted": "ui-quaternary-text",
  // what the eye goes to
  "--evcc-accent": "ui-accent",
  "--evcc-text-on-accent": "ui-accent-text",
  "--evcc-accent-soft": "ui-tertiary",
  // a tile and its edge
  "--evcc-surface-card": "tile-surface",
  "--evcc-border-default": "tile-border",
  "--evcc-surface-action": "card-button",
  // the three the panel lifts to a contrast floor of its own
  "--evcc-color-error": "error",
  "--evcc-surface-warning": "warning",
  "--evcc-surface-success": "success",
  // shape: VA has no frame, but it does have these four
  "--evcc-radius-panel": "outer-radius",
  "--evcc-radius-inner": "inner-radius",
  "--evcc-radius-card": "tile-radius",
  "--evcc-radius-chip": "control-radius",
  "--evcc-font-family": "font",
});

const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** `12px`, `12`, `0.5rem` -> a number this panel's size tokens can hold. */
function toNumber(value) {
  const m = /^\s*(-?\d*\.?\d+)\s*(px|rem|em)?\s*$/.exec(String(value ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === "rem" || m[2] === "em" ? Math.round(n * 16) : n;
}

/**
 * The alpha a colour carries in its own value, or 1.
 *
 * `parseColor` returns three components on purpose - the panel paints solid
 * tokens - so it drops `#rgba`, `#rrggbbaa` and `rgba()`'s alpha on the floor.
 * Reading it here rather than changing that keeps the panel's own painting
 * untouched, and this is the one place that needs it.
 */
export function alphaOf(value) {
  const s = String(value ?? "").trim();
  let m = /^#[0-9a-f]{3}([0-9a-f])$/i.exec(s);
  if (m) return parseInt(m[1] + m[1], 16) / 255;
  m = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(s);
  if (m) return parseInt(m[1], 16) / 255;
  m = /^rgba?\(\s*\d+[ ,]+\d+[ ,]+\d+[ ,/]+\s*(\d*\.?\d+)\s*%?\s*\)$/i.exec(s);
  if (m) return Math.min(1, Number(m[1]) > 1 ? Number(m[1]) / 100 : Number(m[1]));
  return 1;
}

/** A colour over a background, at `a` (0..1). VA keeps the two apart; a token cannot. */
export function flatten(colour, a, over) {
  const c = parseColor(colour);
  if (!c) return null;
  const alpha = typeof a === "number" && a >= 0 && a <= 1 ? a : alphaOf(colour);
  if (!(alpha < 1)) return toHex(c);
  const bg = parseColor(over) || [0, 0, 0];
  return toHex([0, 1, 2].map((i) => c[i] * alpha + bg[i] * (1 - alpha)));
}

/**
 * Read a VA export (or the theme inside one, or its JSON text).
 *
 * Returns `{ ok: true, theme: { name, tokens }, landed, flattened, leftBehind }`
 * or `{ ok: false, reason }`. `tokens` is declared by the caller, so only keys
 * this panel actually has can come out.
 */
export function readVaTheme(payload, { tokens = [] } = {}) {
  let data = payload;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return { ok: false, reason: "not_json" }; }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "invalid_payload" };
  const src = data.theme && typeof data.theme === "object" ? data.theme : data;
  const colors = src.colors && typeof src.colors === "object" ? src.colors : null;
  const vaTokens = src.tokens && typeof src.tokens === "object" ? src.tokens : null;
  if (!colors && !vaTokens) return { ok: false, reason: "not_a_va_theme" };
  const all = { ...(vaTokens || {}), ...(colors || {}) };
  if (!Object.keys(all).some((k) => k.startsWith("--evcc-"))) return { ok: false, reason: "not_a_va_theme" };

  const alpha = src.alpha && typeof src.alpha === "object" ? src.alpha : {};
  const base = colors?.["--evcc-surface-base"] || "#000000";
  const decl = new Map(tokens.map((t) => [t.key, t]));

  const out = {};
  const landed = [];
  const flattened = [];
  const leftBehind = [];

  for (const [vaKey, value] of Object.entries(all)) {
    const ours = MAP[vaKey];
    const d = ours ? decl.get(ours) : null;
    if (!d) { leftBehind.push(vaKey); continue; }
    if (d.type === "color") {
      const flat = flatten(value, alpha[vaKey], base);
      if (!flat) { leftBehind.push(vaKey); continue; }
      out[ours] = flat;
      landed.push(ours);
      const a = alpha[vaKey];
      if ((typeof a === "number" && a < 1) || alphaOf(value) < 1) flattened.push(ours);
      continue;
    }
    if (d.type === "number" || d.type === "size") {
      const n = toNumber(value);
      if (n === null) { leftBehind.push(vaKey); continue; }
      const lo = Number.isFinite(d.min) ? d.min : -Infinity;
      const hi = Number.isFinite(d.max) ? d.max : Infinity;
      out[ours] = Math.min(hi, Math.max(lo, n));
      landed.push(ours);
      continue;
    }
    const text = String(value ?? "").trim();
    if (!text || /[;{}<>\\]|url\s*\(|expression\s*\(|@import/i.test(text)) { leftBehind.push(vaKey); continue; }
    out[ours] = text;
    landed.push(ours);
  }

  if (!landed.length) return { ok: false, reason: "nothing_usable", leftBehind: leftBehind.sort() };
  const name = typeof src.name === "string" && src.name.trim() ? src.name.trim().slice(0, 60) : "A Vacuum Agent theme";
  return { ok: true, theme: { name, tokens: out }, landed: landed.sort(),
    flattened: [...new Set(flattened)].sort(), leftBehind: leftBehind.sort() };
}
