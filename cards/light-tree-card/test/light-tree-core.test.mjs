/**
 * Tests for the light tree, read against this house's real groups (captured
 * 2026-09-19): Main house over Entryway, Hall master (three fixtures of two
 * bulbs), Kitchen (on/off only), Living room (three), Office and Dining room;
 * Bathroom as a three-light fixture on its own.
 *
 *   node --test cards/light-tree-card/test/light-tree-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  lightNode, leaves, promise, litCount, rowState, visibleRows, toggleCall, levelCall, levelAt,
  treeSummary, MAX_DEPTH, gestureResult,
} from "../light-tree-core.js";

const { states } = JSON.parse(readFileSync(new URL("./lights.fixture.json", import.meta.url), "utf8"));

// RED IF: nesting is flattened or cut short - Hall master is three fixtures of
// two bulbs each, so the house is three levels deep.
test("the house's groups come back as the tree they are", () => {
  const house = lightNode("light.main_house", states);
  assert.deepEqual(house.members.map((m) => m.id), ["light.entryway", "light.hall_master", "light.kitchen",
    "light.living_room", "light.office", "light.dinning_room"]);
  const hall = house.members[1];
  assert.deepEqual(hall.members.map((m) => m.members.length), [2, 2, 2]);
  assert.equal(leaves(house).length, 2 + 6 + 1 + 3 + 1 + 1);
});

// RED IF: the parent's own report is trusted - it claims colour for everything
// while the kitchen can only switch.
test("a parent promises from its members, and names the ones that cannot dim", () => {
  const house = lightNode("light.main_house", states);
  assert.equal(house.dimmable, true, "the group's own report says dimmable");
  const p = promise(house);
  assert.equal(p.total, 14);
  assert.equal(p.dimmable, 13);
  assert.deepEqual(p.onOffOnly, ["Kitchen"]);
  const kitchen = house.members.find((m) => m.id === "light.kitchen");
  assert.equal(kitchen.dimmable, false);
});

test("the lit count comes from the bulbs, not from the group's single on/off", () => {
  const house = lightNode("light.main_house", states);
  const want = leaves(house).filter((l) => l.state === "on").length;
  assert.equal(litCount(house).lit, want);
  assert.equal(litCount(house).total, 14);
  assert.equal(treeSummary(house), `${want} of 14 lit`);
});

// RED IF: a member the group names but HA does not have is dropped - the count
// would quietly shrink and the missing light would never be noticed.
test("a missing member is kept, shown unavailable, and counted as not answering", () => {
  const broken = { ...states, "light.bathroom": { ...states["light.bathroom"],
    attributes: { ...states["light.bathroom"].attributes, entity_id: ["light.bathroom1", "light.gone"] } } };
  const b = lightNode("light.bathroom", broken);
  assert.deepEqual(b.members.map((m) => [m.id, m.missing]), [["light.bathroom1", false], ["light.gone", true]]);
  assert.equal(rowState(b.members[1]), "unavailable");
  assert.equal(litCount(b).missing, 1);
  assert.match(treeSummary(b), /1 not answering/);
});

test("a group that contains itself stops instead of recursing forever", () => {
  const loop = { "light.a": { state: "on", attributes: { entity_id: ["light.b"] } },
    "light.b": { state: "on", attributes: { entity_id: ["light.a"] } } };
  const a = lightNode("light.a", loop);
  assert.equal(a.members[0].members[0].id, "light.a");
  assert.deepEqual(a.members[0].members[0].members, []);
  assert.ok(MAX_DEPTH >= 3);
});

test("only open groups show their members", () => {
  const house = lightNode("light.main_house", states);
  assert.equal(visibleRows(house).length, 1);
  const open = new Set(["light.main_house", "light.hall_master"]);
  const rows = visibleRows(house, open);
  assert.equal(rows.length, 1 + 6 + 3);
  assert.deepEqual(rows.filter((r) => r.depth === 2).map((r) => r.node.id),
    ["light.hall_front_2", "light.hall_middle", "light.hall_back"]);
});

// RED IF: a drag to the far left sets 0% "on" (a light on at nothing), or a
// level over 100 is sent.
test("a drag becomes a brightness, and the far left is off", () => {
  const n = { id: "light.office" };
  assert.deepEqual(levelCall(n, 62), { domain: "light", service: "turn_on", data: { entity_id: "light.office", brightness_pct: 62 } });
  assert.equal(levelCall(n, 0).service, "turn_off");
  assert.equal(levelCall(n, 250).data.brightness_pct, 100);
  assert.equal(levelAt(150, 100, 200), 25);
  assert.equal(levelAt(50, 100, 200), 0);
  assert.equal(levelAt(400, 100, 200), 100);
});

// RED IF: a swipe across an on/off-only light switches it. Found in the harness:
// a sideways drag on the Kitchen row turned the kitchen off.
test("a swipe that cannot dim does nothing; only a press that stays put toggles", () => {
  assert.equal(gestureResult({ moved: false, canDim: false }), "toggle");
  assert.equal(gestureResult({ moved: false, canDim: true, level: 40 }), "toggle");
  assert.equal(gestureResult({ moved: true, canDim: true, level: 40 }), "level");
  assert.equal(gestureResult({ moved: true, canDim: false, level: null }), "none");
  assert.equal(gestureResult({ moved: true, canDim: true, level: null }), "none");
});

test("a tap toggles; a lit group turns everything beneath it off", () => {
  assert.equal(toggleCall({ id: "light.x", state: "on" }).service, "turn_off");
  assert.equal(toggleCall({ id: "light.x", state: "off" }).service, "turn_on");
});

test("the four states stay four", () => {
  assert.equal(rowState({ state: "on" }), "on");
  assert.equal(rowState({ state: "off" }), "off");
  assert.equal(rowState({ state: "unavailable" }), "unavailable");
  assert.equal(rowState({ state: "unknown" }), "unknown");
});
