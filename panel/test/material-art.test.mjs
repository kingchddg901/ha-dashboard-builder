/**
 * Tests for weathering as a history (../material-art.js).
 *
 * The claims worth testing here are not "it looks rusty" - they are the ones
 * the model rests on: the order of events changes the result, an event can act
 * on what an earlier one left, a plate's scars are stable, and the damage does
 * not eat the text on top of it.
 *
 *   node --test panel/test/material-art.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  materialArt, anchors, composite, legibilityRange, noiseField, HISTORIES, GRID,
} from "../material-art.js";
import { seeded } from "../cockpit-art.js";

const sum = (f) => f.reduce((a, b) => a + b, 0);
const maskOf = (art, process) => art.layers.find((l) => l.process === process)?.mask;
/**
 * All the rust on a plate. Oxidation leaves two KINDS of mark - clean rust
 * where the world gets at an edge or a bolt, and scale where it gets under a
 * seam - so a claim about "how much rust" has to count both or it moves when
 * a site changes which kind it makes.
 */
const rust = (art) => art.layers.filter((l) => l.process === "oxidation" || l.process === "scale")
  .reduce((total, l) => total + sum(l.mask), 0);
const rustMask = (art) => {
  const out = new Float64Array(GRID * GRID);
  for (const l of art.layers) {
    if (l.process !== "oxidation" && l.process !== "scale") continue;
    for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], l.mask[i]);
  }
  return out;
};
const diff = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d;
};

// RED IF: the same plate is not the same plate twice. A scar that re-rolls on
// every render is decoration; one that holds is history.
test("a plate's weathering is the same every time it is generated", () => {
  const opts = { history: "battle-scarred", seed: 4242 };
  const a = materialArt(opts);
  const b = materialArt(opts);
  assert.equal(a.layers.length, b.layers.length);
  for (let i = 0; i < a.layers.length; i++) assert.equal(diff(a.layers[i].mask, b.layers[i].mask), 0);
  // and a different plate is a different plate
  const other = materialArt({ ...opts, seed: 4243 });
  assert.ok(diff(a.layers[0].mask, other.layers[0].mask) > 1, "another plate has its own history");
});

// RED IF: adding an event re-rolls the ones before it. Each event draws from
// its own stream keyed to its index, so a fourth event must leave the first
// three exactly as they were - otherwise editing a story rewrites its past.
test("adding an event leaves the earlier events untouched", () => {
  const base = [{ process: "heat", at: ["vent"], intensity: 0.5 },
    { process: "oxidation", at: ["bolt"] }];
  const longer = [...base, { process: "soot", at: ["vent"], amount: 0.4 }];
  const a = materialArt({ seed: 77, events: base });
  const b = materialArt({ seed: 77, events: longer });
  assert.equal(b.layers.length, a.layers.length + 1);
  for (let i = 0; i < a.layers.length; i++) {
    assert.equal(diff(a.layers[i].mask, b.layers[i].mask), 0, `event ${i} was re-rolled`);
  }
});

// RED IF: the order of events stops mattering - the whole model says it does.
// An impact strips coating, so oxidation AFTER it finds bare metal to start on
// and comes out heavier than the same oxidation run before the strike.
test("order is the story: rust after a strike is not rust before it", () => {
  const strike = { process: "impact", at: [{ x: 0.5, y: 0.5 }], severity: 0.7 };
  const rustEvent = { process: "oxidation", at: ["bolt"], density: 0.3, progress: 0.3 };
  // A filler event with the same INDEX as the strike, so the oxidation runs on
  // the same seed stream in both plates. Comparing [strike, rust] against
  // [rust, strike] looked like it tested this and did not: moving the rust to
  // index 0 changes its stream, so the two differed for a reason that has
  // nothing to do with exposure. The ablation said so - deleting the line that
  // reads `exposed` left the test green.
  const filler = { process: "heat", at: [{ x: 0.05, y: 0.05 }], intensity: 0.2 };
  const after = materialArt({ seed: 9, events: [strike, rustEvent] });
  const clean = materialArt({ seed: 9, events: [filler, rustEvent] });
  const rustAfter = rust(after);
  const rustClean = rust(clean);
  assert.ok(rustAfter > rustClean * 1.15,
    `rust over bare metal (${rustAfter.toFixed(1)}) must exceed rust on an intact plate (${rustClean.toFixed(1)})`);
});

// RED IF: an event cannot act on what an earlier one left. "at: exposed" is
// how a second heat event finds the metal the strike laid bare; without it the
// history is just a stack of independent stains.
test("an event can act on the surface an earlier event left", () => {
  const events = [
    { process: "impact", at: [{ x: 0.3, y: 0.7 }], severity: 0.8 },
    { process: "heat", at: ["exposed"], intensity: 0.6 },
  ];
  const art = materialArt({ seed: 5, events });
  const heat = maskOf(art, "heat");
  assert.ok(heat, "the heat event found somewhere to act");
  // it acted NEAR the strike, not somewhere unrelated
  let best = -1;
  let where = 0;
  for (let i = 0; i < heat.length; i++) if (heat[i] > best) { best = heat[i]; where = i; }
  const x = (where % GRID) / GRID;
  const y = Math.floor(where / GRID) / GRID;
  assert.ok(Math.hypot(x - 0.3, y - 0.7) < 0.25, `heat landed at ${x.toFixed(2)},${y.toFixed(2)}`);
  // and with nothing exposed, that same event has nowhere to act at all
  const alone = materialArt({ seed: 5, events: [{ process: "heat", at: ["exposed"], intensity: 0.6 }] });
  assert.equal(alone.layers.length, 0);
});

// RED IF: hardware and wear stop being separate questions. Turning hardware
// down and back up must return the SAME fittings - the wear hangs off them, so
// a fitting that moves takes its rust somewhere a bolt has never been.
test("hardware is a fixed set that density only keeps a share of", () => {
  const all = anchors(31, 1);
  const half = anchors(31, 0.5);
  assert.ok(half.length < all.length && half.length > 0, `kept ${half.length} of ${all.length}`);
  const byId = new Map(all.map((a) => [a.id, a]));
  for (const a of half) {
    const same = byId.get(a.id);
    assert.ok(same, `slot ${a.id} is not in the full set`);
    assert.deepEqual([a.x, a.y, a.kind], [same.x, same.y, same.kind], "a kept slot moved");
  }
  assert.deepEqual(anchors(31, 0.5), half, "and the same share comes back identical");
});

// RED IF: coverage and severity collapse into one number. Three deep blooms
// and a light speckle everywhere are different plates; a single "rustiness"
// slider cannot tell them apart, which is why there are two.
test("how many sites and how far each got are independent", () => {
  const at = (wearDensity, wearProgress) =>
    materialArt({ history: "hangar-queen", seed: 12, wearDensity, wearProgress });
  // Total mass cannot separate these - a few deep blooms and a wide speckle
  // can weigh the same, which is the whole reason there are two controls. What
  // separates them is SPREAD: how much of the plate is touched at all. Mass
  // alone left the test green when density and progress were made one knob.
  const spread = (m) => {
    const blocks = new Set();
    for (let i = 0; i < m.length; i++) {
      if (m[i] > 0.05) blocks.add(`${Math.floor((i % GRID) / 8)},${Math.floor(Math.floor(i / GRID) / 8)}`);
    }
    return blocks.size;
  };
  const deep = rustMask(at(0.15, 0.95));       // a few sites, far gone
  const wide = rustMask(at(0.95, 0.15));       // many sites, barely started
  assert.ok(spread(wide) > spread(deep),
    `many shallow sites must touch more of the plate (${spread(wide)}) than a few deep ones (${spread(deep)})`);
  // Weight per touched block was not enough: with progress still widening the
  // radius, "deep" stayed heavier per block even when it had stopped getting
  // darker, and the ablation that removed severity entirely left this green.
  // Peak is no good either - deposits clamp at 1, so both saturate. What does
  // separate them is what SHARE of the marked area is heavy.
  const heavyShare = (m) => {
    let marked = 0;
    let heavy = 0;
    for (const v of m) { if (v > 0.05) marked++; if (v > 0.6) heavy++; }
    return marked ? heavy / marked : 0;
  };
  // The factor is MEASURED, not chosen: as written the two differ by 7.7x
  // (0.42 against 0.055), and with severity removed - progress widening a site
  // but no longer deepening it - they differ by 2.3x. Four sits between them
  // with room on both sides, so this fails when severity stops being a control
  // and passes without being brittle.
  assert.ok(heavyShare(deep) > heavyShare(wide) * 4,
    `a far-gone site must be mostly HEAVY (${heavyShare(deep).toFixed(3)}) `
    + `where a barely started one is mostly faint (${heavyShare(wide).toFixed(3)})`);
  assert.equal(at(0, 0.95).layers.length, 0, "no wear at all leaves nothing");
  assert.ok(rust(at(0.05, 0.3)) > 0, "but any wear at all leaves a mark");
});

// RED IF: rust appears in open field. A sheet of steel does not corrode from
// the middle of itself - it corrodes where the world gets in: an edge, a
// fastening, a seam. Scattering blooms anywhere is what made the first version
// read as stained cloth rather than as steel, so every mark has to be traceable
// to a feature (or to a chip beside one).
test("a plate rusts at its features, never out of its middle", () => {
  // Bolts ONLY, and few of them. With the edges in the list as well there are
  // features all round the margin and nearly anywhere is "near" something, so
  // the check passed even when the strays were scattered at random: it had no
  // room left to be wrong in.
  const art = materialArt({ seed: 21, hardware: 0.35, wearDensity: 1, wearProgress: 0.5,
    events: [{ process: "oxidation", at: ["bolt"] }] });
  const features = art.anchors.filter((f) => f.kind === "bolt");
  assert.ok(features.length >= 2 && features.length <= 8,
    `few enough fittings that open field exists (${features.length})`);
  const mask = rustMask(art);
  let far = 0;
  let marked = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] < 0.25) continue;
    marked++;
    const x = (i % GRID) / GRID;
    const y = Math.floor(i / GRID) / GRID;
    // "Near" allows a bloom to have grown outward and a chip to sit beside its
    // host; it does not allow a mark in the middle of nowhere.
    if (!features.some((f) => Math.hypot(f.x - x, f.y - y) < 0.22)) far++;
  }
  assert.ok(marked > 20, `the plate is rusted at all (${marked} cells)`);
  assert.equal(far, 0, `${far} of ${marked} rusted cells are nowhere near a feature`);
});

// RED IF: a seam corrodes like a bolt. Water gets UNDER a joint and the rust
// grows in layers that lift - scale - so a seam has to leave its own harder,
// heavier mark, drawn as its own layer with its own colour.
test("a seam makes scale, an edge does not", () => {
  const seam = materialArt({ seed: 3, wearDensity: 1, wearProgress: 0.6,
    events: [{ process: "oxidation", at: [{ x: 0.5, y: 0.5, kind: "seam" }] }] });
  const edge = materialArt({ seed: 3, wearDensity: 1, wearProgress: 0.6,
    events: [{ process: "oxidation", at: [{ x: 0.5, y: 0.5, kind: "edge" }] }] });
  assert.ok(maskOf(seam, "scale"), "a seam leaves scale");
  assert.ok(!maskOf(edge, "scale"), "an edge leaves clean rust, not scale");
  // and scale is the harder mark: less of the plate, more weight where it is
  const scale = maskOf(seam, "scale");
  const clean = maskOf(edge, "oxidation");
  const peak = (m) => m.reduce((a, b) => Math.max(a, b), 0);
  assert.ok(peak(scale) > peak(clean), `scale ${peak(scale).toFixed(2)} vs clean ${peak(clean).toFixed(2)}`);
});

// RED IF: the legibility gate stops biting. This is the measure that decides
// how far weathering can go: blurred to the size of a letter, thin marks
// average away and broad mottling does not. A gate that passes everything is
// not a gate.
test("the legibility gate passes thin marks and fails broad mottling", () => {
  const thin = composite(materialArt({ history: "hangar-queen", seed: 3, wearDensity: 0.3, wearProgress: 0.2 }).layers);
  const heavy = composite(materialArt({ history: "battle-scarred", seed: 3, wearDensity: 1, wearProgress: 1 }).layers);
  const thinRange = legibilityRange(thin);
  const heavyRange = legibilityRange(heavy);
  assert.ok(thinRange < heavyRange, `${thinRange.toFixed(3)} should be under ${heavyRange.toFixed(3)}`);
  // a flat field has no range at all - the measure reads zero when there is nothing
  assert.equal(legibilityRange(composite([])), 0);
  // and it is a BLURRED measure: raw speckle has a big range, blurred it does not
  const speckle = noiseField(seeded(8), { cells: 24, octaves: 1 });
  assert.ok(legibilityRange(speckle, 6) < 0.35, "fine speckle averages away at glyph scale");
});

// RED IF: a named history stops being an ordered list, or one of them quietly
// does nothing. The theme picks these by name, so an empty one is a setting
// that looks like it works.
test("every named history is an ordered list that leaves marks", () => {
  assert.deepEqual(HISTORIES.none, []);
  for (const [name, events] of Object.entries(HISTORIES)) {
    if (name === "none") continue;
    assert.ok(Array.isArray(events) && events.length, `${name} is empty`);
    const art = materialArt({ history: name, seed: 101, wearDensity: 0.5, wearProgress: 0.5 });
    assert.ok(art.layers.length > 0, `${name} drew nothing`);
    assert.ok(sum(composite(art.layers)) > 5, `${name} is invisible`);
  }
  assert.equal(materialArt({ history: "nonsense", seed: 1 }).layers.length, 0, "an unknown name is nothing, not a crash");
});
