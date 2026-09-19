/**
 * Tests for replaying properties HA set on the panel before it was defined -
 * the hard-refresh black screen (see ../upgrade-props.js).
 *
 *   node --test panel/test/upgrade-props.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { upgradeProperties, PANEL_PROPS } from "../upgrade-props.js";

class Panel {
  constructor() { this.calls = []; }
  set hass(v) { this.calls.push(["hass", v]); this._hass = v; }
  get hass() { return this._hass; }
  set panel(v) { this.calls.push(["panel", v]); this._panel = v; }
  get panel() { return this._panel; }
}

/** An element as HA leaves it on a slow load: values stored ON the instance. */
const early = (values) => {
  const el = new Panel();
  for (const [k, v] of Object.entries(values)) {
    Object.defineProperty(el, k, { value: v, writable: true, configurable: true, enumerable: true });
  }
  return el;
};

// RED IF: an early value is left on the instance - it shadows the setter, so
// `set hass` never runs and the panel stays black.
test("a value set before the class existed goes through the setter", () => {
  const el = early({ hass: "H", panel: "P" });
  el.hass = "still shadowed";
  assert.deepEqual(el.calls, [], "precondition: the own property really does shadow the setter");
  upgradeProperties(el);
  assert.deepEqual(el.calls, [["panel", "P"], ["hass", "still shadowed"]]);
  assert.ok(!Object.prototype.hasOwnProperty.call(el, "hass"), "the shadow is gone");
  el.hass = "later";
  assert.deepEqual(el.calls.at(-1), ["hass", "later"], "later updates reach the setter too");
});

test("nothing set early, nothing replayed", () => {
  const el = new Panel();
  upgradeProperties(el);
  assert.deepEqual(el.calls, []);
});

// RED IF: `hass` is replayed before `panel` - the first render would start
// without the panel's config (its title, whether to show the clock).
test("hass is replayed last, because it starts the load", () => {
  assert.equal(PANEL_PROPS.at(-1), "hass");
  assert.ok(PANEL_PROPS.includes("panel") && PANEL_PROPS.includes("narrow"));
});
