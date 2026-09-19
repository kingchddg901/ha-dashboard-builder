/**
 * Control types — how a token's VALUE is edited and how it becomes CSS.
 *
 * A control type is the Technic pin (stud #2): it teaches the self-building
 * editor how to render/parse ONE kind of token, without the core knowing what
 * that kind means. The core ships five NORMAL bricks; a consumer registers more
 * (a floor-texture picker, an animal selector, …) and the editor builds itself
 * around them automatically.
 *
 * A control type is data, not a component: it declares an `input` hint (which
 * the view maps to real UI) plus pure `parse`/`toCss` functions. Rendering the
 * actual widget is the VIEW's job — keep this framework-free.
 */

import { parseColor, formatColor } from "./color.js";

/** @typedef {{input:string, coerce?:Function, toCss:Function, defaultValue?:any}} ControlType */

/**
 * The primitives every UI needs. `toCss(value, token)` may read the token — a
 * token can declare `unit` (e.g. "px" | "rem" | "ms" | "%") to attach a unit.
 */
export const BUILTIN_CONTROL_TYPES = {
  color: {
    input: "color",
    coerce: (v) => (parseColor(v) ? formatColor(parseColor(v)) : v),
    toCss: (v) => String(v),
    defaultValue: "#000000",
  },
  alpha: {
    // 0..1 opacity, emitted as a bare number so it can drive rgba()/opacity.
    input: "range",
    min: 0, max: 1, step: 0.01,
    coerce: (v) => Math.max(0, Math.min(1, Number(v))),
    toCss: (v) => String(v),
    defaultValue: 1,
  },
  number: {
    // A RAW number — no unit assumed (z-index, line-height, opacity multiplier).
    // Declare `unit` on the token for px/rem/ms/etc.
    input: "number",
    coerce: (v) => Number(v),
    toCss: (v, token) => (token?.unit ? `${v}${token.unit}` : String(v)),
    defaultValue: 0,
  },
  size: {
    // A length — defaults to px; override with `unit` on the token.
    input: "number",
    coerce: (v) => Number(v),
    toCss: (v, token) => `${v}${token?.unit ?? "px"}`,
    defaultValue: 0,
  },
  select: {
    // options: [{value,label}] declared on the token
    input: "select",
    coerce: (v) => v,
    toCss: (v) => String(v),
    defaultValue: "",
  },
  toggle: {
    input: "checkbox",
    coerce: (v) => Boolean(v),
    toCss: (v) => (v ? "1" : "0"),
    defaultValue: false,
  },
  raw: {
    // Any raw CSS string, passed through untouched — font-family, box-shadow,
    // cubic-bezier(), transform, gradients. The value IS the CSS. This is the
    // catch-all for the string-valued tokens every real system has.
    input: "text",
    coerce: (v) => v,
    toCss: (v) => String(v),
    defaultValue: "",
  },
};

/** Registry of control types: built-ins plus whatever a consumer snaps in. */
export function createControlTypeRegistry() {
  const types = new Map(Object.entries(BUILTIN_CONTROL_TYPES));
  const warned = new Set();
  return {
    /** stud #2 — register a custom control type. */
    register(name, spec) {
      if (!name || typeof spec?.toCss !== "function") {
        throw new Error(`control type "${name}" needs at least a toCss(value) function`);
      }
      types.set(name, { input: "text", coerce: (v) => v, defaultValue: "", ...spec });
      return () => types.delete(name);
    },
    /**
     * Resolve a control type. An UNKNOWN type falls back to `raw` (a harmless
     * string field), NOT `color` — so a typo'd or un-registered type renders as
     * text instead of a misleading black color swatch. Warns once per name, to
     * match the registry's fail-loud-on-missing-key stance without throwing (a
     * theme shouldn't crash on one stray type).
     */
    get(name) {
      const t = types.get(name);
      if (t) return t;
      if (name != null && !warned.has(name)) {
        warned.add(name);
        // eslint-disable-next-line no-console
        console.warn(
          `[theme-kit] unknown control type "${name}" — falling back to "raw" (string). ` +
            `Register it via registerControlType() to type it correctly.`,
        );
      }
      return types.get("raw");
    },
    has: (name) => types.has(name),
    list: () => [...types.keys()],
  };
}
