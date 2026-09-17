/**
 * Tests for the level-1 capability core.
 *
 * The fixture is REAL: generated from a live registry and state dump on
 * 2026-09-17, so the values below are what HA actually said, not what would be
 * convenient. Each test names the input that makes it red in a comment — a test
 * that cannot go red is a preference, not a check.
 *
 *   node --test cards/builder-debug-card/test/capability-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  decodeFeatures, resolveArea, describeEntity, deviceSiblings, selectEntities, domainOf,
} from "../capability-core.js";

const hass = JSON.parse(readFileSync(new URL("./hass.fixture.json", import.meta.url), "utf8"));
const { states, entities, devices, areas } = hass;
const describe = (id) => describeEntity({
  entityId: id, entry: entities[id] || null, state: states[id] || null, devices, areas,
});
const FAN_DEVICE = entities["fan.ceiling_fan"].device_id;

/* ---------------------------------------------------------------- features */

// RED IF: a flag value in the table is wrong, or bits are enumerated out of order.
test("fan 61 decodes to the five flags the live fan reports", () => {
  const f = decodeFeatures("fan", states["fan.ceiling_fan"].attributes.supported_features);
  assert.equal(f.bits, 61);
  assert.deepEqual(f.names, ["SET_SPEED", "DIRECTION", "PRESET_MODE", "TURN_OFF", "TURN_ON"]);
  assert.deepEqual(f.unknown, []);
  assert.equal(f.none, false);
});

// RED IF: `none` is dropped, or 0 is reported as "unknown"/"not tabulated".
// This is the remote case: 0 is a real, measured answer and must not read as absence.
test("remote 0 is a real answer, not a missing one", () => {
  const f = decodeFeatures("remote", states["remote.big_tv"].attributes.supported_features);
  assert.equal(f.bits, 0);
  assert.equal(f.none, true);
  assert.equal(f.tabulated, true);
  assert.deepEqual(f.names, []);
  assert.deepEqual(f.unknown, []);
});

// RED IF: unknown bits are silently discarded. Ablate the `unknown.push` and this fails,
// which is the point — a stale table must be visible, not quiet.
test("a bit outside the table surfaces instead of vanishing", () => {
  const f = decodeFeatures("light", 4 | 64);
  assert.deepEqual(f.names, ["EFFECT"]);
  assert.deepEqual(f.unknown, ["bit 64"]);
});

// RED IF: an untabulated domain is treated as "no features" rather than "unknown".
test("an untabulated domain says so and keeps the bits", () => {
  const f = decodeFeatures("sensor", 5);
  assert.equal(f.tabulated, false);
  assert.deepEqual(f.names, []);
  assert.deepEqual(f.unknown, ["bit 1", "bit 4"]);
});

test("the real vacuum and media_player masks decode without leftovers", () => {
  for (const id of ["vacuum.robin", "media_player.big_tv_2"]) {
    const f = decodeFeatures(domainOf(id), states[id].attributes.supported_features);
    assert.deepEqual(f.unknown, [], `${id} has bits outside the table: ${f.unknown}`);
    assert.ok(f.names.length > 0);
  }
});

/* -------------------------------------------------------------------- area */

// RED IF: the two resolution paths are collapsed, or their precedence flips.
test("area resolves by entity, then device, then not at all", () => {
  assert.deepEqual(resolveArea(entities["light.ceiling_fan_calibrated"], devices, areas),
    { id: "bedroom", name: "Heidi and chris Room", floor_id: "main_floor", via: "entity" });
  assert.deepEqual(resolveArea(entities["light.ceiling_fan"], devices, areas),
    { id: "bedroom", name: "Heidi and chris Room", floor_id: "main_floor", via: "device" });
  assert.deepEqual(resolveArea(entities["vacuum.robin"], devices, areas),
    { id: null, name: null, floor_id: null, via: null });
});

// RED IF: the precedence flips. No entity on the live box has BOTH an entity area and a
// device area, so this conflict is assembled from real parts - the fan light's own registry
// entry, given a second real area - which is the only way to pin HA's rule that the
// entity-level area overrides the device's. An ablation that swapped the two went unnoticed
// until this case existed.
test("an entity-level area overrides its device's", () => {
  const entry = { ...entities["light.ceiling_fan"], area_id: "washroom" };
  assert.equal(devices[entry.device_id].area_id, "bedroom");
  const a = resolveArea(entry, devices, areas);
  assert.equal(a.id, "washroom");
  assert.equal(a.via, "entity");
});

// RED IF: an entity with no registry entry throws instead of returning a record.
test("no registry entry is a gap, not an exception", () => {
  const r = describeEntity({ entityId: "light.nowhere", entry: null, state: null, devices, areas });
  assert.equal(r.in_registry, false);
  assert.equal(r.area.via, null);
  assert.equal(r.state, null);
  assert.equal(r.features.none, true);
});

// RED IF: the id is displayed but the name is not carried, or vice versa. He asked for both.
test("both names travel with the id", () => {
  const r = describe("light.ceiling_fan_calibrated");
  assert.equal(r.entity_id, "light.ceiling_fan_calibrated");
  assert.equal(r.friendly_name, states["light.ceiling_fan_calibrated"].attributes.friendly_name);
  assert.equal(r.domain, "light");
  assert.equal(r.platform, "template");
});

/* ------------------------------------------------------ the deviceless hole */

// RED IF: a renderer may assume every entity has a device. The calibrated light has none,
// and it is the one that carries the colour correction — so this is the miss that matters.
test("the calibrated light has no device but does have an area", () => {
  const r = describe("light.ceiling_fan_calibrated");
  assert.equal(r.device, null);
  assert.equal(r.area.via, "entity");
  assert.equal(r.area.id, "bedroom");
});

// RED IF: "no device" is assumed to be a template-entity quirk. A light group has none either.
test("a light group also has no device and no area at all", () => {
  const r = describe("light.bathroom");
  assert.equal(r.platform, "group");
  assert.equal(r.device, null);
  assert.equal(r.area.id, null);
});

/* ------------------------------------------------------- open vocabularies */

// RED IF: an unknown device_class is dropped, or reported as known.
// vacuum defines NO device classes, so this value is entirely the integration's.
test("a custom device_class passes through, marked not-known", () => {
  assert.deepEqual(describe("vacuum.robin").device_class, { value: "dreame_vacuum", known: false });
  assert.deepEqual(describe("media_player.big_tv_2").device_class, { value: "tv", known: true });
});

// RED IF: a missing device_class becomes the string "null"/"unknown" instead of absent.
test("no device_class is absent, not a value", () => {
  assert.equal(describe("light.ceiling_fan").device_class, null);
});

// RED IF: option lists are filtered or normalised. "Error" is a preset the vendor ships;
// hiding it here would hide the reason the declaration needs an options filter.
test("option lists arrive verbatim, junk entries included", () => {
  const grill = describe("climate.grill");
  assert.deepEqual(grill.capabilities.hvac_modes, ["off", "heat"]);
  assert.deepEqual(grill.capabilities.preset_modes,
    ["Starting", "Cooking", "Off", "Shutting Down", "Error"]);
});

/* ------------------------------------------------------------ capabilities */

// RED IF: capability attributes are confused with live values. brightness/hs_color are
// state, not capability, and must not appear here.
test("a light's capabilities are its limits, not its current colour", () => {
  const c = describe("light.ceiling_fan_calibrated").capabilities;
  assert.deepEqual(c.supported_color_modes, ["color_temp", "hs"]);
  assert.equal(c.min_color_temp_kelvin, 2000);
  assert.equal(c.max_color_temp_kelvin, 4566);
  assert.equal(c.brightness, undefined);
  assert.equal(c.hs_color, undefined);
});

// RED IF: percentage_step is not carried. It is the hint that says six notches, not a slider.
test("the fan carries the step that settles notches vs slider", () => {
  const c = describe("fan.ceiling_fan").capabilities;
  assert.ok(Math.abs(c.percentage_step - 100 / 6) < 0.01, `got ${c.percentage_step}`);
  assert.deepEqual(c.preset_modes, ["normal", "nature", "sleep"]);
});

// RED IF: the raw dump is trimmed. It is the whole point of a debug card.
test("raw keeps every attribute", () => {
  const r = describe("light.ceiling_fan");
  assert.deepEqual(Object.keys(r.raw).sort(),
    Object.keys(states["light.ceiling_fan"].attributes).sort());
});

/* ---------------------------------------------------------------- siblings */

// RED IF: entity_category is ignored when counting what is worth showing.
// tuya_local exposes 21 entities for this fixture and marks 2 primary.
test("the fan device's 21 entities reduce to 2 primary", () => {
  const s = deviceSiblings(FAN_DEVICE, entities);
  assert.equal(s.total, 21);
  assert.equal(s.primaryCount, 2);
  assert.deepEqual(s.primary.sort(), ["fan.ceiling_fan", "light.ceiling_fan"]);
});

test("an unknown device id has no siblings and does not throw", () => {
  assert.deepEqual(deviceSiblings("nope", entities), { total: 0, primary: [], primaryCount: 0 });
});

/* --------------------------------------------------------------- selection */

// RED IF: selection leaks other domains, or stops sorting.
test("lights are selected by domain, sorted", () => {
  const ids = selectEntities({ states, entities, devices, areas }).map((r) => r.entity_id);
  assert.deepEqual(ids, ["light.bathroom", "light.bathroom1", "light.bathroom3",
    "light.ceiling_fan", "light.ceiling_fan_calibrated"]);
});

// RED IF: the area filter uses only one resolution path. These two lights resolve to
// bedroom by DIFFERENT routes - one via its device, one via itself - and both must match.
test("the area filter honours both resolution routes", () => {
  const ids = selectEntities({ states, entities, devices, areas, area: "bedroom" })
    .map((r) => r.entity_id);
  assert.deepEqual(ids, ["light.ceiling_fan", "light.ceiling_fan_calibrated"]);
});

// RED IF: an explicit list is reordered by domain rules or silently filtered.
test("an explicit entity list overrides the domain filter", () => {
  const ids = selectEntities({
    states, entities, devices, areas,
    include: ["remote.big_tv", "climate.grill", "vacuum.robin"],
  }).map((r) => r.entity_id);
  assert.deepEqual(ids, ["climate.grill", "remote.big_tv", "vacuum.robin"]);
});
