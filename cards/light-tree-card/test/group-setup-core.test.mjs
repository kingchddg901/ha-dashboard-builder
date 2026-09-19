/**
 * Tests for light group setup: the candidates, the loop guard, and the calls
 * that make Home Assistant build or change a group helper. The flow steps are
 * the ones measured on this box (2026.9.2) by walking both flows to their forms
 * and aborting them.
 *
 *   node --test cards/light-tree-card/test/group-setup-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  lightGroupsIn, wouldLoop, candidates, containedBy, createLightGroup, setLightGroupMembers, deleteGroupEntry,
} from "../group-setup-core.js";

const { states } = JSON.parse(readFileSync(new URL("./lights.fixture.json", import.meta.url), "utf8"));
// The registry as the frontend has it: the house's groups are group helpers.
const entities = Object.fromEntries(Object.keys(states).map((id) => [id, {
  entity_id: id, platform: Array.isArray(states[id].attributes.entity_id) ? "group" : "tuya", device_id: `d_${id}`,
}]));
entities["light.kitchen"].area_id = "kitchen";
const areas = { kitchen: { name: "Kitchen" } };

test("the house's light groups are its group helpers, with their members", () => {
  const g = lightGroupsIn(states, entities);
  assert.equal(g.length, 8);
  assert.deepEqual(g.find((x) => x.id === "light.hall_master").members,
    ["light.hall_front_2", "light.hall_middle", "light.hall_back"]);
});

// RED IF: a group may be put inside itself, directly or through another group
// - HA would build a loop of groups.
test("a group can never contain itself, however deep", () => {
  assert.equal(wouldLoop("light.hall_master", "light.hall_master", states), true);
  assert.equal(wouldLoop("light.hall_back", "light.main_house", states), true, "Main house holds Hall back, three levels down");
  assert.equal(wouldLoop("light.hall_back", "light.office", states), false);
  assert.equal(wouldLoop(null, "light.main_house", states), false, "a new group contains nothing yet");
});

// RED IF: the candidates hide the facts that decide "add or not" - what a light
// is already in, whether it can dim - or leave out lights that are grouped.
test("candidates show every light, members first, with what decides add-or-not", () => {
  const rows = candidates({ states, entities, areas }, { group: "light.bathroom", members: ["light.bathroom3", "light.bathroom1"] });
  assert.deepEqual(rows.slice(0, 2).map((r) => r.id), ["light.bathroom3", "light.bathroom1"], "members first, in their order");
  assert.ok(!rows.some((r) => r.id === "light.bathroom"), "not itself");
  const kitchen = rows.find((r) => r.id === "light.kitchen");
  assert.equal(kitchen.dimmable, false);
  assert.equal(kitchen.area, "Kitchen");
  assert.deepEqual(kitchen.inGroups, ["Main house"]);
  const hall = rows.find((r) => r.id === "light.hall_master");
  assert.equal(hall.isGroup, true);
  assert.equal(hall.size, 3);
  assert.equal(rows.find((r) => r.id === "light.main_house").loop, false, "bathroom is not inside Main house");
});

test("a new group offers everything, nothing ticked, nothing looped", () => {
  const rows = candidates({ states, entities }, {});
  assert.equal(rows.length, Object.keys(states).length);
  assert.ok(rows.every((r) => !r.member && !r.loop));
});

test("deleting a group warns about the groups that hold it", () => {
  assert.deepEqual(containedBy("light.hall_back", states, entities), ["Hall master"]);
  assert.deepEqual(containedBy("light.main_house", states, entities), []);
});

/* ---------------------------------------------------------------- the calls */

function fakeApi(script) {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    const next = script.shift();
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(method, path, body) : next;
  };
  return { api, calls };
}

// RED IF: the create sequence differs from HA's group flow - menu, "light",
// then the form - or a failed create leaves a flow open.
test("creating a group walks HA's own flow: menu, light, then the form", async () => {
  const { api, calls } = fakeApi([
    { type: "menu", flow_id: "f1", step_id: "user" },
    { type: "form", flow_id: "f1", step_id: "light" },
    { type: "create_entry", result: { entry_id: "e9", title: "Porch" } },
  ]);
  const entry = await createLightGroup(api, { name: "  Porch ", entities: ["light.a", "light.b"] });
  assert.equal(entry.entry_id, "e9");
  assert.deepEqual(calls.map((c) => [c[0], c[1]]), [
    ["POST", "config/config_entries/flow"], ["POST", "config/config_entries/flow/f1"], ["POST", "config/config_entries/flow/f1"]]);
  assert.deepEqual(calls[0][2], { handler: "group", show_advanced_options: false });
  assert.deepEqual(calls[1][2], { next_step_id: "light" });
  assert.deepEqual(calls[2][2], { name: "Porch", entities: ["light.a", "light.b"], hide_members: false, all: false });
});

test("a create that fails part-way closes its flow and says why", async () => {
  const { api, calls } = fakeApi([
    { type: "menu", flow_id: "f2", step_id: "user" },
    { type: "form", flow_id: "f2", step_id: "light" },
    { type: "form", flow_id: "f2", step_id: "light", errors: { base: "unknown" } },
    null,
  ]);
  await assert.rejects(createLightGroup(api, { name: "X", entities: ["light.a"] }), /unknown/);
  assert.deepEqual(calls.at(-1).slice(0, 2), ["DELETE", "config/config_entries/flow/f2"]);
  await assert.rejects(createLightGroup(api, { name: " ", entities: ["light.a"] }), /name/);
  await assert.rejects(createLightGroup(api, { name: "X", entities: [] }), /at least one/);
});

// RED IF: editing members resets the group's other settings (hide members, all
// on) - only the members were asked to change.
test("editing members keeps the group's other settings exactly as they were", async () => {
  const { api, calls } = fakeApi([
    { type: "form", flow_id: "o1", step_id: "light", data_schema: [
      { name: "entities", description: { suggested_value: ["light.a"] } },
      { name: "hide_members", description: { suggested_value: true }, default: false },
      { name: "all", description: { suggested_value: false }, default: false },
    ] },
    { type: "create_entry" },
  ]);
  await setLightGroupMembers(api, "entry7", ["light.a", "light.b"]);
  assert.deepEqual(calls[0].slice(0, 3), ["POST", "config/config_entries/options/flow", { handler: "entry7", show_advanced_options: false }]);
  assert.deepEqual(calls[1][2], { hide_members: true, all: false, entities: ["light.a", "light.b"] });
  await assert.rejects(setLightGroupMembers(api, "entry7", []), /delete it instead/);
});

test("deleting removes the helper's config entry", async () => {
  const { api, calls } = fakeApi([null]);
  await deleteGroupEntry(api, "e5");
  assert.deepEqual(calls[0], ["DELETE", "config/config_entries/entry/e5", undefined]);
});
