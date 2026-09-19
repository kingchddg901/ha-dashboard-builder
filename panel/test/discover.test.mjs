/**
 * Tests for discovery - candidate tiles written from what Home Assistant has -
 * against this house's registry (captured 2026-09-19).
 *
 *   node --test panel/test/discover.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { discover, placedEntities, unplacedByArea, withStartingTiles } from "../discover-core.js";
import { availableFrom } from "../layout-core.js";
import { SEED } from "../seed.js";
import { RENDERERS } from "../renderers.js";

const hass = JSON.parse(readFileSync(new URL("./discover.fixture.json", import.meta.url), "utf8"));
const all = discover(hass);
const find = (pred) => all.filter(pred);

// RED IF: a TV is paired with the Cast player beside it, or a TV is missed -
// Bryan's TV is the case that arrived without anyone writing a tile for it.
test("every TV is found, paired with its own integration's player", () => {
  const tvs = find((c) => c.kind === "tv").map((c) => [c.title, c.config.media_player, c.config.remote]);
  assert.deepEqual(tvs.sort(), [
    ["Android TV", "media_player.android_tv_2", "remote.android_tv"],
    ["Big TV", "media_player.big_tv_2", "remote.big_tv"],
    ["Bryan's TV", "media_player.bryan_s_tv", "remote.bryan_s_tv"],
    ["Living Room TV", "media_player.living_room_tv", "remote.living_room_tv"],
  ].sort());
  assert.ok(!all.some((c) => c.primary.includes("media_player.u8000f3341")), "the Cast player is not a TV of its own");
});

test("the fan comes with its device's light, not the nightlight", () => {
  const fan = find((c) => c.config.fan === "fan.ceiling_fan");
  assert.equal(fan.length, 1);
  assert.equal(fan[0].config.light, "light.ceiling_fan");
  assert.ok(!all.some((c) => c.kind === "appliance" && c.config.light === "light.ceiling_fan" && !c.config.fan),
    "the fan's light is not offered again on its own");
});

// RED IF: a group's own bulbs are each offered as well (noise), or a bulb in
// another area than its group is swallowed (the kitchen would vanish).
test("a group carries the bulbs in its area; a bulb elsewhere stays its own", () => {
  const bath = find((c) => c.config.entity === "light.bathroom");
  assert.equal(bath.length, 1, "Bathroom is one tree");
  assert.ok(!all.some((c) => c.config.light === "light.bathroom1"), "its bulbs are inside it");
  const kitchen = find((c) => c.config.light === "light.kitchen");
  assert.equal(kitchen.length, 1, "the kitchen is in Main house, but in its own area - still offered");
  assert.equal(kitchen[0].areaName, "Kitchen");
});

test("the robots Vacuum Agent manages, named by their panels", () => {
  assert.deepEqual(find((c) => c.kind === "va-rooms").map((c) => c.title).sort(),
    ["Eufy Alfred", "Robin Dreame", "Robo Rock Ivy"]);
});

// RED IF: discovery writes a kind no renderer can draw.
test("every candidate names a registered renderer", () => {
  for (const c of all) assert.ok(RENDERERS[c.kind], `${c.id}: ${c.kind}`);
  assert.equal(new Set(all.map((c) => c.id)).size, all.length, "candidate ids are unique");
});

// RED IF: something already on the dashboard is offered again - the Big TV tile
// names media_player.big_tv_2, so Big TV must not come back as a candidate.
test("what the dashboard already has is not offered again", () => {
  const placed = placedEntities(SEED);
  assert.ok(placed.has("media_player.big_tv_2") && placed.has("fan.ceiling_fan"));
  const offered = unplacedByArea(all, SEED).flatMap((g) => g.candidates);
  assert.ok(!offered.some((c) => c.config.media_player === "media_player.big_tv_2"));
  assert.ok(!offered.some((c) => c.config.fan === "fan.ceiling_fan"));
  const empty = { v: 1, cols: 12, tabs: [{ id: "a", title: "A", tiles: [] }], shelf: [] };
  assert.equal(unplacedByArea(all, empty).flatMap((g) => g.candidates).length, all.length);
});

test("candidates come grouped by area, with no-area last", () => {
  const empty = { v: 1, cols: 12, tabs: [{ id: "a", title: "A", tiles: [] }], shelf: [] };
  const groups = unplacedByArea(all, empty);
  const names = groups.map((g) => g.area);
  const lastNamed = names.filter(Boolean);
  assert.deepEqual(lastNamed, lastNamed.slice().sort((a, b) => a.localeCompare(b)));
  if (names.includes(null)) assert.equal(names.at(-1), null);
  const living = groups.find((g) => g.area === "Living Room").candidates.map((c) => c.kind).sort();
  assert.deepEqual(living, ["lights", "tv"], "Living Room: its lights and its TV");
});

// RED IF: a thing the starting layout has a tile for is left out of its area -
// "Make a tab" for Bryan's room would leave his TV behind - or the hand-made
// tile loses to the discovered one (the fan would lose its corrected light).
test("starting-layout tiles stand in for their candidates, under the candidate's area", () => {
  const empty = { v: 1, cols: 12, tabs: [{ id: "a", title: "A", tiles: [] }], shelf: [] };
  const { found, fresh } = withStartingTiles(unplacedByArea(all, empty), availableFrom(empty, SEED));
  const bryan = found.find((g) => g.area === "Bryan's room").candidates;
  assert.ok(bryan.some((c) => c.id === "bryans-tv"), "Bryan's TV, as the starting layout's tile");
  const bedroom = found.find((g) => g.area === "Heidi and chris Room").candidates;
  const fans = bedroom.filter((c) => c.primary.includes("fan.ceiling_fan") || c.config.fan === "fan.ceiling_fan");
  assert.equal(fans.length, 1, "the fan is offered once, not as the hand-made tile AND the raw candidate");
  const fan = fans[0];
  assert.equal(fan.id, "bedroom-fan");
  assert.equal(fan.config.light, "light.ceiling_fan_calibrated", "the hand-made tile's corrected light");
  assert.ok(fresh.some((t) => t.id === "clock") && !fresh.some((t) => t.id === "bryans-tv"),
    "the starting section keeps only what discovery cannot find");
});

// RED IF: a plug is missed (the dishwasher plug arrived and nothing offered it),
// or every switch is offered - this house has 30 VA room switches and the
// grill's and robots' own toggles, which belong to those devices' tiles. The
// test that separates them: the plug IS its device, the others sit beside a
// vacuum, a climate or a fan.
test("a plug is a candidate; a switch beside a real device is not", () => {
  const plugs = find((c) => c.config.switch);
  assert.deepEqual(plugs.map((c) => [c.title, c.config.switch, c.area]),
    [["Dishwasher plug", "switch.kitchen_dishwasher_plug", "kitchen"]]);
  assert.equal(plugs[0].kind, "appliance");
  // RED IF: a plug is offered at the fan-and-light size. On and off is one line
  // of control, and the tile arrived four fifths empty when it took that size.
  assert.deepEqual([plugs[0].w, plugs[0].h], [4, 2]);
  assert.ok(RENDERERS.appliance.size.h > plugs[0].h, "and it is the candidate's own size, not the renderer's");
  // RED IF: a plug is called a light. The appliance kind covers three things
  // now, and the noun is what the tile's own row says it is.
  assert.equal(RENDERERS.appliance.noun(plugs[0].config), "plug");
  assert.ok(!all.some((c) => c.primary.includes("switch.grill_smoke_mode")), "the grill's toggle is the grill's");
  assert.ok(!all.some((c) => c.primary.some((e) => /selected_for_cleaning/.test(e))), "no VA room switch is a tile");
});

// RED IF: a switch is offered beside the device it belongs to, so the thing
// lands on the dashboard twice - once as itself, once as one of its own
// controls. Built by hand, not captured: every switch-beside-a-device in this
// house (the robots', the grill's) carries no device class, so the class test
// alone already excludes them and the fixture cannot tell the two rules apart.
// The case this guards is a device that has BOTH - a relay reporting itself as
// a switch, on something that already has its own tile.
test("a switch on a device that already has its own tile is that device's, not a tile", () => {
  const house = (withFan) => ({
    states: {
      "switch.shed_relay": { entity_id: "switch.shed_relay", state: "on", attributes: { device_class: "switch" } },
      ...(withFan ? { "fan.shed": { entity_id: "fan.shed", state: "off", attributes: {} } } : {}),
    },
    entities: {
      "switch.shed_relay": { entity_id: "switch.shed_relay", platform: "x", device_id: "d1" },
      ...(withFan ? { "fan.shed": { entity_id: "fan.shed", platform: "x", device_id: "d1" } } : {}),
    },
    devices: { d1: { id: "d1", name: "Shed fan", area_id: "shed" } },
    areas: { shed: { area_id: "shed", name: "Shed" } },
  });
  assert.deepEqual(discover(house(false)).map((c) => c.config.switch), ["switch.shed_relay"],
    "on its own the relay is a plug - or the other half proves nothing");
  const beside = discover(house(true));
  assert.ok(!beside.some((c) => c.config.switch), "beside its fan it is one of the fan's controls");
  assert.equal(beside.filter((c) => c.config.fan === "fan.shed").length, 1, "and the fan is still offered once");
});

// RED IF: a switch HA marks as a setting reaches the dashboard. Built by hand,
// not captured: this house has no config-category switch that also carries a
// device class, so the fixture cannot exercise it. `entity_category` is a
// NUMBER in the frontend's registry and a STRING over the websocket, and both
// must be refused.
test("a switch marked as a setting is never offered, numbered or spelled", () => {
  const make = (cat) => ({
    states: { "switch.relay": { entity_id: "switch.relay", state: "on", attributes: { device_class: "switch" } } },
    entities: { "switch.relay": { entity_id: "switch.relay", platform: "x", device_id: "d1", ...(cat ? { entity_category: cat } : {}) } },
    devices: { d1: { id: "d1", name: "Relay", area_id: "shed" } },
    areas: { shed: { area_id: "shed", name: "Shed" } },
  });
  assert.equal(discover(make(null)).length, 1, "a plain relay is offered - or the rest proves nothing");
  assert.equal(discover(make(1)).length, 0, "numbered, as the frontend hands it over");
  assert.equal(discover(make("config")).length, 0, "spelled, as the websocket registry has it");
});
