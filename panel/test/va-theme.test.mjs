/**
 * Tests for reading a Vacuum Agent theme (../va-theme.js).
 *
 * The VA payloads here are SYNTHETIC - VA's export shape (themes/manager.py
 * export_theme) with invented values. Nobody else's theme is in this repo.
 *
 *   node --test panel/test/va-theme.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { readVaTheme, flatten, MAP } from "../va-theme.js";
import { THEME_TOKENS } from "../theme-core.js";

const opts = { tokens: THEME_TOKENS };

/** VA's envelope, with the pieces a test needs. */
const vaExport = ({ colors = {}, alpha = {}, tokens = {}, name = "Night shift" } = {}) => ({
  ok: true, version: 1, exported_at: "2026-09-19T07:00:00Z",
  theme: { id: "theme_4", name, source: "community", tokens, colors, alpha },
});

// RED IF: a colour's alpha is ignored. VA keeps colour and alpha in two dicts,
// so #ffffff at 0.08 is a faint wash there and a WHITE PANEL here. Flattening
// over VA's own base surface is what makes the read look like the theme.
test("a colour with alpha is flattened over VA's base, and says it was", () => {
  const got = readVaTheme(vaExport({
    colors: { "--evcc-surface-base": "#000000", "--evcc-surface-card": "#ffffff" },
    alpha: { "--evcc-surface-card": 0.08 },
  }), opts);
  assert.equal(got.ok, true);
  assert.equal(got.theme.tokens["tile-surface"], "#141414", "8% white over black");
  assert.deepEqual(got.flattened, ["tile-surface"]);
  // and a solid colour is left alone, not reported
  assert.equal(got.theme.tokens.background, "#000000");
  assert.ok(!got.flattened.includes("background"));
});

// RED IF: alpha carried IN the value is missed - VA's own editor writes rgba()
// and 8-digit hex as well as the separate dict.
test("alpha inside the value is flattened too", () => {
  assert.equal(flatten("rgba(255,255,255,0.5)", undefined, "#000000"), "#808080");
  assert.equal(flatten("#ffffff80", undefined, "#000000"), "#808080");
  assert.equal(flatten("#ffffff", undefined, "#000000"), "#ffffff");
  assert.equal(flatten("not a colour", 1, "#000000"), null);
  // the separate dict wins over the value's own alpha, because VA applies it last
  assert.equal(flatten("rgba(255,255,255,1)", 0.5, "#000000"), "#808080");
});

// RED IF: VA's vocabulary is guessed at. Only the mapped keys may come out, and
// everything else has to be REPORTED as left behind - a guessed mapping reads
// as a bug in the panel rather than a gap in the map.
test("only mapped keys land; the rest are reported, not dropped in silence", () => {
  const got = readVaTheme(vaExport({
    colors: { "--evcc-accent": "#c9541e", "--evcc-chip-warning-border": "#d7b23c" },
    tokens: { "--evcc-radius-card": "10px", "--evcc-shadow-card": "0 1px 2px #000", "--evcc-hover-lift": "2px" },
  }), opts);
  assert.equal(got.theme.tokens["ui-accent"], "#c9541e");
  assert.equal(got.theme.tokens["tile-radius"], 10, "px becomes the number a size token holds");
  assert.deepEqual(got.landed, ["tile-radius", "ui-accent"]);
  assert.deepEqual(got.leftBehind, ["--evcc-chip-warning-border", "--evcc-hover-lift", "--evcc-shadow-card"]);
  assert.ok(!("frame" in got.theme.tokens), "a VA theme never sets the frame - that is this panel's structure");
});

// RED IF: the map names a token this panel does not have, so a rename here
// silently stops half the colours crossing.
test("every key the map points at is a real token of this panel's", () => {
  const keys = new Set(THEME_TOKENS.map((t) => t.key));
  for (const [va, ours] of Object.entries(MAP)) {
    assert.ok(keys.has(ours), `${va} -> ${ours} is not a token here`);
    assert.ok(va.startsWith("--evcc-"), `${va} is not a VA key`);
  }
  assert.ok(Object.keys(MAP).length >= 15, "the map is not a stub");
});

// RED IF: something that is not a VA theme is read as one - our own export
// shares the envelope, and reading it here would lose everything it holds.
test("only a VA-shaped payload is read", () => {
  assert.equal(readVaTheme("{nope", opts).reason, "not_json");
  assert.equal(readVaTheme({ theme: { name: "x", tokens: { background: "#fff" } } }, opts).reason, "not_a_va_theme");
  assert.equal(readVaTheme(null, opts).reason, "invalid_payload");
  const noneMapped = readVaTheme(vaExport({ colors: { "--evcc-chip-bg": "#101010" } }), opts);
  assert.equal(noneMapped.ok, false);
  assert.equal(noneMapped.reason, "nothing_usable");
  assert.deepEqual(noneMapped.leftBehind, ["--evcc-chip-bg"]);
});

// RED IF: an unnamed theme arrives nameless and the library saves "" as a name.
test("a theme with no name still gets one", () => {
  const got = readVaTheme(vaExport({ name: "", colors: { "--evcc-accent": "#ffffff" } }), opts);
  assert.equal(got.theme.name, "A Vacuum Agent theme");
});
