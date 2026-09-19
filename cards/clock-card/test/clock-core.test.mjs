/**
 * Tests for the clock: the house's zone wins over the device's, HA's 12/24-hour
 * setting is honoured, and the face turns over on the second or minute.
 *
 *   node --test cards/clock-card/test/clock-core.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { hour12For, clockParts, msToNextTick } from "../clock-core.js";

// 2026-09-19 04:42:07 UTC is 21:42:07 on the 18th in Los Angeles (PDT).
const T = Date.UTC(2026, 8, 19, 4, 42, 7);

// RED IF: the device's zone is used - a tablet on UTC would show 4:42.
test("the clock shows Home Assistant's zone, not the device's", () => {
  const la = clockParts(T, { timeZone: "America/Los_Angeles", hour12: true });
  assert.deepEqual([la.time, la.ampm, la.zone], ["9:42", "PM", "PDT"]);
  assert.equal(la.date, "Friday, September 18");
  const utc = clockParts(T, { timeZone: "UTC", hour12: true });
  assert.equal(utc.time, "4:42");
  assert.equal(utc.date, "Saturday, September 19");
});

// RED IF: HA's profile choice is ignored.
test("HA's 12 or 24 hour setting decides the face; otherwise the locale does", () => {
  assert.equal(hour12For("12"), true);
  assert.equal(hour12For("24"), false);
  assert.equal(hour12For("language"), undefined);
  assert.equal(hour12For("system"), undefined);
  const h24 = clockParts(T, { timeZone: "America/Los_Angeles", hour12: false });
  assert.equal(h24.time, "21:42");
  assert.equal(h24.ampm, "");
});

test("seconds are there for a face that wants them", () => {
  assert.equal(clockParts(T, { timeZone: "UTC" }).seconds, "07");
});

// RED IF: the face ticks on a fixed interval from load - it would turn over up
// to a minute late.
test("the next tick lands on the whole minute or second", () => {
  assert.equal(msToNextTick(T), 60000 - 7000);
  assert.equal(msToNextTick(T + 250, { seconds: true }), 750);
  assert.equal(msToNextTick(Date.UTC(2026, 0, 1, 0, 0, 0)), 60000);
});
