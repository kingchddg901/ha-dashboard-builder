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
 * `mode` is the user's choice, and it outranks everything the integration says:
 *   - `auto`   believe percentage_step - notches when it divides 100 into a few
 *              positions, a slider otherwise;
 *   - `linear` a slider, whatever the integration claims;
 *   - `steps`  notches, `steps` of them - or, if no count was given, as many as
 *              the integration implies.
 * The audit found no way to derive the true count when an integration misreports
 * it - the same fan reads 16.667 locally and 1.0 through the cloud - so a human
 * gets the last word, and the source is always reported so it is clear who had it.
 * `declaredNotches` is the older spelling of `steps` and still works.
 */
function derivedNotches(step) {
  if (!(Number.isFinite(step) && step > NO_OPINION_STEP)) return null;
  const n = Math.round(100 / step);
  return n >= 2 && n <= 12 && Math.abs(100 / n - step) < 0.5 ? n : null;
}

export function speedControl(record, { declaredNotches = null, mode = "auto", steps = null } = {}) {
  const step = record?.capabilities?.percentage_step;
  const current = record?.raw?.percentage ?? null;
  const asked = steps || declaredNotches;
  let count = null;
  let source = "none";
  if (mode === "linear") {
    return { kind: "slider", current, step: 1, source: "declared" };
  }
  if (mode === "steps") {
    count = asked || derivedNotches(step);
    source = asked ? "declared" : count ? "percentage_step" : "none";
  } else if (asked) {
    count = asked;
    source = "declared";
  } else {
    count = derivedNotches(step);
    source = count ? "percentage_step" : "none";
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

/* ------------------------------------------------------------------ mixer
 *
 * A mixing desk, not a colour wheel. Each of R, G and B is a FADER - a drive
 * level from 0 to 100. The brightest fader sets how bright; the ratios between
 * them set the colour. Saturation is a handle onto the same three faders, and
 * power is a master over all of them.
 *
 * That model is honest for this fixture in a way a wheel is not: colour mode
 * normalises total drive to about one channel's worth, so "brightness = the top
 * fader x the master" matches what the firmware does, and three faders at 100
 * give white at the same brightness as one fader at 100 gives a pure colour.
 */

/** HSV hue (0-360) of an RGB triple, or null for a grey that has no hue. */
function hueOf(r, g, b) {
  const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
  if (d === 0) return null;
  let h;
  if (M === r) h = ((g - b) / d) % 6;
  else if (M === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Fully saturated, full-value RGB for a hue, each channel 0..1. */
function pureOf(h) {
  const c = 1, x = 1 - Math.abs(((h / 60) % 2) - 1);
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b];
}

/**
 * Faders -> the service call. Only the RATIOS reach HA as rgb_color (normalised so
 * the top channel is 255), because a light driven by hue and saturation cannot
 * tell R 40 from R 100 - the level belongs to brightness. So R 40 alone is the
 * same RED as R 100 alone, at 40 percent instead of 100.
 */
export function mixToCommand({ r = 0, g = 0, b = 0 } = {}, { power = 100 } = {}) {
  const M = Math.max(r, g, b);
  if (M <= 0 || power <= 0) return { off: true };
  const rgb_color = [r, g, b].map((c) => Math.round((c / M) * 255));
  const saturation = 1 - Math.min(r, g, b) / M;
  return {
    off: false,
    rgb_color,
    brightness_pct: Math.max(1, Math.round((M * power) / 100)),
    hue: hueOf(r, g, b),
    saturation,
  };
}

/**
 * Move the saturation handle: keep the hue and the top fader where they are, and
 * slide the other two toward the top (paler) or toward zero (purer).
 */
export function setSaturation({ r = 0, g = 0, b = 0 }, s) {
  const M = Math.max(r, g, b);
  const h = hueOf(r, g, b);
  if (M <= 0 || h == null) return { r, g, b };          // grey or dark: no hue to keep
  const sat = Math.max(0, Math.min(1, s));
  const [pr, pg, pb] = pureOf(h);
  const f = (p) => Math.round(M * (1 - sat * (1 - p)));
  return { r: f(pr), g: f(pg), b: f(pb) };
}

/**
 * The light's live colour -> fader positions, so the desk opens where the light
 * is. The top fader is parked at 100 and the master carries the brightness, which
 * keeps the faders about colour and the master about level.
 */
export function colorToMix(record) {
  const hs = record?.raw?.hs_color;
  const brightness = record?.raw?.brightness;
  const power = brightness == null ? 100 : Math.round(brightness / 2.55);
  if (!Array.isArray(hs)) return { r: 100, g: 100, b: 100, saturation: 0, power, known: false };
  const [h, s] = hs;
  const sat = Math.max(0, Math.min(1, s / 100));
  const [pr, pg, pb] = pureOf(((h % 360) + 360) % 360);
  const f = (p) => Math.round(100 * (1 - sat * (1 - p)));
  return { r: f(pr), g: f(pg), b: f(pb), saturation: sat, power, known: true };
}

/**
 * Below this the "colour" is mostly white made from RGB, which on this fixture is
 * about twelve times dimmer than the white emitters. A renderer should offer the
 * white-mode control instead of letting the desk produce a dim tinted white.
 */
export const RGB_WHITE_TRAP_SATURATION = 0.12;

/* ---------------------------------------------------------------- presets
 *
 * Eight slots per light, each holding either a white or a colour, plus its
 * brightness - a whole preset, not just a hue. They live in ONE input_text so
 * that they are shared by every device and every user, restored by HA across
 * restarts, and writable by a non-admin account. That puts the budget at 255
 * characters, so the encoding is compact:
 *
 *   t3367@31       white, 3367 K, 31 percent
 *   cFFA250@100    colour, rgb FF A2 50, 100 percent
 *   -              empty
 *
 * joined with "|", behind a "v1:" version so the format can change later without
 * misreading old data. Eight colour slots take 98 characters.
 */
export const PRESET_SLOTS = 8;
const PRESET_VERSION = "v1:";

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0").toUpperCase();
const clampPct = (b) => Math.max(1, Math.min(100, Math.round(Number(b))));

function encodeSlot(slot) {
  if (!slot) return "-";
  const b = clampPct(slot.b ?? 100);
  if (slot.mode === "temp" && Number.isFinite(slot.k)) return `t${Math.round(slot.k)}@${b}`;
  if (slot.mode === "colour" && Array.isArray(slot.rgb) && slot.rgb.length === 3) {
    return `c${slot.rgb.map(hex2).join("")}@${b}`;
  }
  return "-";
}

function decodeSlot(text) {
  const t = String(text || "").trim();
  let m = /^t(\d{3,5})@(\d{1,3})$/.exec(t);
  if (m) return { mode: "temp", k: Number(m[1]), b: clampPct(m[2]) };
  m = /^c([0-9A-Fa-f]{6})@(\d{1,3})$/.exec(t);
  if (m) {
    const h = m[1];
    return { mode: "colour", rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), b: clampPct(m[2]) };
  }
  return null;
}

/** Eight slots -> the stored string. Anything unrecognisable is stored as empty. */
export function encodeSlots(slots) {
  const eight = Array.from({ length: PRESET_SLOTS }, (_, i) => slots?.[i] ?? null);
  return PRESET_VERSION + eight.map(encodeSlot).join("|");
}

/**
 * The stored string -> eight slots. Never throws and never lets one bad slot
 * take the others with it: a helper edited by hand, truncated, or empty still
 * yields eight slots, with only the unreadable ones empty.
 */
export function decodeSlots(text) {
  const out = Array.from({ length: PRESET_SLOTS }, () => null);
  let body = String(text ?? "");
  if (body.startsWith(PRESET_VERSION)) body = body.slice(PRESET_VERSION.length);
  else if (/^v\d+:/.test(body)) return out;               // a newer format this code cannot read
  body.split("|").slice(0, PRESET_SLOTS).forEach((part, i) => { out[i] = decodeSlot(part); });
  return out;
}

/** A slot -> the light.turn_on data that recreates it. */
export function slotCommand(slot) {
  if (!slot) return null;
  if (slot.mode === "temp") return { color_temp_kelvin: slot.k, brightness_pct: slot.b };
  return { rgb_color: slot.rgb.slice(), brightness_pct: slot.b };
}

/**
 * What to save from the light as it is now.
 *
 * White comes from the light's own state. Colour comes from the desk's INTENT
 * when there is one - what was asked, not what the fixture reported - because
 * re-sending the asked colour reproduces the same state exactly, whereas
 * re-sending the reported one would run an already-corrected colour through the
 * correction a second time. With no desk in play, the light's live colour is used.
 */
/**
 * Where a light's preset slots live.
 *
 *   presets: input_text.x   -> that helper (the ceiling fan's, from before)
 *   presets: living_room    -> a named set, shared by every card that names it
 *   presets: false          -> no slots
 *   (nothing)               -> the light's OWN set, if it has a white or a colour
 *                              to save
 *
 * Own set by default because a colour is tuned per fixture: the goldenrod that
 * took the fan's green underdrive into account is the wrong recipe for another
 * bulb. Named and default sets live in Home Assistant's frontend storage under
 * `dashboard_builder.presets.<name>`, as the same encoded text a helper holds.
 * A light that can only switch or dim has nothing to put in a slot.
 */
export function presetStorage(config = {}, record = null) {
  const p = config.presets;
  if (p === false) return null;
  if (typeof p === "string" && p.startsWith("input_text.")) return { kind: "entity", entity_id: p };
  if (!config.light) return null;
  const modes = record?.capabilities?.supported_color_modes || [];
  const tunable = modes.some((m) => m !== "onoff" && m !== "brightness");
  const named = typeof p === "string" && p.trim() ? p : null;
  if (!tunable && !named) return null;
  const id = String(named || String(config.light).split(".")[1] || "")
    .toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "light";
  return { kind: "store", key: `dashboard_builder.presets.${id}` };
}

export function slotFromLight(record, { mix = null } = {}) {
  if (!record || record.state !== "on") return null;
  const raw = record.raw || {};
  const b = raw.brightness == null ? 100 : clampPct(raw.brightness / 2.55);
  // The desk wins when it is in play. Saving while looking at a mix means THAT
  // colour, and the light can still be reporting colour temperature - mid-tune,
  // or inside the echo window after a release - so checking the light's mode
  // first stored a white when a colour was on screen.
  if (mix) {
    const cmd = mixToCommand(mix, { power: mix.power });
    if (!cmd.off) return { mode: "colour", rgb: cmd.rgb_color, b: cmd.brightness_pct };
  }
  if (raw.color_mode === "color_temp" && Number.isFinite(raw.color_temp_kelvin)) {
    return { mode: "temp", k: Math.round(raw.color_temp_kelvin), b };
  }
  if (Array.isArray(raw.rgb_color)) return { mode: "colour", rgb: raw.rgb_color.slice(0, 3), b };
  return null;
}

/* ---------------------------------------------------------------- summaries
 *
 * One line per thing, for a phone status row: the smallest shape the control
 * data can take. The honesty rules do not relax because the space is small - a
 * remembered value is shown as a RETURN, never as live, and something unknown
 * stays unknown rather than being filled with a plausible guess.
 */

export function lightSummary(record, { remembered = null } = {}) {
  if (!record || record.state === "unavailable") return "unavailable";
  const level = levelControl(record, { remembered });
  if (!level.supported) return record.state === "on" ? "on" : "off";
  const look = appearanceControl(record, { remembered });
  const colour = look.mode === "temp" && look.kelvin != null ? `${Math.round(look.kelvin)} K`
    : look.mode === "color" && look.hs ? `hue ${Math.round(look.hs[0])}°` : null;
  if (level.state === "lit") return colour ? `${level.pct}% · ${colour}` : `${level.pct}%`;
  if (level.state === "off-restores") {
    return colour ? `off · returns to ${level.restore}%, ${colour}` : `off · returns to ${level.restore}%`;
  }
  return "off";
}

export function fanSummary(record, opts = {}) {
  if (!record || record.state === "unavailable") return "unavailable";
  const s = speedControl(record, opts);
  const on = record.state === "on";
  if (s.kind === "notches") {
    if (on) return `speed ${s.index} of ${s.count}`;
    return s.index ? `off · resumes at ${s.index}` : "off";
  }
  return on ? `${s.current ?? "—"}%` : "off";
}

/** "2 of 3 on" - from the members' own states, never the group's claim. */
export function groupSummary(memberRecords) {
  const known = memberRecords.filter((r) => r && r.state !== "unavailable" && r.state !== "unknown");
  const on = known.filter((r) => r.state === "on").length;
  const missing = memberRecords.length - known.length;
  return `${on} of ${memberRecords.length} on${missing ? ` · ${missing} unavailable` : ""}`;
}

/** Fan and light together, as one appliance. */
export function applianceSummary({ fan = null, light = null, remembered = null, declaredNotches = null,
  mode = "auto", steps = null } = {}) {
  const parts = [];
  if (fan) parts.push(`fan ${fanSummary(fan, { declaredNotches, mode, steps })}`);
  if (light) parts.push(`light ${lightSummary(light, { remembered })}`);
  return parts.join(" · ") || "—";
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
 * WIDTH comes from the CARD, never the viewport: a card in a narrow column on a
 * wide screen is compact in every way that matters.
 *
 * HEIGHT comes from the WINDOW, and deliberately not from the card. A card's own
 * height is content-driven - it grows and the page scrolls - so measuring it
 * would feed the layout its own output. The window is the only real constraint
 * on vertical room.
 *
 * That split is ported from the vacuum-agent card, which learned it the hard way
 * (`src/state/viewport.js`, "THE HEIGHT RULE EXISTS BECAUSE THE WIDTH RULE WAS
 * WRONG ABOUT LANDSCAPE"): rotating a 390x844 phone gives 844x390, which clears
 * any width gate at the exact moment there is no height left. Here the symptom
 * was milder and the same shape - a phone in landscape kept a vertical notch
 * column, because the card was still only ~490px wide and width was never the
 * constraint.
 *
 * 500px of height clears a landscape phone (~390-430) without catching a normal
 * desktop window. A desktop window dragged shorter than that gets the horizontal
 * axis too, which is intended: it has no vertical room either.
 */
export const LAYOUT_BREAKPOINTS = { compact: 0, regular: 380, wide: 620 };
export const SHORT_MAX_HEIGHT = 500;

export function layoutFor(width) {
  if (!Number.isFinite(width)) return "regular";
  if (width >= LAYOUT_BREAKPOINTS.wide) return "wide";
  if (width >= LAYOUT_BREAKPOINTS.regular) return "regular";
  return "compact";
}

/**
 * Horizontal when the card is wide, and ALSO whenever the window is short -
 * a vertical column needs vertical room that a landscape phone does not have.
 * An unknown height keeps the width-only behaviour rather than guessing.
 *
 * Except a COMPACT card: two columns need width it does not have. Measured on a
 * landscape phone, where the panel's tiles are ~370px - the short window sent
 * the TV and fan cards side by side and their controls landed on each other. A
 * compact card stays one column and its tile scrolls.
 */
export function axisFor(layout, heightPx) {
  if (layout === "wide") return "horizontal";
  if (layout === "compact") return "vertical";
  if (Number.isFinite(heightPx) && heightPx < SHORT_MAX_HEIGHT) return "horizontal";
  return "vertical";
}
