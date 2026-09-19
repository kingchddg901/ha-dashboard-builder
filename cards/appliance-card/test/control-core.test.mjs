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
  layoutFor, axisFor, mixToCommand, setSaturation, colorToMix, RGB_WHITE_TRAP_SATURATION,
  PRESET_SLOTS, encodeSlots, decodeSlots, slotCommand, slotFromLight,
  lightSummary, fanSummary, groupSummary, applianceSummary,
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

/* -------------------------------------------------------------- speed mode */

// RED IF: the integration's claim outranks the user's choice. The local fan says
// six notches; a user who wants a slider gets a slider.
test("linear gives a slider even when the integration says notches", () => {
  const c = speedControl(rec("fan.ceiling_fan"), { mode: "linear" });
  assert.equal(c.kind, "slider");
  assert.equal(c.source, "declared");
});

test("steps gives notches even when the integration claims a hundred positions", () => {
  const cloudFan = { state: "off", capabilities: { percentage_step: 1.0 }, raw: { percentage: 60 } };
  const c = speedControl(cloudFan, { mode: "steps", steps: 6 });
  assert.equal(c.kind, "notches");
  assert.equal(c.count, 6);
  assert.equal(c.source, "declared");
});

test("steps with no count uses the count the integration implies", () => {
  const c = speedControl(rec("fan.ceiling_fan"), { mode: "steps" });
  assert.equal(c.count, 6);
  assert.equal(c.source, "percentage_step");
});

test("auto is what it always was", () => {
  assert.deepEqual(speedControl(rec("fan.ceiling_fan"), { mode: "auto" }), speedControl(rec("fan.ceiling_fan")));
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

/* ------------------------------------------------------------------ mixer */

// RED IF: a fader's level leaks into the colour. HA drives this light by hue and
// saturation, which cannot tell R 40 from R 100 - so both must send the same RED,
// and only the brightness may differ.
test("a lower fader is the same colour, dimmer", () => {
  const full = mixToCommand({ r: 100, g: 0, b: 0 });
  const low = mixToCommand({ r: 40, g: 0, b: 0 });
  assert.deepEqual(full.rgb_color, [255, 0, 0]);
  assert.deepEqual(low.rgb_color, [255, 0, 0]);
  assert.equal(full.brightness_pct, 100);
  assert.equal(low.brightness_pct, 40);
});

// RED IF: three faders at 100 are treated as brighter than one. Colour mode
// normalises total drive to about one channel's worth, so white-from-RGB and a
// pure colour at the same top fader are the same brightness.
test("all three at 100 is white at the same brightness as one at 100", () => {
  const w = mixToCommand({ r: 100, g: 100, b: 100 });
  assert.deepEqual(w.rgb_color, [255, 255, 255]);
  assert.equal(w.brightness_pct, 100);
  assert.equal(w.saturation, 0);
  assert.equal(w.hue, null);
});

test("the master scales the level and never the colour", () => {
  const c = mixToCommand({ r: 100, g: 50, b: 0 }, { power: 50 });
  assert.deepEqual(c.rgb_color, [255, 128, 0]);
  assert.equal(c.brightness_pct, 50);
});

// RED IF: all faders down sends a black colour instead of turning the light off.
test("every fader down, or the master down, is off", () => {
  assert.equal(mixToCommand({ r: 0, g: 0, b: 0 }).off, true);
  assert.equal(mixToCommand({ r: 100, g: 0, b: 0 }, { power: 0 }).off, true);
});

// RED IF: the saturation handle moves the hue or the top fader. It may only slide
// the two lower faders.
test("saturation keeps the hue and the top fader", () => {
  assert.deepEqual(setSaturation({ r: 100, g: 0, b: 0 }, 0.5), { r: 100, g: 50, b: 50 });
  const orange = { r: 100, g: 50, b: 0 };
  const half = setSaturation(orange, 0.5);
  assert.equal(Math.max(half.r, half.g, half.b), 100, "top fader unchanged");
  const before = mixToCommand(orange).hue;
  const after = mixToCommand(half).hue;
  assert.ok(Math.abs(before - after) < 1.5, `hue drifted ${before} -> ${after}`);
});

test("a grey has no hue to keep, so saturation leaves it alone", () => {
  assert.deepEqual(setSaturation({ r: 60, g: 60, b: 60 }, 1), { r: 60, g: 60, b: 60 });
});

// RED IF: the desk opens somewhere other than where the light is. This is the
// measured state of a real light, left at hue 239.5 and saturation 100.
test("the desk opens at the live colour, and round-trips", () => {
  const blue = { state: "on", raw: { hs_color: [239.528, 100.0], brightness: 169 } };
  const mix = colorToMix(blue);
  assert.equal(mix.known, true);
  assert.equal(mix.power, 66);
  assert.equal(Math.max(mix.r, mix.g, mix.b), 100);
  const back = mixToCommand(mix, { power: mix.power });
  assert.ok(Math.abs(back.hue - 239.528) < 1.5, `hue ${back.hue}`);
  assert.ok(back.saturation > 0.98);
});

// RED IF: a light that reports no colour opens the desk at an invented one.
test("no live colour opens the desk at white, marked unknown", () => {
  const m = colorToMix({ state: "on", raw: { brightness: 80 } });
  assert.equal(m.known, false);
  assert.deepEqual([m.r, m.g, m.b], [100, 100, 100]);
});

test("the RGB-white trap threshold sits low but above zero", () => {
  assert.ok(RGB_WHITE_TRAP_SATURATION > 0 && RGB_WHITE_TRAP_SATURATION < 0.25);
  assert.ok(mixToCommand({ r: 100, g: 95, b: 92 }).saturation < RGB_WHITE_TRAP_SATURATION);
});

/* ---------------------------------------------------------------- presets */

const WHITE = { mode: "temp", k: 3367, b: 31 };
const GOLD = { mode: "colour", rgb: [255, 162, 80], b: 100 };

// RED IF: a slot does not survive being stored and read back.
test("white and colour slots round-trip through the stored string", () => {
  const text = encodeSlots([WHITE, null, GOLD]);
  assert.equal(text, "v1:t3367@31|-|cFFA250@100|-|-|-|-|-");
  const back = decodeSlots(text);
  assert.equal(back.length, PRESET_SLOTS);
  assert.deepEqual(back[0], WHITE);
  assert.equal(back[1], null);
  assert.deepEqual(back[2], GOLD);
});

// RED IF: eight full slots overflow the 255-character limit of an input_text.
test("eight colour slots fit an input_text with room to spare", () => {
  const full = encodeSlots(Array.from({ length: 8 }, () => ({ mode: "colour", rgb: [255, 255, 255], b: 100 })));
  assert.ok(full.length <= 255, `${full.length} characters`);
  assert.ok(full.length < 110);
});

// RED IF: one damaged slot empties the others, or a bad string throws. The helper
// can be edited by hand in HA, so this is a real input, not a hypothetical one.
test("a damaged string loses only the unreadable slots", () => {
  const back = decodeSlots("v1:t3367@31|garbage|cFFA250@100");
  assert.deepEqual(back[0], WHITE);
  assert.equal(back[1], null);
  assert.deepEqual(back[2], GOLD);
  assert.equal(decodeSlots("").every((x) => x === null), true);
  assert.equal(decodeSlots(null).length, PRESET_SLOTS);
  assert.equal(decodeSlots(undefined).every((x) => x === null), true);
});

// RED IF: a future format is misread by old code instead of being left alone.
test("an unknown format version reads as empty rather than as garbage", () => {
  assert.equal(decodeSlots("v9:whatever|else").every((x) => x === null), true);
});

// RED IF: applying a slot sends the wrong service data.
test("a slot recreates its own state", () => {
  assert.deepEqual(slotCommand(WHITE), { color_temp_kelvin: 3367, brightness_pct: 31 });
  assert.deepEqual(slotCommand(GOLD), { rgb_color: [255, 162, 80], brightness_pct: 100 });
  assert.equal(slotCommand(null), null);
});

// RED IF: saving a colour stores what the fixture REPORTED instead of what was
// ASKED. Re-sending the reported colour would push an already-corrected value
// through the correction a second time. Measured case: goldenrod was asked as a
// mix and reported back at hue 28, sat 69.
test("saving a colour keeps the intent, not the reported outcome", () => {
  const light = { state: "on", raw: { color_mode: "hs", brightness: 255,
    hs_color: [28.03, 68.58], rgb_color: [255, 162, 80] } };
  const asked = { r: 100, g: 75, b: 0, power: 100 };
  const slot = slotFromLight(light, { mix: asked });
  assert.equal(slot.mode, "colour");
  assert.deepEqual(slot.rgb, [255, 191, 0], "the asked mix, normalised");
  assert.equal(slot.b, 100);
  // and with no desk in play, the live colour is the only source
  assert.deepEqual(slotFromLight(light).rgb, [255, 162, 80]);
});

// RED IF: the light's reported mode outranks the desk. Found in the harness: the
// light still reported colour temperature while a mix was on screen, and "save"
// stored a white. The card only passes a mix when it is showing the desk.
test("saving from the desk stores the colour even while the light still reports white", () => {
  const light = { state: "on", raw: { color_mode: "color_temp", color_temp_kelvin: 3367, brightness: 80 } };
  const slot = slotFromLight(light, { mix: { r: 100, g: 75, b: 0, power: 31 } });
  assert.equal(slot.mode, "colour");
  assert.deepEqual(slot.rgb, [255, 191, 0]);
  assert.equal(slot.b, 31);
});

test("saving a white takes the light's own kelvin and level", () => {
  const light = { state: "on", raw: { color_mode: "color_temp", color_temp_kelvin: 3367, brightness: 80 } };
  assert.deepEqual(slotFromLight(light), { mode: "temp", k: 3367, b: 31 });
});

test("an off light has nothing to save", () => {
  assert.equal(slotFromLight({ state: "off", raw: {} }), null);
});

/* --------------------------------------------------------------- summaries */

// RED IF: a lit light's glance drops its colour, or reads the wrong level.
test("a lit light's glance is its level and colour", () => {
  const r = rec("light.ceiling_fan_calibrated");
  const pct = Math.round(r.raw.brightness / 2.55);
  assert.equal(lightSummary(r), `${pct}% · ${Math.round(r.raw.color_temp_kelvin)} K`);
});

// RED IF: a remembered value is shown as though it were live, or an unknown
// return is filled with a guess.
test("an off light's glance says what it returns to, or just off", () => {
  const off = { state: "off", capabilities: { supported_color_modes: ["color_temp", "hs"] },
                raw: { brightness: null, color_temp_kelvin: null, hs_color: null } };
  assert.equal(lightSummary(off, { remembered: { pct: 31, k: 3367 } }), "off · returns to 31%, 3367 K");
  assert.equal(lightSummary(off), "off");
});

test("a binary light's glance is only on or off", () => {
  const kitchen = { state: "on", capabilities: { supported_color_modes: ["onoff"] }, raw: {} };
  assert.equal(lightSummary(kitchen), "on");
});

// RED IF: an off fan's restore value disappears, or is shown as running. The
// captured fan is off at 66 percent, which is notch 4 of 6.
test("an off fan's glance says where it resumes", () => {
  const f = rec("fan.ceiling_fan");
  assert.equal(f.state, "off");
  assert.equal(fanSummary(f), "off · resumes at 4");
  assert.equal(fanSummary({ ...f, state: "on" }), "speed 4 of 6");
});

// RED IF: a group's glance trusts the group's own state instead of counting.
test("a group's glance counts its members, and says when some are missing", () => {
  const on = { state: "on" }, off = { state: "off" }, gone = { state: "unavailable" };
  assert.equal(groupSummary([on, on, off]), "2 of 3 on");
  assert.equal(groupSummary([on, gone, off]), "1 of 3 on · 1 unavailable");
});

test("an appliance's glance joins its parts", () => {
  const s = applianceSummary({ fan: rec("fan.ceiling_fan"), light: rec("light.ceiling_fan_calibrated") });
  assert.ok(s.startsWith("fan off · resumes at 4 · light "), s);
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
test("layout follows the card's width", () => {
  assert.equal(layoutFor(320), "compact");
  assert.equal(layoutFor(420), "regular");
  assert.equal(layoutFor(900), "wide");
});

// RED IF: the axis is decided by width alone. This is the case reported from a
// phone: rotated to landscape the card is still only ~490px wide, so width says
// "regular" and a vertical notch column survives into a viewport 390px tall.
test("a short window forces the horizontal axis whatever the width says", () => {
  assert.equal(axisFor("regular", 844), "vertical", "portrait phone keeps the column");
  assert.equal(axisFor("regular", 390), "horizontal", "the same card rotated");
  // RED IF a compact card goes side by side: on a landscape phone the panel's
  // ~370px tiles did, and the TV and fan controls overlapped.
  assert.equal(axisFor("compact", 390), "vertical", "too narrow for two columns");
  assert.equal(axisFor("wide", 2000), "horizontal", "wide is horizontal regardless");
});

// RED IF: an unknown height is guessed at instead of falling back to width only.
test("no height measurement keeps the width-only behaviour", () => {
  assert.equal(axisFor("regular", undefined), "vertical");
  assert.equal(axisFor("regular", NaN), "vertical");
});

test("an unknown width falls back rather than throwing", () => {
  assert.equal(layoutFor(undefined), "regular");
});
