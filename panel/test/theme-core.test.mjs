/**
 * Tests for panel themes: the theme table against the mined files, contrast,
 * and the rescue of status colours that vanish on their own background.
 *
 *   node --test panel/test/theme-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { THEMES, ROLE_VARS } from "../themes.js";
import { parseColor, contrast, legibleOn, legibleStatus, themeVars, MIN_STATUS_CONTRAST } from "../theme-core.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const presets = read("../../tokens/lcars/presets.json").presets;
const core = read("../../tokens/lcars/core-tokens.json");

// RED IF: the table drifts from the mined themes, or a role maps to the wrong variable.
test("the theme table is the mined presets, role for role", () => {
  assert.deepEqual(Object.keys(THEMES), Object.keys(presets));
  for (const [name, p] of Object.entries(presets)) {
    assert.deepEqual({ ...THEMES[name] }, Object.fromEntries(Object.entries(p.roles).map(([k, v]) => [k, v.value])), name);
  }
  const want = Object.fromEntries(core.groups.flatMap((g) => g.tokens.map((t) => [t.key, t.cssVar])));
  assert.deepEqual({ ...ROLE_VARS }, want);
});

test("colours parse and contrast is WCAG's", () => {
  assert.deepEqual(parseColor("#ff7700"), [255, 119, 0]);
  assert.deepEqual(parseColor("#fff"), [255, 255, 255]);
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), [1, 2, 3]);
  assert.equal(parseColor("var(--x)"), null);
  assert.equal(parseColor("#12345"), null);
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.equal(contrast("#000", "nonsense"), null);
});

// RED IF: a status colour that vanishes on its background is left as it is -
// LCARS Transporter's warning #360000 on black is ~1.2:1.
test("an unreadable status colour is lifted to readable, keeping its hue", () => {
  assert.ok(contrast("#360000", "#000000") < 1.5);
  const fixed = legibleOn("#360000", "#000000");
  assert.ok(contrast(fixed, "#000000") >= MIN_STATUS_CONTRAST, fixed);
  const [r, g, b] = parseColor(fixed);
  assert.ok(r > g && r > b, `still red: ${fixed}`);
  assert.equal(legibleOn("#33cc99", "#000000"), "#33cc99", "a readable colour is left alone");
  assert.equal(legibleOn("var(--x)", "#000"), "var(--x)", "nothing is guessed");
});

// RED IF: an 8-digit hex is unreadable - a theme's warning written "#360000FF"
// would then be passed through as it is, as unreadable as ever.
test("colours with an alpha digit pair parse, so they are checked too", () => {
  assert.deepEqual(parseColor("#E7432AFF"), [231, 67, 42]);
  assert.deepEqual(parseColor("#f00f"), [255, 0, 0]);
  assert.ok(contrast(legibleOn("#360000FF", "#000000"), "#000000") >= MIN_STATUS_CONTRAST);
});

test("on a light background the lift goes toward black", () => {
  const fixed = legibleOn("#ffee88", "#ffffff");
  assert.ok(contrast(fixed, "#ffffff") >= MIN_STATUS_CONTRAST);
  assert.ok(parseColor(fixed)[0] < 0xff);
});

test("every mined theme ends up with readable status colours", () => {
  let lifted = 0;
  for (const roles of Object.values(THEMES)) {
    const fixed = legibleStatus(roles);
    for (const [k, v] of Object.entries(fixed)) {
      assert.ok(contrast(v, roles.background) >= MIN_STATUS_CONTRAST, `${k} ${v}`);
      if (v !== roles[k]) lifted++;
    }
  }
  assert.ok(lifted > 0, "the mined set does need the rescue");
});

test("a theme becomes the panel's variables", () => {
  const vars = themeVars(THEMES["LCARS 25C"]);
  assert.equal(vars["--lcars-ui-accent-color"], "#ff7700");
  assert.equal(vars["--lcars-background-color"], "#000000");
  assert.ok("--warning-color" in vars && "--error-color" in vars);
});
