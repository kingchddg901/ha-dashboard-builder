/**
 * Tests for panel themes: the theme and token tables against the mined files,
 * contrast, the rescue of status colours that vanish on their own background,
 * the value layers, and the kit building the theme tab from the token groups.
 *
 *   node --test panel/test/theme-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { THEMES, ROLE_VARS } from "../themes.js";
import { TOKEN_GROUPS } from "../token-groups.js";
import { OWN_THEMES } from "../own-themes.js";
import { FRAMES, NOT_DRAWN } from "../panel-tokens.js";
import {
  parseColor, contrast, legibleOn, legibleStatus, MIN_STATUS_CONTRAST,
  THEME_GROUPS, THEME_TOKENS, activeFrame, frameFor, baseValues, groupsWithDefaults, paintVars, statusVerdicts, textPairs,
  drawnVerdicts,
} from "../theme-core.js";
import { createThemeKit } from "../../vendor/token-theme-kit/src/kit.js";
import { resetValues } from "../../vendor/token-theme-kit/src/reset.js";
import { cvdValidator } from "../../vendor/token-theme-kit/src/plugins/cvd.js";

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

// RED IF: the generated groups drift from core-tokens.json (re-mined, not regenerated).
test("the token groups are core-tokens.json, token for token, with readable labels", () => {
  assert.deepEqual(TOKEN_GROUPS.map((g) => [g.id, g.label, g.tokens.length]),
    core.groups.map((g) => [g.id, g.label, g.tokens.length]));
  core.groups.forEach((g, i) => g.tokens.forEach((t, j) => {
    const mine = TOKEN_GROUPS[i].tokens[j];
    for (const k of ["key", "type", "cssVar", "default", "unit", "min", "max", "step"]) assert.deepEqual(mine[k], t[k], `${t.key}.${k}`);
  }));
  assert.equal(THEME_TOKENS.find((t) => t.key === "ui-primary-text").label, "UI primary text");
});

// RED IF: following HA shows the mined default where HA's theme sets the value,
// a length comes back as NaN, or HA's value beats a theme you picked.
test("the base: a picked theme, else Home Assistant's theme, else the mined default", () => {
  const ha = { "--lcars-ui-primary": " #abcdef", "--lcars-vertical-border": "40px",
    "--lcars-horizontal-border": "wide", "--warning-color": "rgb(255, 0, 0)" };
  const read = (v) => ha[v] ?? "";
  const follow = baseValues(THEME_TOKENS, { read });
  assert.equal(follow["ui-primary"], "#abcdef");
  assert.equal(follow["vertical-border"], 40);
  assert.equal(follow["horizontal-border"], 10, "unreadable: the mined default");
  assert.equal(follow.warning, "#ff0000");
  assert.equal(follow["ui-secondary"], THEME_TOKENS.find((t) => t.key === "ui-secondary").default);
  const romulus = THEMES["LCARS Romulus"];
  const picked = baseValues(THEME_TOKENS, { preset: romulus, read });
  assert.equal(picked["ui-primary"], romulus["ui-primary"]);
  assert.equal(picked["vertical-border"], 40, "a theme sets no shape, so HA's stands");
});

// RED IF: a token nobody chose is written onto the panel - that pins it to
// today's value, and a later change to Home Assistant's theme never arrives.
test("the panel writes only what was chosen, and the status floor holds for your choices too", () => {
  const readable = { "--warning-color": "#ffcc66", "--error-color": "#ff4444" };
  const base = baseValues(THEME_TOKENS, { read: (v) => readable[v] ?? "" });
  assert.deepEqual(paintVars(THEME_TOKENS, { base }), {});
  assert.deepEqual(paintVars(THEME_TOKENS, { base, overrides: { "vertical-border": 48, "ui-accent": "#00ff00" } }),
    { "--lcars-vertical-border": "48px", "--lcars-ui-accent-color": "#00ff00" });
  const tng = THEMES["LCARS TNG"];
  const vars = paintVars(THEME_TOKENS, { base: baseValues(THEME_TOKENS, { preset: tng }), preset: tng });
  assert.equal(Object.keys(vars).length, Object.keys(tng).length, "a picked theme writes every colour it sets");
  const own = paintVars(THEME_TOKENS, { base, overrides: { warning: "#360000" } });
  assert.ok(contrast(own["--warning-color"], "#000000") >= MIN_STATUS_CONTRAST, own["--warning-color"]);
});

test("the editor is told when a status colour will be shown differently, and to what", () => {
  const v = statusVerdicts({ background: "#000000", warning: "#360000", success: "#33cc99" });
  assert.equal(v.length, 1);
  assert.equal(v[0].key, "warning");
  assert.match(v[0].message, new RegExp(legibleOn("#360000", "#000000")));
});

// RED IF: the groups are registered with the MINED defaults - the editor then
// shows colours that are not on screen, and a reset lands on LCARS Transporter
// instead of the theme you picked.
test("the kit builds the theme tab from the groups, and a reset lands on the picked theme", () => {
  const romulus = THEMES["LCARS Romulus"];
  const mined = THEME_TOKENS.find((t) => t.key === "ui-primary").default;
  assert.notEqual(romulus["ui-primary"], mined, "precondition: the two are distinguishable");
  const kit = createThemeKit();
  for (const g of groupsWithDefaults(THEME_GROUPS, baseValues(THEME_TOKENS, { preset: romulus }))) kit.registerTokenGroup(g);
  const model = kit.editorModel({});
  assert.deepEqual(model.groups.map((g) => g.id), THEME_GROUPS.map((g) => g.id));
  const controls = model.groups.flatMap((g) => g.controls);
  assert.equal(controls.length, THEME_TOKENS.length);
  const input = Object.fromEntries(controls.map((c) => [c.key, c.input]));
  assert.deepEqual([input["ui-primary"], input["vertical-border"], input.font], ["color", "number", "text"]);
  assert.equal(model.values["ui-primary"], romulus["ui-primary"]);
  const changed = { "ui-primary": "#123456" };
  assert.equal(kit.editorModel(changed).values["ui-primary"], "#123456");
  assert.equal(kit.editorModel(resetValues(changed, ["ui-primary"]).values).values["ui-primary"], romulus["ui-primary"]);
});

// RED IF: the pairs come out empty - then text can be dragged into its own
// background with no warning, the one gesture that hides the editor itself.
test("text that matches its own background is flagged on the control", () => {
  const pairs = textPairs(THEME_TOKENS);
  assert.ok(pairs.some((p) => p.fg === "background-text" && p.bg === "background"));
  const kit = createThemeKit();
  for (const g of TOKEN_GROUPS) kit.registerTokenGroup(g);
  kit.registerValidator(cvdValidator({ pairs }));
  const verdictsOn = (values, key) => kit.editorModel(values).groups.flatMap((g) => g.controls).find((c) => c.key === key).verdicts;
  assert.equal(verdictsOn({}, "background-text").length, 0);
  assert.equal(verdictsOn({ "background-text": "#000000" }, "background-text").length, 1);
});

// RED IF: two tokens write the same variable, or a `follows` / `byFrame` names
// something that does not exist - each fails silently on screen.
test("the panel's own tokens are well formed beside the mined ones", () => {
  const keys = THEME_TOKENS.map((t) => t.key);
  const vars = THEME_TOKENS.map((t) => t.cssVar);
  assert.equal(new Set(keys).size, keys.length, "keys are unique");
  assert.equal(new Set(vars).size, vars.length, "variables are unique");
  const frames = FRAMES.map((f) => f.value);
  for (const t of THEME_TOKENS) {
    if (t.follows) assert.ok(keys.includes(t.follows) && !THEME_TOKENS.find((u) => u.key === t.follows).follows, `${t.key} follows ${t.follows}`);
    for (const f of Object.keys(t.byFrame || {})) assert.ok(frames.includes(f), `${t.key}: unknown frame ${f}`);
  }
  assert.equal(frameFor("cockpit"), "cockpit");
  assert.equal(frameFor("x-wing"), "lcars", "an unknown frame draws as LCARS");
});

// RED IF: a follower ignores what it follows - the tile surface would then show
// the mined black under a theme whose background is not black.
test("a following token takes its leader's value until one is chosen", () => {
  const base = baseValues(THEME_TOKENS, { read: (v) => (v === "--lcars-background-color" ? "#123456" : "") });
  assert.equal(base["tile-surface"], "#123456");
  assert.equal(baseValues(THEME_TOKENS, { preset: { background: "#123456", "tile-surface": "#222222" } })["tile-surface"], "#222222");
  assert.deepEqual(paintVars(THEME_TOKENS, { base: { ...base, warning: "#ffcc66", error: "#ff4444" } }), {},
    "an unchosen follower is not written - CSS falls back to its leader");
});

// RED IF: a panel token is named for a frame ("Chamfer (cockpit frame)") - the
// next frame to use it would either wear another frame's name or grow a twin.
test("panel tokens are named for what they are, not for a frame", () => {
  const frameWords = FRAMES.flatMap((f) => [f.value, f.label]).map((w) => w.toLowerCase());
  for (const g of THEME_GROUPS.filter((g) => g.id.startsWith("panel-"))) {
    for (const t of g.tokens) {
      for (const w of frameWords) {
        assert.ok(!t.key.toLowerCase().includes(w) && !t.label.toLowerCase().includes(w), `${t.key} / "${t.label}" names the ${w} frame`);
      }
    }
  }
});

// RED IF: the frame alone does not reshape the panel, or choosing it leaks into
// the base - then a reset would not return to the frame you started from.
test("the frame is the master token: choosing it brings its shape, a reset takes it back", () => {
  const cockpit = { frame: "cockpit" };
  const base = baseValues(THEME_TOKENS, { overrides: cockpit });
  assert.equal(base.frame, "lcars", "the base keeps the starting frame");
  assert.equal(activeFrame(base, cockpit), "cockpit");
  assert.equal(base["tab-radius"], 3, "the editor shows the cockpit's corner as the default");
  const vars = paintVars(THEME_TOKENS, { base, overrides: cockpit });
  assert.equal(vars["--db-tab-radius"], "3px");
  assert.equal(vars["--db-control-radius"], "3px");
  const own = paintVars(THEME_TOKENS, { base, overrides: { ...cockpit, "tab-radius": 9 } });
  assert.equal(own["--db-tab-radius"], "9px", "a value set by hand beats the frame's");
  const lcars = baseValues(THEME_TOKENS, {});
  assert.equal(lcars["tab-radius"], 0);
  assert.ok(!("--db-tab-radius" in paintVars(THEME_TOKENS, { base: lcars })), "the LCARS frame writes no shape");
});

// RED IF: a starting theme names a token that does not exist (it silently does
// nothing), takes a mined theme's name, or trips its own warnings the moment it
// is picked.
test("the panel's own starting themes are sound", () => {
  const keys = new Set(THEME_TOKENS.map((t) => t.key));
  const pairs = textPairs(THEME_TOKENS);
  for (const [name, theme] of Object.entries(OWN_THEMES)) {
    assert.ok(!(name in THEMES), `${name} collides with a mined theme`);
    for (const k of Object.keys(theme)) assert.ok(keys.has(k), `${name}: no token ${k}`);
    const values = baseValues(THEME_TOKENS, { preset: theme });
    assert.equal(frameFor(values.frame), values.frame, `${name}: unknown frame`);
    assert.deepEqual(statusVerdicts(values), [], `${name}: a status colour needs lifting`);
    for (const p of pairs) {
      const r = contrast(values[p.fg], values[p.bg]);
      assert.ok(r >= 4.5, `${name}: ${p.label} is ${r?.toFixed(2)}:1`);
    }
  }
  assert.equal(OWN_THEMES["Black One"].frame, "cockpit");
});


// RED IF: a frame both skips a token and gives it a default (a dead value the
// editor shows as if it mattered - the cockpit's tile corners were exactly
// that), or a declaration names a token that does not exist.
test("what a frame skips is declared cleanly", () => {
  const keys = new Set(THEME_TOKENS.map((t) => t.key));
  for (const k of NOT_DRAWN) assert.ok(keys.has(k), `NOT_DRAWN: no token ${k}`);
  for (const f of FRAMES) {
    for (const k of f.skips) {
      assert.ok(keys.has(k), `${f.value} skips unknown token ${k}`);
      assert.ok(!NOT_DRAWN.includes(k), `${k} is already drawn by no frame`);
      const t = THEME_TOKENS.find((x) => x.key === k);
      assert.ok(!(t.byFrame && f.value in t.byFrame), `${f.value} skips ${k} yet gives it a default`);
    }
  }
  for (const k of NOT_DRAWN) assert.ok(!THEME_TOKENS.find((t) => t.key === k).byFrame, `${k}: a frame default on an undrawn token`);
});

// RED IF: the notes do not follow the frame - switching to the cockpit would
// leave "Chamfer" marked unused and the tile corners looking live.
test("the theme tab marks what the active frame does not draw with", () => {
  const marked = (frame) => new Set(drawnVerdicts({ frame }).map((v) => v.key));
  const lcars = marked("lcars");
  const cockpit = marked("cockpit");
  assert.ok(lcars.has("chamfer") && !cockpit.has("chamfer"));
  assert.ok(cockpit.has("tile-radius") && !lcars.has("tile-radius"));
  for (const k of NOT_DRAWN) assert.ok(lcars.has(k) && cockpit.has(k), `${k} unmarked`);
  assert.ok(!lcars.has("frame") && !cockpit.has("frame"), "the frame control itself is always live");
  assert.match(drawnVerdicts({ frame: "cockpit" }).find((v) => v.key === "chamfer" || v.key === "tile-radius").message, /Cockpit frame/);
});
