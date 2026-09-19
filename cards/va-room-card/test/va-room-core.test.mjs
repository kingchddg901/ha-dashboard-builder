/**
 * Tests for the VA room tile's shallow half, against what VA published on this
 * house on 2026-09-19 (all three robots' room switches, and VA's panels).
 *
 *   node --test cards/va-room-card/test/va-room-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  roomsFor, optionLabel, savedSettings, startCalls, robotName, roomKey, robotsWithRooms, roomAcrossRobots,
  lastCleanedAcross,
} from "../va-room-core.js";

const { panels, states } = JSON.parse(readFileSync(new URL("./va.fixture.json", import.meta.url), "utf8"));

// RED IF: another robot's rooms leak in, or a non-room switch is taken for a room.
test("a robot's rooms are its own room switches, by name", () => {
  const alfred = roomsFor(states, "vacuum.alfred");
  const robin = roomsFor(states, "vacuum.robin");
  assert.deepEqual(robotsWithRooms(states), ["vacuum.alfred", "vacuum.ivy", "vacuum.robin"]);
  assert.equal(alfred.length, 10);
  assert.equal(robin.length, 10);
  assert.ok(alfred.every((r) => r.attrs.vacuum_entity_id === "vacuum.alfred"));
  const names = alfred.map((r) => r.name);
  assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b)));
  assert.ok(alfred.every((r) => r.map_id), "every room carries its map");
});

// RED IF: a saved value is shown as its raw key where VA gives a label - the
// brand's words are VA's to supply.
test("saved settings read in VA's own labels", () => {
  const a = { clean_mode: "vacuum_mop", clean_mode_options: [{ value: "vacuum_mop", label: "Vacuum & Mop" }],
    fan_speed: "Max", fan_speed_options: [{ value: "Max", label: "Max" }],
    water_level: "Low", water_level_options: [{ value: "Low", label: "Low" }],
    clean_passes: 2, supports_edge_mopping: true, edge_mopping: true };
  assert.deepEqual(savedSettings(a), ["Vacuum & Mop", "Max suction", "water Low", "2 passes", "edge mopping"]);
  assert.equal(optionLabel([{ value: "x", label: "Ex" }], "y"), "y", "no label: the value, not a guess");
  assert.equal(optionLabel(null, null), null);
});

// RED IF: the tile decides which settings apply (e.g. hiding suction for a mop
// run) - that rule is VA's, and a copy of it here would drift.
test("nothing is inferred: every saved field shows, and absent ones do not", () => {
  const mopOnly = { clean_mode: "mop", fan_speed: "Max", water_level: "High", clean_passes: 1 };
  assert.deepEqual(savedSettings(mopOnly), ["mop", "Max suction", "water High", "1 pass"]);
  assert.deepEqual(savedSettings({}), []);
  assert.deepEqual(savedSettings({ water_level_range: [1, 32], water_level: 12 }), ["water 12"]);
  assert.deepEqual(savedSettings({ edge_mopping: true }), [], "edge mopping only where the robot supports it");
});

// RED IF: starting a room leaves another room selected (both would run), or the
// start goes to the wrong map.
test("starting a room clears the robot's other selections, selects it, then starts its map", () => {
  const rooms = roomsFor(states, "vacuum.alfred");
  const kitchen = rooms.find((r) => r.name === "Kitchen");
  const alreadyOn = rooms.filter((r) => r.selected && r !== kitchen);
  const calls = startCalls(rooms, kitchen, "vacuum.alfred");
  assert.deepEqual(calls.slice(0, alreadyOn.length).map((c) => [c.service, c.data.entity_id]),
    alreadyOn.map((r) => ["turn_off", r.entity_id]));
  assert.deepEqual(calls.at(-2), { domain: "switch", service: "turn_on", data: { entity_id: kitchen.entity_id } });
  assert.deepEqual(calls.at(-1), { domain: "eufy_vacuum", service: "start_selected_rooms",
    data: { vacuum_entity_id: "vacuum.alfred", map_id: kitchen.map_id } });
});

test("a room that is already the only one selected just starts", () => {
  const room = { entity_id: "switch.a", selected: true, map_id: "7" };
  assert.deepEqual(startCalls([room], room, "vacuum.x").map((c) => c.service), ["start_selected_rooms"]);
  assert.deepEqual(startCalls([room], { ...room, map_id: null }, "vacuum.x"), []);
});

// RED IF: the name ignores what the house calls the robot in its sidebar.
test("a robot is named by its VA panel, else by its entity", () => {
  assert.equal(robotName(panels, "vacuum.alfred", states), "Eufy Alfred");
  assert.equal(robotName(panels, "vacuum.robin", states), "Robin Dreame");
  assert.equal(robotName({}, "vacuum.alfred", states), states["vacuum.alfred"].attributes.friendly_name);
  assert.equal(robotName({}, "vacuum.nobody", {}), "vacuum.nobody");
});

/* ------------------------------------------------------------- one room */

// RED IF: a room is matched on its exact spelling - Ivy's map says "KITCHEN",
// "LIVINGROOM" and "Bryan", and those would each lose a robot.
test("one house room finds its match on each robot's map", () => {
  const match = (room, names) => Object.fromEntries(
    roomAcrossRobots(states, room, names).map((e) => [e.vacuum, e.room?.name ?? null]));
  assert.deepEqual(match("Kitchen"), { "vacuum.alfred": "Kitchen", "vacuum.ivy": "KITCHEN", "vacuum.robin": "Kitchen" });
  assert.deepEqual(match("Living Room"), { "vacuum.alfred": "Living Room", "vacuum.ivy": "LIVINGROOM", "vacuum.robin": "Living Room" });
  assert.deepEqual(match("Bryan's Room"), { "vacuum.alfred": "Bryan's Room", "vacuum.ivy": "Bryan", "vacuum.robin": "Bryan's Room" });
  assert.deepEqual(match("Cat Room"), { "vacuum.alfred": "Cat Room", "vacuum.ivy": "Cat room", "vacuum.robin": "Cat Room" });
});

// RED IF: names that share nothing are guessed at (e.g. "Office" taken to be any
// room containing it) instead of left unmatched until declared.
test("a room a robot names differently is unmatched until the tile declares it", () => {
  const office = roomAcrossRobots(states, "Office");
  assert.equal(office.find((e) => e.vacuum === "vacuum.alfred").room, null, "Alfred calls it Home Office");
  const declared = roomAcrossRobots(states, "Office", { "vacuum.alfred": "Home Office" });
  assert.equal(declared.find((e) => e.vacuum === "vacuum.alfred").room.name, "Home Office");
  const hc = roomAcrossRobots(states, "Heidi & Chris", { "vacuum.alfred": "Master bedroom" });
  assert.deepEqual(hc.map((e) => e.room?.name), ["Master bedroom", "Heidi & Chris", "Heidi & Chris"]);
});

test("the room key ignores case, apostrophes and the word room - and nothing else", () => {
  assert.equal(roomKey("LIVINGROOM"), roomKey("Living Room"));
  assert.equal(roomKey("Bryan’s Room"), roomKey("Bryan"));
  assert.notEqual(roomKey("Office"), roomKey("Home Office"));
  assert.equal(roomKey(""), "");
});

test("last cleaned is the latest across robots, with who did it", () => {
  const e = [{ vacuum: "a", room: { lastCleaned: "2026-08-01T00:00:00Z" } },
    { vacuum: "b", room: { lastCleaned: "2026-08-09T00:00:00Z" } }, { vacuum: "c", room: null }];
  assert.deepEqual(lastCleanedAcross(e), { at: Date.parse("2026-08-09T00:00:00Z"), vacuum: "b" });
  assert.equal(lastCleanedAcross([{ vacuum: "c", room: null }]), null);
});
