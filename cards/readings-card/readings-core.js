/**
 * Readings - the half of the house that is looked at rather than driven.
 *
 * No DOM, no Lovelace. A state and its registry entry go in; a reading comes out
 * with a KIND, the value, and a one-line summary a status row can show as-is.
 *
 * Rules that shape it, each from the house's own data:
 *
 *   - `unavailable` and `unknown` are different facts and stay different. The
 *     grill's probes read unavailable whenever the grill is off; a sensor that
 *     has never reported reads unknown. Merging them loses the one thing a
 *     reader needs to know - is the device gone, or has it just not spoken.
 *   - Precision comes from the entity, never from here. The user's own
 *     display_precision first, then the integration's suggested one - 14 of
 *     this house's readings carry it - and only then a fallback. The pressure
 *     is stored as 1014.83294773739 and should read 1014.8.
 *   - A binary sensor's device class decides its words. A door is Open or
 *     Closed, motion is Detected or Clear, a leak is Wet or Dry; "on" is the
 *     wrong word for every one of them. And a LOCK is inverted - on means
 *     unlocked - which is exactly the kind of thing a generic on/off badge
 *     gets backwards.
 *   - Words are returned as KEYS with an English default, so a translation can
 *     replace the default without the core ever owning a language.
 */

/** off / on words per binary device class, as HA's own frontend words them. */
export const BINARY_WORDS = Object.freeze({
  door: ["Closed", "Open"], window: ["Closed", "Open"], garage_door: ["Closed", "Open"],
  opening: ["Closed", "Open"],
  motion: ["Clear", "Detected"], occupancy: ["Clear", "Detected"], presence: ["Away", "Home"],
  moisture: ["Dry", "Wet"], smoke: ["Clear", "Detected"], gas: ["Clear", "Detected"],
  carbon_monoxide: ["Clear", "Detected"], sound: ["Clear", "Detected"], vibration: ["Clear", "Detected"],
  problem: ["OK", "Problem"], safety: ["Safe", "Unsafe"], tamper: ["Clear", "Tampering detected"],
  battery: ["Normal", "Low"], battery_charging: ["Not charging", "Charging"],
  lock: ["Locked", "Unlocked"],                 // on = UNLOCKED, per HA
  plug: ["Unplugged", "Plugged in"], power: ["Off", "On"], connectivity: ["Disconnected", "Connected"],
  running: ["Not running", "Running"], update: ["Up to date", "Update available"],
  light: ["No light", "Light detected"], heat: ["Normal", "Hot"], cold: ["Normal", "Cold"],
  moving: ["Not moving", "Moving"],
});

/** Weather condition slugs HA uses, and their words. */
export const WEATHER_WORDS = Object.freeze({
  "clear-night": "Clear", cloudy: "Cloudy", exceptional: "Exceptional", fog: "Fog", hail: "Hail",
  lightning: "Lightning", "lightning-rainy": "Thunderstorm", partlycloudy: "Partly cloudy",
  pouring: "Pouring", rainy: "Rainy", snowy: "Snowy", "snowy-rainy": "Sleet", sunny: "Sunny",
  windy: "Windy", "windy-variant": "Windy",
});

const humanise = (slug) => {
  const s = String(slug).replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

/** Units that sit against the number rather than a space away from it. */
const TIGHT_UNITS = new Set(["%", "°"]);
const withUnit = (text, unit) => (!unit ? text : TIGHT_UNITS.has(unit) ? `${text}${unit}` : `${text} ${unit}`);

/**
 * How many decimals to show. The entity decides; the fallback exists only for a
 * reading nobody gave a precision to.
 */
export function precisionFor(value, entry = null) {
  if (Number.isInteger(entry?.display_precision)) return entry.display_precision;
  if (Number.isInteger(entry?.suggested_display_precision)) return entry.suggested_display_precision;
  if (Number.isInteger(value)) return 0;
  return Math.abs(value) >= 100 ? 0 : 1;
}

/** "in 13 h", "12 min ago", "just now". `now` is a Date, passed in for tests. */
export function relativeTime(date, now = new Date()) {
  const s = Math.round((date.getTime() - now.getTime()) / 1000);
  const a = Math.abs(s);
  if (a < 45) return "just now";
  const [n, u] = a < 3600 ? [Math.round(a / 60), "min"] : a < 86400 ? [Math.round(a / 3600), "h"]
    : [Math.round(a / 86400), "d"];
  return s > 0 ? `in ${n} ${u}` : `${n} ${u} ago`;
}

/**
 * One state -> one reading.
 *
 * `kind` is one of number, binary, timestamp, enum, weather, text, unavailable,
 * unknown. `text` is the display string; `key` is a translation key where the
 * words came from a vocabulary rather than from the device.
 */
export function readingOf(state, { entry = null, now = new Date() } = {}) {
  if (!state) return { kind: "unknown", text: "—", key: "reading.missing" };
  const id = state.entity_id || "";
  const domain = id.split(".")[0];
  const a = state.attributes || {};
  const dc = a.device_class ?? null;
  const raw = state.state;

  if (raw === "unavailable") return { kind: "unavailable", text: "Unavailable", key: "reading.unavailable", deviceClass: dc };
  if (raw === "unknown") return { kind: "unknown", text: "Unknown", key: "reading.unknown", deviceClass: dc };

  if (domain === "binary_sensor") {
    const on = raw === "on";
    const words = BINARY_WORDS[dc] || ["Off", "On"];
    return { kind: "binary", on, deviceClass: dc, text: words[on ? 1 : 0],
      key: `binary.${BINARY_WORDS[dc] ? dc : "generic"}.${on ? "on" : "off"}` };
  }

  if (domain === "weather") {
    const t = Number(a.temperature);
    return { kind: "weather", condition: raw, key: `weather.${raw}`,
      text: WEATHER_WORDS[raw] || humanise(raw),
      temperature: Number.isFinite(t) ? t : null, unit: a.temperature_unit ?? null };
  }

  if (dc === "timestamp") {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return { kind: "text", text: String(raw), value: raw };
    return { kind: "timestamp", date: d, text: relativeTime(d, now), key: "reading.timestamp" };
  }

  if (dc === "enum") {
    return { kind: "enum", value: raw, options: Array.isArray(a.options) ? a.options.slice() : [],
      text: humanise(raw), key: `enum.${raw}` };
  }

  const n = Number(raw);
  if (raw !== "" && raw !== null && Number.isFinite(n)) {
    const p = precisionFor(n, entry);
    const unit = a.unit_of_measurement ?? null;
    return { kind: "number", value: n, unit, deviceClass: dc, precision: p,
      stateClass: a.state_class ?? null, text: withUnit(n.toFixed(p), unit) };
  }

  return { kind: "text", value: raw, text: String(raw) };
}

/** The one line a phone status row shows. */
export function summary(reading) {
  if (!reading) return "—";
  if (reading.kind === "weather" && reading.temperature != null) {
    return `${reading.text} · ${withUnit(String(Math.round(reading.temperature)), reading.unit)}`;
  }
  return reading.text;
}

/* ----------------------------------------------------------------- robots
 *
 * The vacuums are an app with its own panel; a tile gets a glance and nothing
 * more. VA exposes the same three entities for every brand it drives, so one
 * definition covers all of them without knowing whose robot it is:
 *
 *   vacuum.<name>                              what it is doing
 *   binary_sensor.<name>_active_run_has_error  whether the run has an error
 *   sensor.<name>_active_run_error             which error, normalised
 *
 * The brands' own error sensors differ per brand and are never read here.
 */
const RUNNING = new Set(["cleaning", "returning"]);

export function robotGlance(states, name) {
  const vac = states?.[`vacuum.${name}`] || null;
  const flag = states?.[`binary_sensor.${name}_active_run_has_error`] || null;
  const which = states?.[`sensor.${name}_active_run_error`] || null;
  const friendly = vac?.attributes?.friendly_name || humanise(name);
  if (!vac || vac.state === "unavailable") {
    return { name: friendly, available: false, running: false, error: null, text: `${friendly} — unavailable` };
  }
  const hasError = flag?.state === "on" || vac.state === "error";
  const errorText = hasError ? (which && !["none", "unknown", "unavailable", ""].includes(which.state)
    ? humanise(which.state) : "error") : null;
  return {
    name: friendly, available: true, state: vac.state, running: RUNNING.has(vac.state),
    error: errorText,
    text: hasError ? `${friendly} — error: ${errorText}` : `${friendly} — ${humanise(vac.state).toLowerCase()}`,
  };
}
