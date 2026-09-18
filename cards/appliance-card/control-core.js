/**
 * Level 2 — turning what a thing can do into what the screen should offer.
 *
 * No DOM, no Lovelace. Takes the records level 1 produces (../builder-debug-card/
 * capability-core.js) and answers three questions per control: what KIND it is,
 * what VALUES it accepts, and what it should read as when the thing is off.
 *
 * The rules come from measuring one house — ../../docs/ha-hint-audit.md — and the
 * three that shape this file:
 *
 *   - `percentage_step` says whether a fan is notched or continuous, and it is the
 *     INTEGRATION's opinion. tuya_local reports 16.667 for the same fan the Tuya
 *     cloud reports 1.0 as, and the hardware has six speeds. A step of exactly 1
 *     is therefore treated as "no opinion", not as "a hundred positions".
 *   - A parent's capabilities are the UNION of its children. Offer the union,
 *     guarantee only the intersection, and never let the difference be silent.
 *   - Off means different things per domain. A fan keeps the percentage it will
 *     resume at; a light reports nothing at all, so its last level has to come
 *     from somewhere else (here, sensor.light_last_level).
 */

/** A step of exactly 1 is a claim of continuity that integrations make carelessly. */
const NO_OPINION_STEP = 1;

/**
 * How a fan's speed should be offered.
 *
 * `notches` when the step divides 100 into a small number of positions, `slider`
 * when it genuinely is continuous or nothing is known. `declared` always wins:
 * the audit found no way to derive the true count when an integration misreports
 * it, so a human gets to say.
 */
export function speedControl(record, { declaredNotches = null } = {}) {
  const step = record?.capabilities?.percentage_step;
  const current = record?.raw?.percentage ?? null;
  let count = null;
  let source = "none";
  if (declaredNotches) {
    count = declaredNotches;
    source = "declared";
  } else if (Number.isFinite(step) && step > NO_OPINION_STEP) {
    const n = Math.round(100 / step);
    if (n >= 2 && n <= 12 && Math.abs(100 / n - step) < 0.5) {
      count = n;
      source = "percentage_step";
    }
  }
  if (!count) {
    return { kind: "slider", current, step: Number.isFinite(step) ? step : 1, source };
  }
  // Notch n covers the band that HA's own ordered-list maths would map it to.
  const values = Array.from({ length: count }, (_, i) => Math.round(((i + 1) / count) * 100));
  const index = current == null ? 0 : values.findIndex((v, i) =>
    current <= v || i === count - 1) + 1;
  return { kind: "notches", count, values, current, index: current ? index : 0, source };
}

/**
 * Brightness, and what to show when the light is off.
 *
 * HA nulls brightness the moment a light goes off, so `restore` comes from the
 * remembered level rather than from the entity. `state` distinguishes the three
 * cases a renderer must draw differently: lit, off-with-a-known-level, and
 * off-knowing-nothing.
 */
export function levelControl(record, { remembered = null } = {}) {
  const on = record?.state === "on";
  const brightness = record?.raw?.brightness ?? null;
  const pct = brightness == null ? null : Math.round(brightness / 2.55);
  const restore = remembered?.pct ?? null;
  return {
    supported: Boolean(record?.capabilities?.supported_color_modes?.some(
      (m) => m !== "onoff")),
    on,
    pct: on ? pct : null,
    restore: on ? null : restore,
    state: on ? "lit" : restore == null ? "off-unknown" : "off-restores",
  };
}

/** Colour temperature limits, in kelvin, straight from the entity that will be driven. */
export function kelvinControl(record) {
  const lo = record?.capabilities?.min_color_temp_kelvin;
  const hi = record?.capabilities?.max_color_temp_kelvin;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  return { min: lo, max: hi, current: record?.raw?.color_temp_kelvin ?? null };
}

/**
 * What colour the light will come back as.
 *
 * HA nulls colour_temp_kelvin and hs_color at switch-off along with brightness,
 * so a control that falls back to the range minimum is claiming the light
 * returns at 2000 K when it returns at whatever it was. The remembered values
 * are the only source, and when there are none the honest answer is `unknown` -
 * never a plausible-looking default.
 */
export function appearanceControl(record, { remembered = null } = {}) {
  const on = record?.state === "on";
  const liveK = record?.raw?.color_temp_kelvin ?? null;
  const liveHs = record?.raw?.hs_color ?? null;
  if (on && liveK != null) return { mode: "temp", kelvin: liveK, hs: null, from: "live" };
  if (on && liveHs) return { mode: "color", kelvin: null, hs: liveHs, from: "live" };
  if (!on && remembered?.k != null) {
    return { mode: "temp", kelvin: remembered.k, hs: null, from: "remembered" };
  }
  if (!on && remembered?.hs) {
    return { mode: "color", kelvin: null, hs: remembered.hs, from: "remembered" };
  }
  return { mode: "unknown", kelvin: null, hs: null, from: on ? "live" : "none" };
}

/**
 * What a parent control can promise.
 *
 * `offered` is the union across members - keep offering it, most members honour
 * it. `guaranteed` is the intersection - the only thing true of all of them.
 * `partial` names the modes some members lack, so the gap can be shown rather
 * than discovered.
 */
export function composeCapabilities(records) {
  const sets = records.map((r) => new Set(r?.capabilities?.supported_color_modes || []));
  if (!sets.length) return { offered: [], guaranteed: [], partial: [] };
  const offered = [...new Set(sets.flatMap((s) => [...s]))].sort();
  const guaranteed = offered.filter((m) => sets.every((s) => s.has(m)));
  return { offered, guaranteed, partial: offered.filter((m) => !guaranteed.includes(m)) };
}

/**
 * Which way up a control should be drawn.
 *
 * Keyed on the CONTAINER's width, never the viewport: a card in a narrow column
 * on a wide screen is portrait in every way that matters. A vertical notch
 * column is right where there is height and no width, and useless the other way
 * round.
 */
export const LAYOUT_BREAKPOINTS = { compact: 0, regular: 380, wide: 620 };

export function layoutFor(width) {
  if (!Number.isFinite(width)) return "regular";
  if (width >= LAYOUT_BREAKPOINTS.wide) return "wide";
  if (width >= LAYOUT_BREAKPOINTS.regular) return "regular";
  return "compact";
}

/** Vertical where the card is tall and narrow, horizontal where it is wide. */
export function axisFor(layout) {
  return layout === "wide" ? "horizontal" : "vertical";
}
