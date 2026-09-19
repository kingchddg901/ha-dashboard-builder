/**
 * Themes for the panel - where each theme token's value comes from, which
 * variables the panel sets, and keeping status colours readable. No DOM.
 *
 * The tokens are ./token-groups.js (the mined LCARS vocabulary) and
 * ./panel-tokens.js (the panel's own: surfaces, corners, and the frame). Their
 * values come in layers, bottom to top:
 *
 *   1. the declared default - for a `byFrame` token, the active frame's
 *   2. Home Assistant's theme               - where it sets the variable
 *   3. a picked starting theme              - where it sets the token
 *   4. your own changes, from the theme tab
 *
 * 1-3 are the BASE: what the editor shows for a token you have not changed, and
 * what a reset puts back. The panel writes 3, 4, and the active frame's own
 * defaults onto itself; the rest reaches it through the cascade anyway. It maps Home Assistant's standard
 * variables onto the tokens, so every tile - and every pop-up a tile opens -
 * wears the result with no change to the cards.
 *
 * The one thing a theme is not trusted with: its status colours.
 * Measured on the mined set, 21 of the 24 themes carry one below 3:1
 * on their own black (LCARS Transporter's warning is #360000, 1.2:1). A status
 * that cannot be read is worse than one in the wrong shade, so those are lifted
 * toward the background's opposite until they reach 3:1, keeping their hue.
 */

import { TOKEN_GROUPS } from "./token-groups.js";
import { PANEL_GROUPS, FRAMES, NOT_DRAWN } from "./panel-tokens.js";
import { BUILTIN_CONTROL_TYPES } from "../vendor/token-theme-kit/src/control-types.js";
import { greebleArt } from "./cockpit-art.js";

/** Every theme token group, in editor order: the mined vocabulary, then the panel's own. */
export const THEME_GROUPS = Object.freeze([...TOKEN_GROUPS, ...PANEL_GROUPS]);

/** Every theme token, flat, in editor order. */
export const THEME_TOKENS = Object.freeze(THEME_GROUPS.flatMap((g) => g.tokens));

/** A frame id the panel can draw; anything else is the LCARS frame. */
export function frameFor(value) {
  return FRAMES.some((f) => f.value === value) ? value : "lcars";
}

/** The frame in force: your own choice, else the base's (picked theme, HA, default). */
export function activeFrame(base = {}, overrides = {}) {
  return frameFor(has(overrides, "frame") ? overrides.frame : base.frame);
}

export const STATUS_ROLES = Object.freeze(["success", "warning", "error"]);
export const MIN_STATUS_CONTRAST = 3;

/**
 * "#rgb", "#rrggbb", "rgb(r, g, b)" -> [r, g, b], else null. The alpha forms
 * ("#rgba", "#rrggbbaa", "rgba(...)") parse too, alpha dropped: themes write
 * opaque colours that way (LCARS Picard I uses "#E7432AFF").
 */
export function parseColor(c) {
  const s = String(c || "").trim();
  let m = /^#([0-9a-f]{3})[0-9a-f]?$/i.exec(s);
  if (m) return m[1].split("").map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map(Number);
  return null;
}

const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** WCAG relative luminance. */
export function luminance([r, g, b]) {
  const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two colours (1 to 21), or null if either is unreadable. */
export function contrast(a, b) {
  const x = parseColor(a); const y = parseColor(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

const toHsl = ([r, g, b]) => {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B); const min = Math.min(R, G, B); const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
};
const fromHsl = ([h, s, l]) => {
  if (s === 0) return [l, l, l].map((v) => v * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => v * 255);
};

/**
 * `color`, or the nearest colour of the same hue and saturation - only its
 * LIGHTNESS moved, up on a dark background, down on a light one - that reaches
 * `min` contrast. So a dark red stays a red rather than greying out. Unparseable
 * input is returned untouched - nothing is guessed.
 */
export function legibleOn(color, bg, min = MIN_STATUS_CONTRAST) {
  const c = parseColor(color); const b = parseColor(bg);
  if (!c || !b) return color;
  if (contrast(color, bg) >= min) return color;
  const [h, s, l] = toHsl(c);
  const up = luminance(b) < 0.5;
  for (let step = 1; step <= 50; step++) {
    const L = Math.min(1, Math.max(0, l + (up ? 0.02 : -0.02) * step));
    const candidate = hex(fromHsl([h, s, L]));
    if (contrast(candidate, bg) >= min) return candidate;
    if (L === 0 || L === 1) break;
  }
  return up ? "#ffffff" : "#000000";
}

/** The status colours of a theme, made readable on its background. */
export function legibleStatus(roles = {}) {
  const bg = roles.background || "#000000";
  const out = {};
  for (const r of STATUS_ROLES) if (roles[r]) out[r] = legibleOn(roles[r], bg);
  return out;
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

/**
 * A variable's CSS value read back as a token value, or undefined when there is
 * none. "35px" is 35 to a number token; a colour is normalised to #rrggbb so the
 * colour picker can show it, and one it cannot parse is kept as written.
 */
export function fromCss(token, css) {
  const s = String(css ?? "").trim();
  if (!s) return undefined;
  if (token.type === "number" || token.type === "size") {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : undefined;
  }
  if (token.type === "color") {
    const c = parseColor(s);
    return c ? hex(c) : s;
  }
  return s;
}

/**
 * Layers 1-3 for every token: the picked theme if it sets the token, else Home
 * Assistant's theme if it sets the variable, else the default - the active
 * frame's, for a `byFrame` token, and for a `follows` token the value of the
 * token it follows. `read(cssVar)` is what the page gives that variable ABOVE
 * the panel ("" for nothing) - read above it, because the panel's own writes
 * would answer back. Of `overrides` only `frame` is read: your frame decides
 * which frame's defaults the base carries.
 */
export function baseValues(tokens, { preset = null, read = () => "", overrides = {} } = {}) {
  const out = {};
  const pending = [];
  const layered = (t) => (preset && preset[t.key] != null ? preset[t.key] : fromCss(t, read(t.cssVar)));
  const frameToken = tokens.find((t) => t.key === "frame");
  const baseFrame = frameToken ? layered(frameToken) ?? frameToken.default : undefined;
  const frame = activeFrame({ frame: baseFrame }, overrides);
  for (const t of tokens) {
    const v = layered(t);
    if (v !== undefined) out[t.key] = v;
    else if (t.follows) pending.push(t);
    else out[t.key] = t.byFrame && has(t.byFrame, frame) ? t.byFrame[frame] : t.default;
  }
  for (const t of pending) out[t.key] = out[t.follows];
  return out;
}

/**
 * The token groups with each default replaced by the base. Registered on the
 * kit, the editor then shows what is on screen, and a reset - which deletes
 * your change - lands on the theme you started from, not on the mined one.
 */
export function groupsWithDefaults(groups, base = {}) {
  return groups.map((g) => ({
    ...g,
    tokens: g.tokens.map((t) => (has(base, t.key) ? { ...t, default: base[t.key] } : t)),
  }));
}

const toCss = (t, v) => (BUILTIN_CONTROL_TYPES[t.type] || BUILTIN_CONTROL_TYPES.raw).toCss(v, t);

/**
 * The variables the panel sets on itself: layers 3 and 4, plus the active
 * frame's own defaults - and nothing else. A token nobody chose is left unset
 * so Home Assistant's theme keeps showing through it - writing it would pin it
 * to today's value, and a later change to the HA theme would never arrive.
 * Last, the status floor: a status colour that would vanish on the background
 * is written readable, whoever chose it.
 */
export function paintVars(tokens, { base = {}, preset = null, overrides = {} } = {}) {
  const out = {};
  const frame = activeFrame(base, overrides);
  for (const t of tokens) {
    const own = has(overrides, t.key);
    const picked = !own && preset && preset[t.key] != null;
    const framed = !own && !picked && t.byFrame && has(t.byFrame, frame);
    if (!own && !picked && !framed) continue;
    out[t.cssVar] = toCss(t, own ? overrides[t.key] : picked ? preset[t.key] : t.byFrame[frame]);
  }
  const resolved = { ...base, ...overrides };
  for (const t of tokens) {
    if (!STATUS_ROLES.includes(t.key) || resolved[t.key] == null) continue;
    const shown = legibleOn(resolved[t.key], resolved.background);
    if (shown !== resolved[t.key]) out[t.cssVar] = shown;
  }
  return out;
}

/**
 * Generated art the active frame draws with, as CSS variables - today the
 * cockpit's greebles at the chosen density. A frame without generated art gets
 * none, so nothing is written for it.
 */
export function frameArtVars(base = {}, overrides = {}) {
  if (activeFrame(base, overrides) !== "cockpit") return {};
  const pct = has(overrides, "greeble-density") ? overrides["greeble-density"] : base["greeble-density"];
  const art = greebleArt((Number(pct) || 0) / 100);
  return { "--db-greeble-strip": art.strip, "--db-greeble-corner": art.corner, "--db-greeble-column": art.column };
}

/**
 * A token-theme-kit validator: tells you, on the control itself, when a status
 * colour will be shown lighter (or darker) than you chose, and why - otherwise
 * the editor would show one colour and the panel another.
 */
export function statusVerdicts(values = {}) {
  const out = [];
  for (const k of STATUS_ROLES) {
    const v = values[k];
    const shown = legibleOn(v, values.background);
    if (v && shown !== v) {
      out.push({ key: k, level: "warn",
        message: `${v} is ${contrast(v, values.background).toFixed(2)}:1 on the background, too faint to read - the panel shows ${shown}` });
    }
  }
  return out;
}

/**
 * A token-theme-kit validator: on each control the active frame does not draw
 * with, say so - a setting that changes nothing should not pass for one that
 * does. It reads the frame from the values it is given, so the notes follow the
 * Frame control as it changes. Marked, never hidden: a value you set stays in
 * view when a frame ignores it, and is still there when you switch back.
 */
export function drawnVerdicts(values = {}) {
  const frame = FRAMES.find((f) => f.value === frameFor(values.frame));
  const skips = new Set(frame?.skips || []);
  const out = [];
  for (const t of THEME_TOKENS) {
    if (NOT_DRAWN.includes(t.key)) out.push({ key: t.key, level: "info", message: "Not used by this panel yet" });
    else if (skips.has(t.key)) out.push({ key: t.key, level: "info", message: `Not used by the ${frame.label} frame` });
  }
  return out;
}

/**
 * Every "<name>-text" token paired with "<name>", for the kit's contrast
 * validator: the editor warns before text disappears into its own colour.
 */
export function textPairs(tokens) {
  const byKey = new Map(tokens.map((t) => [t.key, t]));
  return tokens
    .filter((t) => t.key.endsWith("-text") && byKey.has(t.key.slice(0, -5)))
    .map((t) => ({ fg: t.key, bg: t.key.slice(0, -5), label: `${t.label} on ${byKey.get(t.key.slice(0, -5)).label}` }));
}
