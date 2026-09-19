/**
 * Tests for the cockpit's generated greebles (../cockpit-art.js) and the
 * variables the panel paints from them (theme-core frameArtVars).
 *
 *   node --test panel/test/cockpit-art.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { greebleArt, GRAIN, shadeEdges, lightOf } from "../cockpit-art.js";
import { frameArtVars, baseValues, THEME_TOKENS } from "../theme-core.js";

/** The base the panel really builds for a frame: every token, frame defaults applied. */
const baseFor = (frame, extra = {}) => ({ ...baseValues(THEME_TOKENS, { overrides: { frame } }), frame, ...extra });

const DENSITIES = [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1];

// RED IF: the density slider reshuffles the hardware - a higher density must
// keep every module a lower one placed, AT THE SAME PLACE, only adding to it.
// (Comparing slot numbers alone passed while every module slid sideways.)
test("raising the density only adds hardware, in place", () => {
  for (let i = 1; i < DENSITIES.length; i++) {
    const lo = greebleArt(DENSITIES[i - 1]).placed;
    const hi = greebleArt(DENSITIES[i]).placed;
    for (const surface of ["strip", "corner"]) {
      for (const at of lo[surface]) assert.ok(hi[surface].includes(at), `${surface} ${at} moved or vanished at ${DENSITIES[i]}`);
    }
  }
  assert.equal(greebleArt(0).counts.strip, 0, "density 0 is a bare plate");
  assert.ok(greebleArt(1).counts.strip > greebleArt(.3).counts.strip, "more density, more hardware");
});

// RED IF: the same density draws different art - every repaint would flicker.
test("the same density always draws the same art", () => {
  assert.equal(greebleArt(.6).strip, greebleArt(0.6000001).strip);
  assert.equal(greebleArt(.35).column, greebleArt(.35).column);
});

// RED IF: a greeble is drawn in a colour - it would clash with the next
// theme's plates, and a coloured greeble starts to read as a lamp.
test("greebles are lit in white and black only, never a colour", () => {
  const art = greebleArt(1);
  for (const [name, css] of Object.entries({ strip: art.strip, corner: art.corner, column: art.column, grain: GRAIN })) {
    const svg = decodeURIComponent(css);
    assert.doesNotMatch(svg, /#[0-9a-f]{3,8}\b/i, `${name}: a hex colour`);
    for (const m of svg.matchAll(/rgba?\(([^)]*)\)/g)) {
      const [r, g, b] = m[1].split(",").map((v) => Number(v.trim()));
      assert.ok((r === 255 && g === 255 && b === 255) || (r === 0 && g === 0 && b === 0), `${name}: ${m[0]}`);
    }
  }
});

// RED IF: the slider is wired to nothing, or LCARS - which draws no greebles -
// gets art written onto it anyway.
test("the panel paints greebles for the cockpit only, at the chosen density", () => {
  assert.deepEqual(frameArtVars(baseFor("lcars", { "greeble-density": 100 }), {}), {});
  const base = baseFor("cockpit");
  assert.equal(base["greeble-density"], 60, "precondition: the cockpit's default density");
  const at60 = frameArtVars(base, {});
  assert.equal(at60["--db-greeble-strip"], greebleArt(.6, { angle: 0, intensity: .6 }).strip);
  const at0 = frameArtVars(base, { "greeble-density": 0 });
  assert.equal(at0["--db-greeble-strip"], greebleArt(0).strip, "your own density beats the frame's");
  assert.notEqual(at0["--db-greeble-strip"], at60["--db-greeble-strip"]);
  assert.ok("--db-greeble-strip" in frameArtVars({ frame: "lcars" }, { frame: "cockpit" }), "choosing the cockpit brings its art");
});

// RED IF: the light does not steer the shading - an edge facing the light must
// catch it and the one facing away go dark, whichever way the light comes from.
test("each edge is shaded by where the light comes from", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];            // top, right, bottom, left
  const lit = (angle) => shadeEdges(sq, lightOf({ angle, intensity: .6 })).map((e) => (e.hi ? "L" : e.sh ? "D" : "-")).join("");
  assert.equal(lit(0), "L-D-", "from above: top lit, bottom dark");
  assert.equal(lit(90), "-L-D", "from the right");
  assert.equal(lit(180), "D-L-", "from below");
  assert.equal(lit(270), "-D-L", "from the left");
  const hole = shadeEdges(sq, lightOf({ angle: 0, intensity: .6 }), { raised: false }).map((e) => (e.hi ? "L" : e.sh ? "D" : "-")).join("");
  assert.equal(hole, "D-L-", "a hole is the reverse: its far wall catches the light");
});

// RED IF: intensity is not wired - at 0 there must be no relief at all, and
// stronger light must mean stronger shading.
test("light intensity scales the shading, down to flat", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const flat = shadeEdges(sq, lightOf({ angle: 30, intensity: 0 }));
  assert.ok(flat.every((e) => !e.hi && !e.sh), "no light, no relief");
  const top = (k) => shadeEdges(sq, lightOf({ angle: 0, intensity: k }))[0].hi;
  assert.ok(top(1) > top(.5) && top(.5) > 0);
});

// RED IF: the light moves hardware - light changes shading, never placement.
test("changing the light never moves a greeble", () => {
  const a = greebleArt(.7, { angle: 0, intensity: .6 });
  const b = greebleArt(.7, { angle: 135, intensity: .9 });
  assert.deepEqual(b.placed, a.placed);
  assert.notEqual(b.strip, a.strip, "but it does change how they are drawn");
});

// RED IF: the plates and keys are not told where the light is - they would stay
// lit from above while the greebles turned.
test("the panel paints the light itself for the plates and keys to use", () => {
  const v = frameArtVars(baseFor("cockpit"), { "light-angle": 90, "light-intensity": 80 });
  assert.equal(v["--db-lx"], "1");
  assert.equal(v["--db-ly"], "0");
  assert.equal(v["--db-light-k"], "0.8");
  assert.equal(v["--db-light-deg"], "90");
});
