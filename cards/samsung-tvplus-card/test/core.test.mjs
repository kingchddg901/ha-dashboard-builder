import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { indexLineup, airing, tuneCommand, whatsOn, upcoming, loadLineup } from "../tvplus-core.js";

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
