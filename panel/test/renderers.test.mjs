/**
 * Tests for the renderer registry: the closed set a tile can name, and the
 * phone-row summaries, read against the shared level-1 fixture.
 *
 *   node --test panel/test/renderers.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { RENDERERS, rendererFor } from "../renderers.js";
import { SEED } from "../seed.js";

const hass = JSON.parse(readFileSync(
  new URL("../../cards/builder-debug-card/test/hass.fixture.json", import.meta.url), "utf8"));

// RED IF: the starting layout names a renderer nobody registered - that tile
// would show "no renderer" on every first visit.
test("every tile in the starting layout names a registered renderer", () => {
  for (const tab of SEED.tabs) {
    for (const t of tab.tiles) assert.ok(rendererFor(t.kind), `${t.id}: ${t.kind}`);
  }
});

// RED IF: a renderer is registered without a way to show itself or summarise
// itself - the phone view and the desk view would disagree about what exists.
test("every renderer can summarise itself and render itself", () => {
  for (const [kind, r] of Object.entries(RENDERERS)) {
    assert.equal(typeof r.summary, "function", kind);
    assert.ok(typeof r.html === "function" || (typeof r.load === "function" && r.tag), kind);
    assert.ok(r.label, kind);
  }
});

test("an appliance row is the core's own summary", () => {
  const s = RENDERERS.appliance.summary(hass, { fan: "fan.ceiling_fan", light: "light.ceiling_fan_calibrated" });
  assert.ok(s.text.startsWith("fan off · resumes at 4 · light "), s.text);
  assert.equal(s.state, hass.states["light.ceiling_fan_calibrated"].state === "on" ? "on" : "off");
});

// RED IF: a declared entity that does not exist reads as merely "off" - a
// renamed entity would then look like a light that is simply not on.
test("a declared entity that is missing makes the row unavailable, and says so", () => {
  const s = RENDERERS.appliance.summary(hass, { light: "light.renamed_away" });
  assert.equal(s.state, "unavailable");
  assert.match(s.text, /missing entity/);
  const t = RENDERERS.tv.summary(hass, { media_player: "media_player.gone" });
  assert.equal(t.state, "unavailable");
});

test("a TV row is the TV core's summary", () => {
  const s = RENDERERS.tv.summary(hass, { media_player: "media_player.big_tv_2" });
  // `text` is read by a person and is sentence case; `state` is a marker the
  // row styles itself with, and stays a lower-case token. RED IF they are
  // conflated - capitalising the marker would silently drop the row's styling.
  assert.equal(s.text, "Off");
  assert.equal(s.state, "off");
});
