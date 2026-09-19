/**
 * Tests for one browser's own theme choice (../device-theme.js): the stored
 * pick, what a device ends up showing, and whose draft it wears.
 *
 *   node --test panel/test/device-theme.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEVICE_KEY, DEVICE_TOKENS_KEY, accountPick, readPick, writePick, resolveTheme, isLocked, readDraft, writeDraft,
} from "../device-theme.js";

const known = (name) => ["Black One", "Braun", "user:t1"].includes(name);

// RED IF: damaged or hand-edited storage steers the theme - anything that is
// not a pick this file wrote must land on "follow the account", never on a
// half-read mode or a theme nobody chose.
test("a stored pick is read back, and junk falls back to the account", () => {
  assert.deepEqual(readPick(writePick({ mode: "device", theme: "Braun" })), { mode: "device", theme: "Braun" });
  for (const raw of ["", "not json", "[]", "null", '"Braun"', '{"mode":"global","theme":"Braun"}',
    '{"theme":"Braun"}', '{"mode":"device","theme":7}']) {
    const pick = readPick(raw);
    assert.equal(pick.mode, raw === '{"mode":"device","theme":7}' ? "device" : "account", raw);
  }
  assert.deepEqual(readPick(undefined), accountPick());
  assert.equal(DEVICE_KEY, "dashboard_builder.device_theme");
});

// RED IF: null stops meaning "Home Assistant's theme" - locking a device to
// HA's own theme is a real choice, and must survive the round trip instead of
// reading back as "nothing picked" and following the account.
test("a device locked to Home Assistant's theme stays there", () => {
  const pick = readPick(writePick({ mode: "device", theme: null }));
  assert.deepEqual(pick, { mode: "device", theme: null });
  const r = resolveTheme({ pick, accountTheme: "Black One", known });
  assert.equal(r.theme, null);
  assert.equal(r.locked, true);
  assert.equal(isLocked(pick), true);
  assert.equal(isLocked(accountPick()), false);
});

// RED IF: the lock does not actually hold - a locked device must keep its own
// theme while the shared account setting says something else, which is the
// whole point on a shared account.
test("a locked device keeps its theme; an unlocked one follows the account", () => {
  const locked = resolveTheme({ pick: { mode: "device", theme: "Braun" }, accountTheme: "Black One", known });
  assert.equal(locked.theme, "Braun");
  assert.equal(locked.locked, true);

  const following = resolveTheme({ pick: { mode: "account", theme: "Braun" }, accountTheme: "Black One", known });
  assert.equal(following.theme, "Black One");
  assert.equal(following.locked, false);

  const noPick = resolveTheme({ accountTheme: "Black One", known });
  assert.equal(noPick.theme, "Black One");
});

// RED IF: a pin is wiped before the library has loaded - every saved theme
// looks deleted at that moment, so the first render would throw away a good
// pin and the device would silently revert to the account's theme.
test("a pin on a saved theme survives the library not having loaded yet", () => {
  const pick = { mode: "device", theme: "user:t1" };
  const early = resolveTheme({ pick, accountTheme: "Black One", known: () => false, libraryLoaded: false });
  assert.equal(early.theme, "user:t1");
  assert.equal(early.stale, false);

  const loaded = resolveTheme({ pick, accountTheme: "Black One", known, libraryLoaded: true });
  assert.equal(loaded.theme, "user:t1");
  assert.equal(loaded.stale, false);
});

// RED IF: a pin on a theme deleted elsewhere hangs on - it must report itself
// stale so the caller drops it, and show the account's theme meanwhile.
test("a pin on a deleted theme is reported stale and falls back", () => {
  const r = resolveTheme({ pick: { mode: "device", theme: "user:t9" }, accountTheme: "Black One", known, libraryLoaded: true });
  assert.equal(r.theme, "Black One");
  assert.equal(r.locked, false);
  assert.equal(r.stale, true);
});

// RED IF: a locked browser's draft is trusted as stored - these values go
// straight into CSS custom properties, and this is the one store a person can
// hand-edit, so anything that is not flat text or a number must be dropped
// rather than painted onto the panel as "[object Object]".
test("a locked browser's own draft keeps only values that can be painted", () => {
  const draft = { "ui-accent": "#ff8800", "tile-radius": 12, frame: "braun" };
  assert.deepEqual(readDraft(writeDraft(draft)), draft);
  assert.deepEqual(readDraft(JSON.stringify({ good: "#fff", bad: { a: 1 }, worse: ["x"], nope: null, nan: NaN })),
    { good: "#fff" });
  for (const raw of ["", "not json", "[]", "null", '"Braun"', undefined]) assert.deepEqual(readDraft(raw), {});
  assert.deepEqual(readDraft(writeDraft(undefined)), {});
  assert.equal(DEVICE_TOKENS_KEY, "dashboard_builder.device_theme_tokens");
});
