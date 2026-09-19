/**
 * The clock's rules - no DOM, no Home Assistant.
 *
 * The time shown is HOME ASSISTANT's time zone (hass.config.time_zone), not the
 * viewing device's: a tablet left on another zone, or a phone that has
 * travelled, still shows the house's time. The instant comes from the device's
 * own clock; only the zone and the 12/24-hour choice come from HA.
 */

/**
 * HA's profile setting for the clock face: "12" and "24" are explicit;
 * "language" and "system" (and anything unknown) leave it to the locale.
 */
export function hour12For(timeFormat) {
  if (timeFormat === "12") return true;
  if (timeFormat === "24") return false;
  return undefined;
}

/**
 * One instant, as the clock face shows it in a given zone:
 * `{ time: "9:42", ampm: "PM" | "", seconds: "07", date: "Friday, September 18", zone: "PDT" }`.
 */
export function clockParts(epochMs, { timeZone, hour12, language = "en-US" } = {}) {
  const d = new Date(epochMs);
  const t = new Intl.DateTimeFormat(language, {
    timeZone, hour: "numeric", minute: "2-digit", second: "2-digit", hour12, timeZoneName: "short",
  }).formatToParts(d);
  const get = (type) => t.find((p) => p.type === type)?.value ?? "";
  const date = new Intl.DateTimeFormat(language, { timeZone, weekday: "long", month: "long", day: "numeric" }).format(d);
  return {
    time: `${get("hour")}:${get("minute")}`,
    ampm: get("dayPeriod"),
    seconds: get("second"),
    date,
    zone: get("timeZoneName"),
  };
}

/** Milliseconds until the next whole second or minute - so the face turns over on time. */
export function msToNextTick(epochMs, { seconds = false } = {}) {
  const unit = seconds ? 1000 : 60000;
  return unit - (epochMs % unit) || unit;
}
