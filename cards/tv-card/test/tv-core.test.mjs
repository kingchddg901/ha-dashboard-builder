/**
 * Tests for the TV control rules. The "on" values are what HA reported for the
 * real set on 2026-09-17 after it was pointed back at the right address; the
 * "off" record comes from the shared level-1 fixture.
 *
 *   node --test cards/tv-card/test/tv-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { describeEntity } from "../../builder-debug-card/capability-core.js";
import { REMOTE_KEYS, keyCommand, sourceState, tvControls, tvSummary } from "../tv-core.js";

const hass = JSON.parse(readFileSync(
  new URL("../../builder-debug-card/test/hass.fixture.json", import.meta.url), "utf8"));
const offRecord = describeEntity({
  entityId: "media_player.big_tv_2",
  entry: hass.entities["media_player.big_tv_2"] || null,
  state: hass.states["media_player.big_tv_2"], devices: hass.devices, areas: hass.areas,
});
// Measured live: on, 22 percent, not muted, and the source the integration uses
// when no app owns the screen.
const onRecord = {
  state: "on",
  raw: { supported_features: 24509, volume_level: 0.22, is_volume_muted: false,
    source: "TV/HDMI", source_list: ["TV", "HDMI"] },
};

// RED IF: an unknown key is sent. The set ignores a key it does not know without
// any error, so it would look like a working button that does nothing.
test("only keys the set is known to accept are sent", () => {
  assert.equal(keyCommand("UP"), "KEY_UP");
  assert.equal(keyCommand("key_enter"), "KEY_ENTER");
  assert.equal(keyCommand("KEY_RETURN"), "KEY_RETURN");
  assert.equal(keyCommand("NETFLIX"), null);
  assert.equal(keyCommand(""), null);
  assert.equal(REMOTE_KEYS.length, 23);
});

// RED IF: the flags are decoded wrongly. 24509 is the measured mask for this set.
test("the set's own flags decode to its twelve claimed features", () => {
  const c = tvControls(onRecord);
  assert.equal(c.features.length, 12);
  assert.ok(c.power.canOn && c.power.canOff);
  assert.ok(c.volume.step && c.volume.set && c.volume.mute);
  assert.ok(c.source.canSelect);
});

// RED IF: a live level is not carried through, or a level is shown while off.
test("volume is confirmed only when the set reports a level", () => {
  const on = tvControls(onRecord);
  assert.equal(on.volume.level, 22);
  assert.equal(on.volume.muted, false);
  assert.equal(on.volume.confirmed, true);
  const off = tvControls(offRecord);
  assert.equal(off.on, false);
  assert.equal(off.volume.level, null);
  assert.equal(off.volume.confirmed, false);
});

// RED IF: an ambiguous source is highlighted as one of the options. This is the
// measured case: "TV/HDMI" against ["TV", "HDMI"] means the set cannot tell which.
test("a source that matches none of the options is ambiguous, not a guess", () => {
  const s = sourceState(onRecord);
  assert.equal(s.kind, "ambiguous");
  assert.equal(s.current, "TV/HDMI");
  assert.deepEqual(s.list, ["TV", "HDMI"]);
});

test("a source that is one of the options is exact", () => {
  const s = sourceState({ ...onRecord, raw: { ...onRecord.raw, source: "HDMI" } });
  assert.equal(s.kind, "exact");
  assert.equal(s.current, "HDMI");
});

// RED IF: an off set reports a current source.
test("an off set has no current source", () => {
  assert.equal(sourceState(offRecord).kind, "unknown");
  assert.equal(sourceState(offRecord).current, null);
});

test("an unavailable set is flagged, not treated as off", () => {
  const c = tvControls({ state: "unavailable", raw: {} });
  assert.equal(c.available, false);
  assert.equal(c.on, false);
});

// RED IF: an ambiguous source is put in the glance as though it were known.
test("the TV's glance leaves out a source it cannot name", () => {
  assert.equal(tvSummary(tvControls(onRecord)), "on · 22%");
  const hdmi = { ...onRecord, raw: { ...onRecord.raw, source: "HDMI" } };
  assert.equal(tvSummary(tvControls(hdmi)), "on · HDMI · 22%");
});

test("the TV's glance says muted, off and unavailable plainly", () => {
  const muted = { ...onRecord, raw: { ...onRecord.raw, is_volume_muted: true } };
  assert.equal(tvSummary(tvControls(muted)), "on · 22% muted");
  assert.equal(tvSummary(tvControls(offRecord)), "off");
  assert.equal(tvSummary(tvControls({ state: "unavailable", raw: {} })), "unavailable");
});
