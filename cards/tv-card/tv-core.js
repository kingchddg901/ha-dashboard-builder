/**
 * Level 2 for a television - what to offer, and what can honestly be shown back.
 *
 * No DOM, no Lovelace. The rules come from probing a real set, recorded in
 * ../../docs/samsung-tv-local-control.md and ../../docs/capability-test-2026-09-15.md:
 *
 *   - A remote key is fire-and-forget. The set gives no acknowledgement, so a key
 *     can be reported as SENT and never as done. The remote entity itself reports
 *     no capabilities at all (supported_features 0) - its vocabulary is declared.
 *   - Power, volume and mute come back on the media player, so those can show the
 *     live value rather than an assumption.
 *   - supported_features is a CLAIM. Two integrations on one set disagreed with
 *     their own flags in both directions, so a feature is offered because the
 *     entity says so and trusted only when its state confirms it.
 *   - With no app on screen the set cannot tell broadcast, HDMI, TV Plus and the
 *     home screen apart, and the integration reports that honestly as a source
 *     matching NONE of its own options ("TV/HDMI" against ["TV", "HDMI"]).
 */

import { decodeFeatures } from "../builder-debug-card/capability-core.js";

/**
 * The keys the set is known to accept - read off samsungtv_smart and exercised
 * against the set. Closed on purpose: a key outside it is refused rather than
 * sent, because a typo'd key is silently ignored by the TV and would read as a
 * control that does nothing.
 */
export const REMOTE_KEYS = Object.freeze([
  "POWER", "HOME", "MENU", "SOURCE", "GUIDE", "TOOLS", "INFO", "RETURN",
  "UP", "DOWN", "LEFT", "RIGHT", "ENTER",
  "CHUP", "CHDOWN", "CH_LIST", "VOLUP", "VOLDOWN", "MUTE",
  "RED", "GREEN", "YELLOW", "BLUE",
]);

/**
 * The d-pad in each platform's own words. The card asks for a LOGICAL key and
 * the core translates it for whichever integration owns the remote. A platform
 * with no table here gets no d-pad at all - sending a guessed key name to a
 * remote that ignores it would be a control that does nothing, silently.
 *
 * Android TV Remote names are the TV's own key codes without the KEYCODE_ prefix
 * (androidtvremote2's remotemessage.proto: DPAD_*, BACK, HOME, MENU, GUIDE), and
 * an unknown name is refused there with an error; core samsungtv uses the
 * same KEY_* codes as samsungtv_smart, so moving Big TV to core later is a
 * config change and not a code change.
 */
const SAMSUNG_KEYS = Object.freeze({ UP: "KEY_UP", DOWN: "KEY_DOWN", LEFT: "KEY_LEFT", RIGHT: "KEY_RIGHT",
  OK: "KEY_ENTER", BACK: "KEY_RETURN", HOME: "KEY_HOME", MENU: "KEY_MENU", GUIDE: "KEY_GUIDE" });
export const PLATFORM_KEYS = Object.freeze({
  samsungtv_smart: SAMSUNG_KEYS,
  samsungtv: SAMSUNG_KEYS,
  androidtv_remote: Object.freeze({ UP: "DPAD_UP", DOWN: "DPAD_DOWN", LEFT: "DPAD_LEFT", RIGHT: "DPAD_RIGHT",
    OK: "DPAD_CENTER", BACK: "BACK", HOME: "HOME", MENU: "MENU", GUIDE: "GUIDE" }),
});

export function platformKey(logical, platform) {
  return PLATFORM_KEYS[platform]?.[logical] ?? null;
}

/**
 * What `assumed_state` actually covers, per integration.
 *
 * HA's flag says "this state is assumed" and most integrations mean on/off. The
 * Android TV Remote integration sets it on the whole class while power and
 * volume both arrive from the TV by callback - what it cannot see is PLAYBACK,
 * since play and pause are bare key presses. Reading the flag literally would
 * grey out a power state that is observed. So the correction is declared here,
 * from the source, and every other platform keeps the conservative reading.
 */
export const ASSUMED_STATE_COVERS = Object.freeze({ androidtv_remote: "transport" });

/** A key name -> the string remote.send_command expects, or null if unknown. */
export function keyCommand(key) {
  const k = String(key || "").toUpperCase().replace(/^KEY_/, "");
  return REMOTE_KEYS.includes(k) ? `KEY_${k}` : null;
}

/**
 * What the current source means.
 *
 * `exact` - one of the entity's own options, safe to highlight.
 * `ambiguous` - a value that matches none of them, which on this set means "no
 *   app owns the screen, and the set cannot say which of the rest it is". Nothing
 *   is highlighted; guessing would be a lie told with a highlight.
 * `unknown` - the entity reports nothing (off, or no source support).
 */
export function sourceState(record) {
  const list = Array.isArray(record?.raw?.source_list) ? record.raw.source_list.slice() : [];
  const current = record?.raw?.source ?? null;
  if (current == null || record?.state !== "on") return { list, current: null, kind: "unknown" };
  if (list.includes(current)) return { list, current, kind: "exact" };
  return { list, current, kind: "ambiguous" };
}

/**
 * One line for a phone status row. An ambiguous source is left out rather than
 * guessed - the same rule as the source picker, in the smallest shape.
 */
export function tvSummary(c) {
  if (!c?.available) return "Unavailable";
  if (!c.on) return "Off";
  const parts = [c.power.confirmed ? "On" : "On (assumed)"];
  if (c.source.kind === "exact") parts.push(c.source.current);
  if (c.volume.confirmed) parts.push(c.volume.muted ? `${c.volume.level}% muted` : `${c.volume.level}%`);
  return parts.join(" · ");
}

/**
 * Everything the card needs from one media player record.
 *
 * Each group says what is OFFERED (from the flags) and what is CONFIRMED (from
 * state). A control can be offered and unconfirmed - that is the normal case for
 * anything the set does not report back.
 */
export function tvControls(record, { platform = null } = {}) {
  const f = decodeFeatures("media_player", record?.raw?.supported_features);
  const plat = platform || record?.platform || null;
  const assumed = record?.raw?.assumed_state === true;
  const covers = ASSUMED_STATE_COVERS[plat] || "state";
  const has = (name) => f.names.includes(name);
  const on = record?.state === "on";
  const vol = record?.raw?.volume_level;
  const level = on && Number.isFinite(vol) ? Math.round(vol * 100) : null;
  const muted = on && typeof record?.raw?.is_volume_muted === "boolean" ? record.raw.is_volume_muted : null;
  return {
    on,
    available: record != null && !["unavailable", "unknown"].includes(record.state),
    power: { canOn: has("TURN_ON"), canOff: has("TURN_OFF"),
      confirmed: !(assumed && covers === "state") },
    volume: {
      step: has("VOLUME_STEP"), set: has("VOLUME_SET"), mute: has("VOLUME_MUTE"),
      level, muted,
      confirmed: level != null,            // the set reported a level back
    },
    source: { canSelect: has("SELECT_SOURCE"), ...sourceState(record) },
    transport: {
      play: has("PLAY"), pause: has("PAUSE"), stop: has("STOP"),
      next: has("NEXT_TRACK"), prev: has("PREVIOUS_TRACK"),
      confirmed: false,                    // key presses; nothing reports playback back
    },
    app: record?.raw?.app_id ?? null,      // a package id - HA gives no display name
    assumed,
    platform: plat,
    features: f.names,
  };
}
