/**
 * Color math — the only "real" computation the core needs.
 *
 * Pure and dependency-free: parse a CSS color to {r,g,b,a}, format it back,
 * and compute relative luminance / WCAG contrast. `applyTheme` uses the
 * formatter; validators (e.g. the optional CVD plugin) use contrast.
 *
 * This is a NORMAL brick — every consumer gets it. Nothing here knows what a
 * token, a theme, or Home Assistant is.
 */

/** Parse `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` or `rgb()/rgba()` → {r,g,b,a} | null. */
export function parseColor(input) {
  if (input == null) return null;
  const s = String(input).trim();

  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const int = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, a };
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const [r, g, b] = parts.map((p) => clampByte(parseFloat(p)));
    const a = parts[3] != null ? clamp01(parseFloat(parts[3])) : 1;
    return { r, g, b, a };
  }

  return null;
}

/** Format {r,g,b,a} → `#rrggbb` (opaque) or `rgba(r, g, b, a)` (translucent). */
export function formatColor(c) {
  if (!c) return "";
  const { r, g, b, a = 1 } = c;
  if (a >= 1) return "#" + [r, g, b].map((n) => clampByte(n).toString(16).padStart(2, "0")).join("");
  return `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${round(clamp01(a), 3)})`;
}

/** Relative luminance (WCAG 2.x), 0..1. */
export function luminance(c) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio between two colors, 1..21. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n || 0)));
const clamp01 = (n) => Math.max(0, Math.min(1, isNaN(n) ? 1 : n));
const round = (n, p) => Math.round(n * 10 ** p) / 10 ** p;
