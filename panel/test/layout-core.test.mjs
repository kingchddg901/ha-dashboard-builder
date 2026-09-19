/**
 * Tests for the panel's layout rules, the starting layout, and the token
 * fallbacks. Every RED IF names the input that would make the test fail.
 *
 *   node --test panel/test/layout-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  overlaps, inBounds, whyNot, canPlace, firstFit, gridRows, readingOrder, findTile,
  placeTile, moveToTab, shelveTile, unshelveTile, addTab, renameTab, removeTab, sanitize,
  copyToTab, availableFrom, addTile,
  cellsFromPixels, COLS,
} from "../layout-core.js";
import { SEED } from "../seed.js";
import { TOKENS, tokenVar } from "../tokens.js";

const T = (id, x, y, w, h, extra = {}) => ({ id, kind: "glance", x, y, w, h, ...extra });
const dash = (tabs, shelf = []) => ({ v: 1, cols: 12, tabs, shelf });
const two = () => dash([
  { id: "a", title: "A", tiles: [T("one", 0, 0, 6, 4), T("two", 6, 0, 6, 4)] },
  { id: "b", title: "B", tiles: [T("three", 0, 0, 12, 2)] },
]);

/* ---------------------------------------------------------------- geometry */

// RED IF: touching edges count as overlap (tiles could never sit side by side),
// or a real overlap is missed.
test("tiles that share an edge do not overlap; tiles that share a cell do", () => {
  assert.equal(overlaps(T("a", 0, 0, 6, 4), T("b", 6, 0, 6, 4)), false);
  assert.equal(overlaps(T("a", 0, 0, 6, 4), T("b", 0, 4, 6, 4)), false);
  assert.equal(overlaps(T("a", 0, 0, 6, 4), T("b", 5, 3, 2, 2)), true);
});

// RED IF: a tile may hang off the right edge, sit at a negative cell, or use a
// fractional cell.
test("a tile must sit on whole cells inside the columns", () => {
  assert.equal(inBounds({ x: 6, y: 0, w: 6, h: 1 }), true);
  assert.equal(inBounds({ x: 7, y: 0, w: 6, h: 1 }), false);
  assert.equal(inBounds({ x: -1, y: 0, w: 2, h: 1 }), false);
  assert.equal(inBounds({ x: 0, y: 0, w: 1.5, h: 1 }), false);
  assert.equal(inBounds({ x: 0, y: 0, w: 0, h: 1 }), false);
});

test("a refusal names what is in the way", () => {
  const tiles = [T("one", 0, 0, 6, 4)];
  assert.equal(whyNot(tiles, { x: 3, y: 2, w: 4, h: 4 }), "overlaps one");
  assert.equal(whyNot(tiles, { x: 10, y: 0, w: 4, h: 1 }), "outside the grid");
  assert.equal(whyNot(tiles, { x: 0, y: 0, w: 6, h: 4 }, { ignore: "one" }), null);
});

// RED IF: first fit skips a hole it could use, or places into an occupied cell.
test("first fit takes the first hole in reading order", () => {
  const tiles = [T("a", 0, 0, 4, 2), T("b", 8, 0, 4, 2)];
  assert.deepEqual(firstFit(tiles, 4, 2), { x: 4, y: 0, w: 4, h: 2 });
  assert.deepEqual(firstFit(tiles, 5, 2), { x: 0, y: 2, w: 5, h: 2 });
  assert.deepEqual(firstFit([], 20, 1), { x: 0, y: 0, w: COLS, h: 1 });
});

test("the phone reads the desk layout like a page", () => {
  const order = readingOrder([T("c", 0, 5, 4, 1), T("b", 6, 0, 4, 1), T("a", 0, 0, 4, 1)]).map((t) => t.id);
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.equal(gridRows([T("c", 0, 5, 4, 3)]), 8);
});

test("a drag in pixels snaps to whole cells", () => {
  assert.deepEqual(cellsFromPixels(150, -70, { cellW: 100, rowH: 64, gap: 8 }), { dx: 1, dy: -1 });
  assert.deepEqual(cellsFromPixels(40, 20, { cellW: 100, rowH: 64, gap: 8 }), { dx: 0, dy: 0 });
});

/* -------------------------------------------------------------------- edits */

// RED IF: an overlapping move is accepted, or a refused move changes anything.
test("a move onto another tile is refused and changes nothing", () => {
  const d = two();
  const res = placeTile(d, "two", { x: 3 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "overlaps one");
  assert.equal(res.dash, d);
  const ok = placeTile(d, "two", { y: 4 });
  assert.equal(ok.ok, true);
  assert.deepEqual(findTile(ok.dash, "two").tile, T("two", 6, 4, 6, 4));
  assert.deepEqual(findTile(d, "two").tile, T("two", 6, 0, 6, 4), "the input is not mutated");
});

test("a resize past the edge is refused", () => {
  assert.equal(placeTile(two(), "one", { w: 13 }).ok, false);
  assert.equal(placeTile(two(), "two", { h: 9 }).ok, true);
});

// RED IF: a tile sent to another tab lands on top of what is there, or stays
// on its old tab as well.
test("sending a tile to another tab puts it in a free spot and only there", () => {
  const res = moveToTab(two(), "one", "b");
  assert.equal(res.ok, true);
  const b = res.dash.tabs.find((t) => t.id === "b");
  const a = res.dash.tabs.find((t) => t.id === "a");
  assert.deepEqual(b.tiles.map((t) => t.id), ["three", "one"]);
  const moved = b.tiles.find((t) => t.id === "one");
  assert.deepEqual([moved.x, moved.y, moved.w, moved.h], [0, 2, 6, 4]);
  assert.ok(!a.tiles.some((t) => t.id === "one"));
  assert.equal(moveToTab(two(), "one", "a").ok, false);
  assert.equal(moveToTab(two(), "one", "nope").ok, false);
});

// RED IF: a copy reuses the original's id (the two would share one element and
// one place), lands on top of something, or the original moves.
test("copying a tile to another tab keeps the original and adds its own copy", () => {
  const res = copyToTab(two(), "one", "b");
  assert.equal(res.ok, true);
  assert.equal(res.tile.id, "one~2");
  assert.ok(findTile(res.dash, "one").tab.id === "a", "the original stays");
  const b = res.dash.tabs.find((t) => t.id === "b").tiles;
  for (const t of b) for (const u of b) if (t !== u) assert.equal(overlaps(t, u), false);
  const again = copyToTab(res.dash, "one~2", "a");
  assert.equal(again.tile.id, "one~3", "a copy of a copy numbers from the same base");
});

// RED IF: a tile added to the starting layout later never reaches a saved layout,
// or a tile the user already has (or has copied, or shelved) is offered again.
test("new starting-layout tiles are offered; ones already used are not", () => {
  const seed = dash([{ id: "a", title: "A", tiles: [T("one", 0, 0, 2, 2), T("new", 2, 0, 2, 2), T("shelved", 4, 0, 2, 2)] }]);
  const mine = dash([{ id: "a", title: "A", tiles: [T("one~2", 0, 0, 2, 2)] }], [{ id: "shelved", kind: "glance", w: 2, h: 2 }]);
  const avail = availableFrom(mine, seed);
  assert.deepEqual(avail.map((t) => t.id), ["new"]);
  assert.equal(avail[0].x, undefined);
  const added = addTile(mine, avail[0], "a");
  assert.equal(added.ok, true);
  assert.equal(addTile(added.dash, avail[0], "a").ok, false);
});

// RED IF: removing a tile loses it.
test("a removed tile waits on the shelf and comes back without overlapping", () => {
  const off = shelveTile(two(), "one");
  assert.equal(off.ok, true);
  assert.deepEqual(off.dash.shelf.map((t) => t.id), ["one"]);
  assert.equal(off.dash.shelf[0].x, undefined, "a shelved tile has no position");
  const back = unshelveTile(off.dash, "one", "b");
  assert.equal(back.ok, true);
  assert.equal(back.dash.shelf.length, 0);
  const b = back.dash.tabs.find((t) => t.id === "b");
  for (const t of b.tiles) for (const u of b.tiles) if (t !== u) assert.equal(overlaps(t, u), false);
});

test("tabs: add, rename, and only an empty tab can be removed", () => {
  const added = addTab(two());
  assert.equal(added.tab.id, "tab3");
  assert.equal(added.tab.title, "Tab 3");
  assert.equal(renameTab(added.dash, "tab3", "  Porch ").dash.tabs[2].title, "Porch");
  assert.equal(renameTab(added.dash, "tab3", "   ").ok, false);
  assert.equal(removeTab(two(), "a").reason, "move or shelve its tiles first");
  assert.equal(removeTab(added.dash, "tab3").ok, true);
  assert.equal(removeTab(dash([{ id: "only", title: "x", tiles: [] }]), "only").ok, false);
});

/* ---------------------------------------------------------------- sanitize */

// RED IF: damaged stored data loses a tile, or keeps an overlap.
test("damaged storage is repaired by relocating, never by dropping", () => {
  const raw = dash([{ id: "a", title: "A", tiles: [T("one", 0, 0, 6, 4), T("two", 3, 1, 6, 4), T("wide", 10, 0, 6, 1)] }]);
  const { dash: d, repaired } = sanitize(raw, SEED);
  const tiles = d.tabs[0].tiles;
  assert.deepEqual(tiles.map((t) => t.id), ["one", "two", "wide"]);
  for (const t of tiles) {
    assert.ok(inBounds(t, 12), `${t.id} in bounds`);
    for (const u of tiles) if (t !== u) assert.equal(overlaps(t, u), false, `${t.id} vs ${u.id}`);
  }
  assert.ok(repaired.includes("two: relocated"));
  assert.ok(repaired.includes("wide: relocated"));
});

test("unknown renderers are kept; unreadable storage falls back to the seed", () => {
  const raw = dash([{ id: "a", title: "A", tiles: [T("x", 0, 0, 2, 2, { kind: "not-written-yet" })] }]);
  assert.equal(sanitize(raw, SEED).dash.tabs[0].tiles[0].kind, "not-written-yet");
  assert.equal(sanitize(null, SEED).dash, SEED);
  assert.deepEqual(sanitize(null, SEED).repaired, []);
  assert.equal(sanitize({ v: 99, tabs: [] }, SEED).dash, SEED);
  assert.equal(sanitize("garbage", SEED).repaired.length, 1);
});

test("a duplicate tile id is dropped rather than rendered twice", () => {
  const raw = dash([{ id: "a", title: "A", tiles: [T("one", 0, 0, 2, 2), T("one", 4, 0, 2, 2)] }]);
  const { dash: d, repaired } = sanitize(raw, SEED);
  assert.equal(d.tabs[0].tiles.length, 1);
  assert.equal(repaired.length, 1);
});

/* ------------------------------------------------------------------- seed */

// RED IF: the starting layout itself breaks the rules - it is what every first
// visit and every reset shows.
test("the starting layout keeps every invariant as written", () => {
  const { dash: d, repaired } = sanitize(SEED, null);
  assert.deepEqual(repaired, []);
  assert.deepEqual(d, JSON.parse(JSON.stringify(SEED)));
  const ids = SEED.tabs.flatMap((t) => t.tiles.map((x) => x.id));
  assert.equal(new Set(ids).size, ids.length, "tile ids are unique across tabs");
});

/* ----------------------------------------------------------------- tokens */

// RED IF: a fallback drifts from the mined token file, or a token is missing.
test("every token fallback matches the mined LCARS token file", () => {
  const mined = JSON.parse(readFileSync(new URL("../../tokens/lcars/core-tokens.json", import.meta.url), "utf8"));
  const want = Object.fromEntries(mined.groups.flatMap((g) => g.tokens.map((t) => [t.cssVar, String(t.default)])));
  assert.deepEqual({ ...TOKENS }, want);
});

test("shape tokens fall back with their unit", () => {
  assert.equal(tokenVar("--lcars-outer-radius"), "var(--lcars-outer-radius, 34px)");
  assert.equal(tokenVar("--lcars-ui-accent-color"), "var(--lcars-ui-accent-color, #ff7700)");
  assert.throws(() => tokenVar("--not-a-token"));
});
