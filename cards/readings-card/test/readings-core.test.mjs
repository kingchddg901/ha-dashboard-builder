/**
 * Tests for readings. The fixture is the house's own non-vacuum readings and the
 * three robots' glance entities, captured 2026-09-17, plus a `synthetic` block
 * for shapes the house does not have yet - each clearly named synthetic_*.
 *
 *   node --test cards/readings-card/test/readings-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  readingOf, summary, precisionFor, relativeTime, robotGlance, BINARY_WORDS, WEATHER_WORDS,
} from "../readings-core.js";

const fx = JSON.parse(readFileSync(new URL("./readings.fixture.json", import.meta.url), "utf8"));
const real = (id) => readingOf(fx.states[id], { entry: fx.entities[id] });
const syn = (id) => readingOf(fx.synthetic[id]);

/* ------------------------------------------------------------ absence */

// RED IF: unavailable and unknown are merged. The grill's probes read unavailable
// whenever the grill is off; unknown means never reported. Different facts.
test("unavailable and unknown stay different kinds", () => {
  assert.equal(real("sensor.grill_probe_1_temperature").kind, "unavailable");
  const u = readingOf({ entity_id: "sensor.x", state: "unknown", attributes: {} });
  assert.equal(u.kind, "unknown");
  assert.notEqual(u.key, real("sensor.grill_probe_1_temperature").key);
  assert.equal(syn("sensor.synthetic_offline_meter").kind, "unavailable");
});

/* ---------------------------------------------------------- precision */

// RED IF: the integration's suggested precision is ignored. HA stores this
// pressure with eleven decimals; the integration says one.
test("precision comes from the entity, not from a guess", () => {
  const id = "sensor.gtill_san_diego_mouse_2_0_relative_pressure";
  assert.equal(fx.entities[id].suggested_display_precision, 1);
  const r = real(id);
  assert.equal(r.precision, 1);
  assert.equal(r.text, `${Number(fx.states[id].state).toFixed(1)} hPa`);
});

// RED IF: the user's own precision does not win over the integration's.
test("a user's display precision beats the integration's suggestion", () => {
  assert.equal(precisionFor(1014.83, { display_precision: 0, suggested_display_precision: 1 }), 0);
  assert.equal(precisionFor(1014.83, { suggested_display_precision: 1 }), 1);
});

test("with no precision given, the fallback is plain", () => {
  assert.equal(syn("sensor.synthetic_voltage").text, "122 V");        // >= 100: whole
  assert.equal(syn("sensor.synthetic_illuminance").text, "0.2 lx");   // small: one place
});

/* -------------------------------------------------------------- units */

// RED IF: a negative reading loses its sign, or a percent gets a space.
test("negative values keep their sign and percent sits tight", () => {
  assert.equal(syn("sensor.synthetic_outdoor_temperature_c").text, "-3.4 °C");
  const h = real("sensor.san_diego_mouse_2_0_humidity");
  assert.equal(h.kind, "number");
  assert.ok(h.text.endsWith("%") && !h.text.endsWith(" %"), h.text);
});

test("mixed unit systems are rendered as given, never converted", () => {
  assert.equal(real("sensor.san_diego_mouse_2_0_max_daily_gust").unit, "km/h");
  assert.equal(syn("sensor.synthetic_outdoor_temperature_c").unit, "°C");
});

/* ------------------------------------------------------------- binary */

// RED IF: a binary sensor says "on" instead of the words its class calls for.
test("each binary class gets its own words", () => {
  assert.equal(syn("binary_sensor.synthetic_dishwasher_door").text, "Open");
  assert.equal(syn("binary_sensor.synthetic_dishwasher_door").key, "binary.door.on");
  assert.equal(syn("binary_sensor.synthetic_hall_motion").text, "Clear");
  assert.equal(syn("binary_sensor.synthetic_sink_leak").text, "Dry");
});

// RED IF: the lock is read the obvious way. For a binary lock sensor HA defines
// on as UNLOCKED - the trap every generic on/off badge falls into.
test("a lock sensor that is on reads Unlocked", () => {
  assert.equal(syn("binary_sensor.synthetic_front_lock").text, "Unlocked");
  assert.deepEqual(BINARY_WORDS.lock, ["Locked", "Unlocked"]);
});

test("an unknown binary class falls back to On and Off", () => {
  const r = readingOf({ entity_id: "binary_sensor.x", state: "on", attributes: { device_class: "made_up" } });
  assert.equal(r.text, "On");
  assert.equal(r.key, "binary.generic.on");
});

/* --------------------------------------------------- other kinds, real */

test("a timestamp reads relative to now", () => {
  const id = "sensor.backup_next_scheduled_automatic_backup";
  const when = new Date(fx.states[id].state);
  const r = readingOf(fx.states[id], { now: new Date(when.getTime() - 13 * 3600e3) });
  assert.equal(r.kind, "timestamp");
  assert.equal(r.text, "in 13 h");
  assert.equal(relativeTime(new Date(0), new Date(12 * 60e3)), "12 min ago");
});

test("an enum keeps its options and humanises its value", () => {
  const r = real("sensor.backup_backup_manager_state");
  assert.equal(r.kind, "enum");
  assert.ok(r.options.includes("create_backup"));
  assert.equal(readingOf({ ...fx.states["sensor.backup_backup_manager_state"], state: "create_backup" }).text,
    "Create backup");
});

test("weather reads as words, with its temperature in the summary", () => {
  const r = real("weather.forecast_home");
  assert.equal(r.kind, "weather");
  // RED IF: the raw slug leaks through. The capture read "partlycloudy".
  assert.equal(r.condition, fx.states["weather.forecast_home"].state);
  assert.equal(r.text, WEATHER_WORDS[r.condition] ?? r.text);
  assert.notEqual(r.text, "partlycloudy");
  assert.equal(readingOf({ entity_id: "weather.x", state: "partlycloudy", attributes: {} }).text, "Partly cloudy");
  if (r.temperature != null) assert.ok(summary(r).includes("·"));
});

test("a sensor with no class and a non-number state is text", () => {
  const r = real("sensor.time");
  assert.equal(r.kind, "text");
  assert.equal(r.text, fx.states["sensor.time"].state);
});

/* -------------------------------------------------------------- robots */

// RED IF: the glance cannot be built for every brand from the same three entities.
test("one glance definition covers all three brands", () => {
  for (const name of ["robin", "ivy", "alfred"]) {
    const g = robotGlance(fx.states, name);
    assert.equal(g.available, true, name);
    assert.ok(g.text.startsWith(g.name), g.text);
    assert.equal(g.error, null, `${name} has no active error in the capture`);
  }
});

test("an active error shows the normalised error text", () => {
  const states = {
    "vacuum.ivy": { state: "error", attributes: { friendly_name: "Ivy" } },
    "binary_sensor.ivy_active_run_has_error": { state: "on", attributes: {} },
    "sensor.ivy_active_run_error": { state: "main_brush_jammed", attributes: {} },
  };
  const g = robotGlance(states, "ivy");
  assert.equal(g.error, "Main brush jammed");
  assert.equal(g.text, "Ivy — error: Main brush jammed");
});

// RED IF: the glance reads a brand's own error sensor. Alfred's brand sensor may
// hold a past error while VA's normalised run error says none.
test("a brand's own error sensor is never read", () => {
  const states = {
    "vacuum.alfred": { state: "docked", attributes: { friendly_name: "Alfred" } },
    "binary_sensor.alfred_active_run_has_error": { state: "off", attributes: {} },
    "sensor.alfred_active_run_error": { state: "none", attributes: {} },
    "sensor.alfred_error_message": { state: "STATION DUST AP DUCT BLOCKED", attributes: {} },
  };
  assert.equal(robotGlance(states, "alfred").error, null);
});

test("a missing or unavailable robot says so", () => {
  assert.equal(robotGlance({}, "robin").available, false);
  assert.equal(robotGlance({ "vacuum.robin": { state: "unavailable", attributes: {} } }, "robin").text,
    "Robin — unavailable");
});
