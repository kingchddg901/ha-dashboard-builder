import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  indexLineup, airing, tuneCommand, tuneDuration, KEY_GAP_MS, whatsOn, upcoming, loadLineup,
  groupsOf, searchChannels, toggleSaved, moveSaved, savedKey,
} from "../tvplus-core.js";

/**
 * The core has no DOM and no Home Assistant in it, so it tests here — which is
 * the point of extracting it. Each test names the change that turns it red.
 *
 * The fixture is five real channels lifted from the live lineup on 2026-09-15,
 * including the 3614/3615 pair that Samsung renumbered (PBS Kids moved off 3615
 * and Peppa Pig moved onto it) — the case that makes name-keying load-bearing.
 */
const RAW = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL("./lineup.fixture.json", import.meta.url)), "utf8"));

/* ---------- indexing ---------- */

test("indexes by NAME, not by number", () => {
  const ix = indexLineup(RAW, "us");
  assert.equal(ix["Witness to Justice"].n, 1833);
  assert.equal(ix[1833], undefined);          // RED IF: keyed by chno
});

test("the renumbered pair stays distinguishable by name", () => {
  // Samsung moved PBS Kids off 3615 and put Peppa Pig on it. A favourite keyed
  // by number would now tune the wrong thing; keyed by name it follows.
  const ix = indexLineup(RAW, "us");
  assert.equal(ix["PBS Kids"].n, 3614);
  assert.equal(ix["Peppa Pig & Friends"].n, 3615);
});

test("an unknown region throws rather than returning empty", () => {
  assert.throws(() => indexLineup(RAW, "zz"), /not in the lineup/);
  // RED IF: it returns {} and the card silently shows "not in the lineup" for everything
});

/* ---------- tuning ---------- */

test("tuneCommand is digits then ENTER", () => {
  assert.deepEqual(tuneCommand(1833), ["KEY_1", "KEY_8", "KEY_3", "KEY_3", "KEY_ENTER"]);
});

test("tuneCommand handles a long id and always terminates with ENTER", () => {
  const c = tuneCommand("111299001912");
  assert.equal(c.length, 13);
  assert.equal(c.at(-1), "KEY_ENTER");      // RED IF: ENTER is dropped and nothing tunes
});

// RED IF: samsungtv_smart gets no pause (its own 0.5 s spacing dropped digits),
// a pause lands before the first key, or anything follows ENTER.
test("on samsungtv_smart a pause goes between every key, and only between", () => {
  assert.deepEqual(tuneCommand(1833, { platform: "samsungtv_smart" }),
    ["KEY_1", "1000", "KEY_8", "1000", "KEY_3", "1000", "KEY_3", "1000", "KEY_ENTER"]);
  assert.equal(KEY_GAP_MS, 1000);            // the spacing measured working on core samsungtv
});

// RED IF: a pause outside the integration's clamp is sent - it would be clamped
// silently there, and the card would be claiming a spacing it is not getting.
test("the pause is held to the range samsungtv_smart accepts", () => {
  assert.equal(tuneCommand(12, { platform: "samsungtv_smart", gapMs: 50 })[1], "200");
  assert.equal(tuneCommand(12, { platform: "samsungtv_smart", gapMs: 9000 })[1], "2000");
  assert.equal(tuneCommand(12, { platform: "samsungtv_smart", gapMs: "junk" })[1], "1000");
});

// RED IF: core samsungtv is sent a number - it would reach the TV as a key.
test("core samsungtv and unknown remotes get plain keys", () => {
  for (const platform of ["samsungtv", null, "something_else"]) {
    assert.ok(tuneCommand(1833, { platform }).every((k) => k.startsWith("KEY_")), String(platform));
  }
});

test("a tune's sending time covers every pause", () => {
  assert.equal(tuneDuration(1833, { platform: "samsungtv_smart" }), 4000);
  assert.equal(tuneDuration(1833, { platform: "samsungtv_smart", gapMs: 500 }), 2000);
});

/* ---------- search ---------- */

// The fixture's programme times are from 2026-09-15; search as of a moment in them.
const AT = 1789521000;

test("categories are counted, largest first", () => {
  const g = groupsOf(indexLineup(RAW, "us"));
  assert.deepEqual(g[0], { name: "Kids", count: 2 });
  assert.equal(g.length, 4);
});

// RED IF: a query word has to match the NAME only - "court cam" (a show) and
// "kids" (a category) would find nothing.
test("search reads the name, the category and what is on", () => {
  const ix = indexLineup(RAW, "us");
  const names = (q, o = {}) => searchChannels(ix, { query: q, now: AT, ...o }).results.map((r) => r.name);
  assert.deepEqual(names("court cam"), ["Witness to Justice"]);
  assert.deepEqual(names("kids"), ["PBS Kids", "Peppa Pig & Friends"]);
  assert.deepEqual(names("PEPPA"), ["Peppa Pig & Friends"]);
  assert.deepEqual(names("nothing like this"), []);
});

// RED IF: accents have to be typed - "pokemon" would miss the Pokémon channel,
// which is how it was found.
test("search ignores accents and case", () => {
  const ix = { "Pokémon": { n: 3695, group: "Kids", programs: [[AT - 60, "Pokémon Journeys"]] } };
  assert.deepEqual(searchChannels(ix, { query: "pokemon", now: AT }).results.map((r) => r.name), ["Pokémon"]);
  assert.deepEqual(searchChannels(ix, { query: "POKÉMON journeys", now: AT }).results.length, 1);
});

// RED IF: a number finds nothing, or matches digits anywhere in the number.
test("an all-digit word matches a channel number by prefix", () => {
  const ix = indexLineup(RAW, "us");
  assert.deepEqual(searchChannels(ix, { query: "36", now: AT }).results.map((r) => r.n), [3614, 3615]);
  assert.deepEqual(searchChannels(ix, { query: "14", now: AT }).results.map((r) => r.n), []);
});

test("a name match outranks a match on what is showing", () => {
  const ix = indexLineup(RAW, "us");
  const r = searchChannels(ix, { query: "pbs", now: AT }).results;
  assert.equal(r[0].name, "PBS Kids");
  assert.equal(r[0].rank, 0);
});

test("a category alone lists that category; the limit reports what it hides", () => {
  const ix = indexLineup(RAW, "us");
  const all = searchChannels(ix, { group: "Kids", now: AT });
  assert.equal(all.total, 2);
  const cut = searchChannels(ix, { query: "", limit: 3, now: AT });
  assert.equal(cut.results.length, 3);
  assert.equal(cut.total, 5);
});

/* ---------- the saved list ---------- */

// RED IF: saving twice duplicates a channel, or removing leaves it in.
test("saving toggles: add to the end, or take out", () => {
  const a = toggleSaved(["CBS News 24/7"], "Movie Hub");
  assert.deepEqual(a, ["CBS News 24/7", "Movie Hub"]);
  assert.deepEqual(toggleSaved(a, "CBS News 24/7"), ["Movie Hub"]);
  assert.deepEqual(toggleSaved(null, "Movie Hub"), ["Movie Hub"]);
});

test("moving stops at either end", () => {
  const l = ["a", "b", "c"];
  assert.deepEqual(moveSaved(l, "c", -1), ["a", "c", "b"]);
  assert.deepEqual(moveSaved(l, "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveSaved(l, "c", 1), ["a", "b", "c"]);
  assert.deepEqual(l, ["a", "b", "c"], "the input is not changed");
});

test("a list name becomes a safe storage key", () => {
  assert.equal(savedKey(), "samsung_tvplus.saved.default");
  assert.equal(savedKey("Living Room!"), "samsung_tvplus.saved.living_room");
  assert.equal(savedKey("!!!"), "samsung_tvplus.saved.default");
});

/* ---------- now / next ---------- */

test("airing picks the programme spanning now, and the one after", () => {
  const { cur, next } = airing([[100, "a"], [200, "b"], [300, "c"]], 250);
  assert.equal(cur.title, "b");
  assert.equal(cur.end, 300);
  assert.equal(next.title, "c");
  assert.equal(next.start, 300);            // RED IF: the field is renamed and callers read undefined
});

test("airing returns null for `cur` outside the window rather than guessing", () => {
  const { cur, next } = airing([[100, "a"]], 50);
  assert.equal(cur, null);
  assert.equal(next.title, "a");
});

test("the last programme gets an assumed hour, not an infinite one", () => {
  const { cur } = airing([[100, "only"]], 200);
  assert.equal(cur.end, 100 + 3600);
  assert.equal(airing([[100, "only"]], 4000).cur, null);
});

/* ---------- search ---------- */

test("whatsOn matches on channel name AND programme title", () => {
  const ix = indexLineup(RAW, "us");
  const now = RAW.regions.us.channels[Object.keys(RAW.regions.us.channels)[0]].programs[0][0] + 60;
  assert.ok(whatsOn(ix, { now }).length >= 1);
  assert.equal(whatsOn(ix, { match: "zzzz-no-such-thing", now }).length, 0);
});

test("upcoming is strictly future and sorted", () => {
  const ix = indexLineup(RAW, "us");
  const up = upcoming(ix, { now: 0 });
  assert.ok(up.length > 0);
  assert.deepEqual(up.map(u => u.start), [...up.map(u => u.start)].sort((a, b) => a - b));
  assert.ok(upcoming(ix, { now: 9e9 }).length === 0);   // RED IF: past programmes leak in
});

/* ---------- loading, and degrading ---------- */

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

test("a failed fetch falls back to a stale cache instead of throwing", async () => {
  const storage = memStore();
  const ok = async () => ({ ok: true, json: async () => RAW });
  const bad = async () => { throw new Error("offline"); };
  const first = await loadLineup({ fetchImpl: ok, storage, maxAgeMs: 0 });
  assert.equal(first.fromCache, false);
  const second = await loadLineup({ fetchImpl: bad, storage, maxAgeMs: 0 });
  assert.equal(second.stale, true);
  assert.equal(second.index["Witness to Justice"].n, 1833);
});

test("a non-200 is treated as a failure, not as data", async () => {
  const storage = memStore();
  await assert.rejects(
    loadLineup({ fetchImpl: async () => ({ ok: false, status: 503 }), storage }),
    /503/);                                  // RED IF: res.ok is not checked and json() garbage flows on
});

test("a fresh cache short-circuits the fetch entirely", async () => {
  const storage = memStore();
  let calls = 0;
  const counting = async () => { calls++; return { ok: true, json: async () => RAW }; };
  await loadLineup({ fetchImpl: counting, storage });
  const again = await loadLineup({ fetchImpl: counting, storage });
  assert.equal(calls, 1);
  assert.equal(again.fromCache, true);
});

test("hostile storage never breaks the load", async () => {
  const hostile = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  const r = await loadLineup({
    fetchImpl: async () => ({ ok: true, json: async () => RAW }),
    storage: hostile,
  });
  assert.equal(r.index["Movie Hub"].n, 1200);   // RED IF: a private window takes the card down
});
