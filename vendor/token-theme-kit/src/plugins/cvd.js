/**
 * CVD (colorblind-safety) validator — an OPTIONAL plugin (stud #3).
 *
 * Nothing in the core imports this; the 99% never load it. Import it only if
 * you care, and register it:
 *   import { cvdValidator } from "token-theme-kit/cvd";
 *   kit.registerValidator(cvdValidator({ pairs: [{ fg: "text", bg: "surface-bg" }] }));
 *
 * This ships a real WCAG-contrast check over declared foreground/background
 * token pairs — the common, cheap 90% of "is this theme legible." The full
 * colorblind *simulation* (deuter/prot/trit) drops in behind this exact same
 * interface later; the point of Wave 0 is that the stud exists and works.
 */
import { parseColor, contrast } from "../color.js";

/**
 * @param {{pairs: Array<{fg:string, bg:string, label?:string, min?:number}>}} opts
 *   fg/bg are token keys; min is the required contrast ratio (default 4.5, WCAG AA text).
 */
export function cvdValidator({ pairs = [] } = {}) {
  return (values) => {
    const verdicts = [];
    for (const { fg, bg, label, min = 4.5 } of pairs) {
      const cfg = parseColor(values[fg]);
      const cbg = parseColor(values[bg]);
      if (!cfg || !cbg) continue;
      const ratio = contrast(cfg, cbg);
      if (ratio < min) {
        verdicts.push({
          key: fg,
          level: ratio < min * 0.66 ? "error" : "warn",
          message: `${label || `${fg} on ${bg}`}: contrast ${ratio.toFixed(2)}:1 (needs ${min}:1)`,
        });
      }
    }
    return verdicts;
  };
}
