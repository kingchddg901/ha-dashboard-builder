/**
 * Tests for the level-2 control rules.
 *
 * Records come from the level-1 core over the same real fixture, so the inputs
 * are what the house actually reports. Each test names the input that makes it
 * red; the values that are typed in by hand are measured ones, and say so.
 *
 *   node --test cards/appliance-card/test/control-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { describeEntity, groupIndex } from "../../builder-debug-card/capability-core.js";
import {
  speedControl, levelControl, kelvinControl, appearanceControl, composeCapabilities,
  layoutFor, axisFor,
} from "../control-core.js";

const hass = JSON.parse(readFileSync(
  new URL("../../builder-debug-card/test/hass.fixture.json", import.meta.url), "utf8"));
const { states, entities, devices, areas } = hass;
const groups = groupIndex(states);
const rec = (id) => describeEntity({
  entityId: id, entry: entities[id] || null, state: states[id] || null, devices, areas, groups,
});

/* ------------------------------------------------------------------ speed */

// RED IF: percentage_step is ignored, or the notch count is derived wrongly.
// 16.667 is what tuya_local reports for a fan whose DP 105 has a range of 1-6.
test("the local fan offers six notches, from its own step", () => {
  const c = speedControl(rec("fan.ceiling_fan"));
  assert.equal(c.kind, "notches");
  assert.equal(c.count, 6);
  assert.equal(c.source, "percentage_step");
  assert.deepEqual(c.values, [17, 33, 50, 67, 83, 100]);
});

// RED IF: a step of 1 is taken at face value and yields a hundred notches. This is
// the Tuya cloud entity for the SAME fan - measured percentage_step 1.0, six real
// speeds - so believing it would draw the wrong control for identical hardware.
test("a step of 1 is no opinion, not a hundred positions", () => {
  const cloudFan = {
    state: "off",
    capabilities: { percentage_step: 1.0, preset_modes: ["nature", "sleep"] },
    raw: { percentage: 60, supported_features: 61 },
  };
  const c = speedControl(cloudFan);
  assert.equal(c.kind, "slider");
  assert.equal(c.source, "none");
  assert.notEqual(c.count, 100);
});

// RED IF: a declaration cannot rescue a misreporting integration. The audit found
// no derivable way to tell six speeds from a hundred, so a human must be able to.
test("a declared notch count overrides what the integration claims", () => {
  const cloudFan = { state: "off", capabilities: { percentage_step: 1.0 }, raw: { percentage: 60 } };
  const c = speedControl(cloudFan, { declaredNotches: 6 });
  assert.equal(c.kind, "notches");
  assert.equal(c.count, 6);
  assert.equal(c.source, "declared");
});

// RED IF: an absurd step is accepted. 0.7 would imply 143 notches.
test("a step that implies too many positions is rejected", () => {
  assert.equal(speedControl({ capabilities: { percentage_step: 0.7 }, raw: {} }).kind, "slider");
});

/* ------------------------------------------------------------------ level */

// RED IF: an off light is drawn as though HA still knew its level. It does not -
// every off light in the house reports brightness null - so the remembered value
// is the only source, and the three states must stay distinguishable.
test("off with a remembered level is a different state from off knowing nothing", () => {
  const off = rec("light.bathroom");
  assert.equal(off.state, "off");
  assert.equal(off.raw.brightness, null);

  const known = levelControl(off, { remembered: { pct: 32 } });
  assert.equal(known.state, "off-restores");
  assert.equal(known.restore, 32);
  assert.equal(known.pct, null);

  const unknown = levelControl(off, {});
  assert.equal(unknown.state, "off-unknown");
  assert.equal(unknown.restore, null);
});

// RED IF: a lit light shows a restore value instead of its live one.
test("a lit light shows its live level and no restore", () => {
  const on = rec("light.ceiling_fan_calibrated");
  assert.equal(on.state, "on");
  const c = levelControl(on, { remembered: { pct: 99 } });
  assert.equal(c.state, "lit");
  assert.equal(c.pct, Math.round(on.raw.brightness / 2.55));
  assert.equal(c.restore, null);
});

// RED IF: a binary light is offered a brightness control. The Shelly-backed
// kitchen supports onoff only and has no level to set or remember.
test("a binary light is not offered a level at all", () => {
  const kitchen = { state: "on", capabilities: { supported_color_modes: ["onoff"] }, raw: {} };
  assert.equal(levelControl(kitchen, {}).supported, false);
  assert.equal(levelControl(rec("light.ceiling_fan_calibrated"), {}).supported, true);
});

/* ------------------------------------------------------------- appearance */

// RED IF: an off light falls back to the range minimum, which reads as "returns at
// 2000 K" when it returns at 3367. HA nulls colour at switch-off exactly as it
// nulls brightness, so the remembered value is the only truthful source.
test("an off light reports the colour it will return to, not the range floor", () => {
  const off = { state: "off", capabilities: { min_color_temp_kelvin: 2000, max_color_temp_kelvin: 4566 },
                raw: { color_temp_kelvin: null, hs_color: null } };
  const a = appearanceControl(off, { remembered: { k: 3367, pct: 31 } });
  assert.equal(a.mode, "temp");
  assert.equal(a.kelvin, 3367);
  assert.equal(a.from, "remembered");
});

// RED IF: a plausible-looking default is invented when nothing is known.
test("off with nothing remembered is unknown, not a guess", () => {
  const a = appearanceControl({ state: "off", capabilities: {}, raw: {} }, {});
  assert.equal(a.mode, "unknown");
  assert.equal(a.kelvin, null);
  assert.equal(a.from, "none");
});

// RED IF: a remembered colour is dropped because only kelvin was handled. This
// light was measured at hue 239.5, saturation 100 - a deep blue nobody would
// guess from a colour-temperature range.
test("a remembered hs colour survives too", () => {
  const a = appearanceControl({ state: "off", capabilities: {}, raw: {} },
    { remembered: { hs: [239.528, 100.0], pct: 66 } });
  assert.equal(a.mode, "color");
  assert.deepEqual(a.hs, [239.528, 100.0]);
  assert.equal(a.from, "remembered");
});

// RED IF: a lit light shows a stale remembered value instead of what it is doing.
test("a lit light reports live colour, ignoring the memory", () => {
  const on = rec("light.ceiling_fan_calibrated");
  const a = appearanceControl(on, { remembered: { k: 9999 } });
  assert.equal(a.from, "live");
  assert.equal(a.kelvin, on.raw.color_temp_kelvin);
});

/* ----------------------------------------------------------------- kelvin */

// RED IF: the kelvin range is hard-coded or taken from the wrong entity. The
// calibrated light carries the MEASURED range, four kelvin below the raw one
// because a template light works in mireds.
test("kelvin limits come from the entity that will be driven", () => {
  assert.deepEqual(kelvinControl(rec("light.ceiling_fan_calibrated")),
    { min: 2000, max: 4566, current: states["light.ceiling_fan_calibrated"].attributes.color_temp_kelvin });
  assert.equal(kelvinControl(rec("light.ceiling_fan")).max, 4570);
});

test("a light with no colour temperature has no kelvin control", () => {
  assert.equal(kelvinControl({ capabilities: {}, raw: {} }), null);
});

/* --------------------------------------------------------------- compose */

// RED IF: a parent's capabilities are reported as though every child had them.
// light.main_house contains the binary kitchen; HA's own group drops onoff from
// the union and claims full colour, which is the trap this exists to avoid.
test("a mixed parent offers the union and guarantees almost nothing", () => {
  const members = states["light.main_house"].attributes.entity_id.map(rec);
  const c = composeCapabilities(members);
  assert.ok(c.offered.includes("onoff"), "the binary child is visible in the union");
  assert.ok(c.offered.includes("color_temp"));
  assert.deepEqual(c.guaranteed, [], "nothing is common to every child");
  assert.ok(c.partial.includes("color_temp"), "colour applies to some children only");
});

test("an all-alike parent guarantees what it offers", () => {
  const members = states["light.bathroom"].attributes.entity_id.map(rec);
  const c = composeCapabilities(members);
  assert.deepEqual(c.guaranteed, c.offered);
  assert.deepEqual(c.partial, []);
});

/* ---------------------------------------------------------------- layout */

// RED IF: layout is decided by the viewport. These are CONTAINER widths - a card
// in a 300px column on a 4K screen is compact, and a vertical notch column is
// right there and wrong when the card is wide.
test("layout and axis follow the container width", () => {
  assert.equal(layoutFor(320), "compact");
  assert.equal(layoutFor(420), "regular");
  assert.equal(layoutFor(900), "wide");
  assert.equal(axisFor("compact"), "vertical");
  assert.equal(axisFor("regular"), "vertical");
  assert.equal(axisFor("wide"), "horizontal");
});

test("an unknown width falls back rather than throwing", () => {
  assert.equal(layoutFor(undefined), "regular");
});
