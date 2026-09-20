/**
 * Tests for saved and shared themes (../theme-library.js): the library, the
 * export envelope, and the ingest gate a shared theme passes through.
 *
 *   node --test panel/test/theme-library.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  emptyLibrary, readLibrary, listThemes, saveAs, updateTheme, removeTheme, freeName,
  exportTheme, ingestTheme, fileNameFor, EXPORT_KIND,
} from "../theme-library.js";
import { THEME_TOKENS, baseValues } from "../theme-core.js";
import { OWN_THEMES } from "../own-themes.js";

const NOW = new Date("2026-09-19T12:00:00Z");
const blackOne = baseValues(THEME_TOKENS, { preset: OWN_THEMES["Black One"] });

// RED IF: a saved theme loses part of the look - it must hold every token,
// frame included, so choosing it later brings the whole thing back.
test("a saved theme holds the whole look, and names stay unique", () => {
  let lib = emptyLibrary();
  ({ lib } = saveAs(lib, { name: "Night shift", tokens: blackOne, now: NOW }));
  const r = saveAs(lib, { name: "Night shift", tokens: blackOne, now: NOW });
  const [a, b] = listThemes(r.lib);
  assert.deepEqual(Object.keys(a.tokens).sort(), THEME_TOKENS.map((t) => t.key).sort());
  assert.equal(a.tokens.frame, "cockpit");
  assert.equal(b.name, "Night shift (2)");
  assert.equal(freeName("Braun", new Set(["Braun"])), "Braun (2)");
  const updated = updateTheme(r.lib, a.id, { ...blackOne, "ui-accent": "#123456" }, { now: NOW });
  assert.equal(updated.themes[a.id].tokens["ui-accent"], "#123456");
  assert.equal(listThemes(removeTheme(updated, a.id)).length, 1);
});

// RED IF: damaged stored data is trusted - a bad entry must be left out, not
// crash the panel or reach the stylesheet.
test("reading the stored library leaves out what is malformed", () => {
  const lib = readLibrary({ v: 1, themes: { t1: { name: "Good", tokens: { frame: "braun" } }, t2: { name: 7 }, x: { name: "Bad id", tokens: {} } } });
  assert.deepEqual(Object.keys(lib.themes), ["t1"]);
  assert.deepEqual(readLibrary(null), emptyLibrary());
});

// RED IF: an export does not round-trip - what one person downloads must be
// exactly what another imports.
test("an export imports back to the same theme", () => {
  const env = exportTheme({ name: "Black One", tokens: blackOne, author: "Chris" }, { now: NOW });
  assert.equal(env.kind, EXPORT_KIND);
  const got = ingestTheme(JSON.stringify(env), { tokens: THEME_TOKENS });
  assert.equal(got.ok, true);
  assert.deepEqual(got.theme.tokens, blackOne);
  assert.deepEqual(got.dropped, []);
  assert.equal(got.theme.author, "Chris");
  assert.equal(fileNameFor("Black One"), "black-one.dashboard-theme.json");
});

// RED IF: a shared file can put arbitrary CSS on the panel - an unknown key, a
// value that escapes its declaration, or a fetch must all be dropped.
test("the ingest gate keeps data and drops anything that could be code", () => {
  const got = ingestTheme({ theme: { name: "Sneaky", tokens: {
    "ui-accent": "rgb(255, 0, 0)",
    "--evil": "red",
    "tile-shadow": "0 0 0 1px red; background: url(https://tracker.example/x.png)",
    font: "Georgia",
    "fallback-font": "x, url(https://tracker.example/f.woff)",
    frame: "cockpit",
  } } }, { tokens: THEME_TOKENS });
  assert.equal(got.ok, true);
  assert.equal(got.theme.tokens["ui-accent"], "#ff0000", "colours are normalised");
  assert.equal(got.theme.tokens.font, "Georgia");
  assert.deepEqual(got.dropped, ["--evil", "fallback-font", "tile-shadow"]);
});

// RED IF: a number outside a token's range, a colour that does not parse, or a
// frame nobody can draw gets through.
test("numbers are clamped, and bad colours and unknown choices dropped", () => {
  const got = ingestTheme({ name: "Loud", tokens: { "greeble-density": 500, "tile-radius": -3, background: "not a colour", frame: "x-wing", "light-angle": "90" } },
    { tokens: THEME_TOKENS });
  assert.equal(got.theme.tokens["greeble-density"], 100);
  assert.equal(got.theme.tokens["tile-radius"], 0);
  assert.equal(got.theme.tokens["light-angle"], 90);
  assert.deepEqual(got.clamped, ["greeble-density", "tile-radius"]);
  assert.deepEqual(got.dropped, ["background", "frame"]);
});

test("an import never claims to be built in, and a name clash is marked", () => {
  const got = ingestTheme({ theme: { name: "Braun", source: "builtin", author_url: "javascript:alert(1)", tokens: { background: "#ffffff" } } },
    { tokens: THEME_TOKENS, names: ["Braun"] });
  assert.equal(got.theme.name, "Braun (imported)");
  assert.equal(got.theme.source, "manual");
  assert.ok(!("author_url" in got.theme), "only http(s) links survive");
});

// RED IF: a colour's alpha is dropped instead of composed. This is the bug
// Vacuum Agent hit from the other side: `#ffffff14` is a faint wash in the
// theme it came from, and dropping the alpha makes it SOLID WHITE here - a
// surface that reads as a rendering fault rather than an import one. The panel
// paints flat tokens and its contrast checks parse no alpha, so the colour is
// composed over the theme's own background and reported as changed.
test("an imported colour with alpha is composed over the theme's background", () => {
  const got = ingestTheme({
    theme: { name: "Wash", tokens: { background: "#000000", "tile-surface": "#ffffff14",
      "ui-accent": "rgba(255,0,0,0.5)", "tile-border": "#ffffff" } },
  }, { tokens: THEME_TOKENS });
  assert.equal(got.theme.tokens["tile-surface"], "#141414", "8% white over this theme's own black");
  assert.equal(got.theme.tokens["ui-accent"], "#800000");
  assert.equal(got.theme.tokens["tile-border"], "#ffffff", "a solid colour is untouched");
  assert.deepEqual(got.clamped, ["tile-surface", "ui-accent"], "and the reader is told which changed");
});

// RED IF: a Vacuum Agent export is half-imported - its --evcc-* keys mean
// nothing here, so it must be refused whole, saying why.
test("a VA theme export is refused as nothing usable", () => {
  // VA's export shape (themes/manager.py export_theme), synthetic values.
  const va = { ok: true, version: 1, exported_at: "2026-09-14T07:49:52Z", theme: { id: "theme_x", name: "Night", source: "community",
    tokens: { "--evcc-radius-card": "10px", "--evcc-shadow-card": "0 1px 2px rgba(0,0,0,.6)" },
    colors: { "--evcc-surface-base": "#0a0a09", "--evcc-accent": "#c9541e" } } };
  const got = ingestTheme(va, { tokens: THEME_TOKENS });
  assert.equal(got.ok, false);
  assert.equal(got.reason, "nothing_usable");
  assert.deepEqual(got.dropped, ["--evcc-radius-card", "--evcc-shadow-card"]);
  assert.equal(ingestTheme("{nope", { tokens: THEME_TOKENS }).reason, "not_json");
  assert.equal(ingestTheme({ kind: "something-else", theme: { name: "x", tokens: {} } }, { tokens: THEME_TOKENS }).reason, "wrong_kind");
});
