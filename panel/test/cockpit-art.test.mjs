/**
 * Tests for the cockpit's generated greebles (../cockpit-art.js) and the
 * variables the panel paints from them (theme-core frameArtVars).
 *
 *   node --test panel/test/cockpit-art.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { greebleArt, GRAIN } from "../cockpit-art.js";
import { frameArtVars } from "../theme-core.js";

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
  assert.deepEqual(frameArtVars({ frame: "lcars", "greeble-density": 100 }, {}), {});
  const base = { frame: "cockpit", "greeble-density": 60 };
  const at60 = frameArtVars(base, {});
  assert.equal(at60["--db-greeble-strip"], greebleArt(.6).strip);
  const at0 = frameArtVars(base, { "greeble-density": 0 });
  assert.equal(at0["--db-greeble-strip"], greebleArt(0).strip, "your own density beats the frame's");
  assert.notEqual(at0["--db-greeble-strip"], at60["--db-greeble-strip"]);
  assert.ok("--db-greeble-strip" in frameArtVars({ frame: "lcars" }, { frame: "cockpit" }), "choosing the cockpit brings its art");
});
