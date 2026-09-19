/**
 * Validators — the "verdicts" stud (#3).
 *
 * A validator is a pure function of the resolved token values that returns
 * verdicts: [{ key?, level: "info"|"warn"|"error", message }]. The editor model
 * attaches them to controls so the view can show per-token feedback.
 *
 * The core ships ZERO validators — 99% of users never want one. CVD (colorblind
 * safety) is a plugin that implements this interface; so is anything else
 * (contrast floors, brand-lint). Snap in what you need, pay for nothing you don't.
 */

export function createValidatorRegistry() {
  const validators = new Set();
  return {
    /** stud #3 — register a validator. Returns an unregister fn. */
    register(fn) {
      if (typeof fn !== "function") throw new Error("a validator must be a function");
      validators.add(fn);
      return () => validators.delete(fn);
    },
    /** Run every validator; flatten + normalize the verdicts. */
    run(resolvedValues, context) {
      const out = [];
      for (const fn of validators) {
        let verdicts;
        try {
          verdicts = fn(resolvedValues, context) || [];
        } catch (err) {
          verdicts = [{ level: "error", message: `validator threw: ${err.message}` }];
        }
        for (const v of verdicts) out.push({ level: "warn", ...v });
      }
      return out;
    },
    get size() {
      return validators.size;
    },
  };
}
