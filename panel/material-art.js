/**
 * What happened to this plate - weathering as a history, not a texture. No DOM.
 *
 * A surface here is four separable things, and only the last two are new:
 *
 *   GEOMETRY   what hardware exists    (cockpit-art.js, and `anchors` below)
 *   MATERIAL   what it is made of      (the substrate: its base and its grain)
 *   HISTORY    what happened, in order (this file)
 *   LIGHTING   how we are seeing it    (the light tokens, already painted)
 *
 * The history is an ORDERED list of events, because the order is the story.
 * Heat then impact then rust is a different plate from impact then heat then
 * rust: the impact strips coating and exposes metal, so a later oxidation
 * event finds somewhere new to start, and a later heat event scorches bare
 * steel where it would have discoloured paint. Each event therefore reads the
 * surface the ones before it left, and writes to it:
 *
 *   exposed   coating gone, bare metal - where oxidation prefers to start
 *   heated    cooked - discolours, and weakens coating
 *   damaged   gouged or pitted - holds water, catches soot
 *
 * Those fields are coarse (GRID x GRID) and live only in here. What comes out
 * is one mask per event, which the panel paints as `mask-image` under a tint -
 * CSS composites for display and never hands back an intermediate, so the
 * history has to run here, where the intermediates are just arrays.
 *
 * Everything is seeded and normalized:
 *
 *   - a seed per plate and per EVENT (`weathering + item + event`), so adding
 *     an event never re-rolls the ones before it, and a plate keeps its scars
 *     across reloads, moves and devices;
 *   - coordinates are 0..1, never pixels, so a tile that resizes re-crops its
 *     damage instead of stretching round blooms into ellipses.
 *
 * Hardware and wear are three different questions, so they are three numbers:
 * how much hardware exists (`hardware`), how much of it corroded (`wearDensity`),
 * and how far each one got (`wearProgress`).
 */

import { seeded } from "./cockpit-art.js";

/** Coarse enough to be free, fine enough that a bloom edge is not a staircase. */
export const GRID = 64;
const idx = (x, y) => y * GRID + x;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const field = () => new Float64Array(GRID * GRID);

/* --------------------------------------------------------------- noise */

/** Value noise from a seeded stream: a coarse lattice, smoothed, a few octaves. */
export function noiseField(r, { octaves = 3, cells = 4, size = GRID } = {}) {
  const GRID = size;                        // shadowed on purpose: the same lattice at any scale
  const idx = (x, y) => y * GRID + x;
  const field = () => new Float64Array(GRID * GRID);
  const out = field();
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells * 2 ** o;
    const lat = new Float64Array((n + 1) * (n + 1));
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const fx = (x / GRID) * n;
        const fy = (y / GRID) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = lat[y0 * (n + 1) + x0];
        const b = lat[y0 * (n + 1) + x0 + 1];
        const c = lat[(y0 + 1) * (n + 1) + x0];
        const d = lat[(y0 + 1) * (n + 1) + x0 + 1];
        out[idx(x, y)] += amp * ((a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy);
      }
    }
    total += amp;
    amp /= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/* ------------------------------------------------------------ hardware */

/**
 * The plate's own edges, as places corrosion can start.
 *
 * A panel rusts where it MEETS something - the seam against what it is bolted
 * to - and that needs no hardware, only the shape of the plate. Weighted down
 * the gravity vector and into the corners, because that is where water sits
 * and grime collects, and biased to the margins, which is also where the text
 * is not: edge damage buys the most story for the least legibility.
 */
export function edgeAnchors(seed, count = 7, gravity = 90) {
  const r = seeded(seed + 7331);
  const rad = (gravity * Math.PI) / 180;
  const low = { x: 0.5 + Math.cos(rad) * 0.5, y: 0.5 + Math.sin(rad) * 0.5 };   // the plate's low side
  const out = [];
  for (let i = 0; i < count; i++) {
    const side = r();
    const t = r();
    let p;
    if (side < 0.34) p = { x: t, y: 0.02 + r() * 0.05 };                        // top
    else if (side < 0.68) p = { x: t, y: 0.93 + r() * 0.05 };                   // bottom
    else if (side < 0.84) p = { x: 0.02 + r() * 0.05, y: t };                   // left
    else p = { x: 0.93 + r() * 0.05, y: t };                                    // right
    // Pull a share of them towards the low side, so the story has a direction.
    const pull = r() * 0.5;
    out.push({ id: `edge${i}`, kind: "edge",
      x: clamp01(p.x + (low.x - p.x) * pull * 0.3), y: clamp01(p.y + (low.y - p.y) * pull) });
  }
  return out;
}

/**
 * The fittings on this plate, in normalized coordinates.
 *
 * Fixed slots, exactly as the greebles work: the position and kind of every
 * slot come from the plate's own seed and never from `hardware`, which only
 * decides which of them are there. Turn hardware down and back up and the
 * same bolts return to the same places - so the wear attached to them returns
 * with them, rather than drifting to somewhere a bolt never was.
 */
export function anchors(seed, hardware = 1) {
  const r = seeded(seed);
  const out = [];
  const want = 14;                       // the slot grid; `hardware` keeps a share of it
  for (let slot = 0; slot < want; slot++) {
    const kind = r() < 0.16 ? "vent" : r() < 0.45 ? "seam" : "bolt";
    const x = clamp01(0.06 + r() * 0.88);
    const y = clamp01(0.08 + r() * 0.84);
    const keep = r();                    // rolled for every slot, so it is stable
    if (keep < hardware) out.push({ id: `${slot}`, kind, x, y });
  }
  return out;
}

/* --------------------------------------------------------------- events */

/** Add a radial deposit to `f`, falling off to nothing at `radius`. */
function deposit(f, cx, cy, radius, strength, shape = 1) {
  const R = radius * GRID;
  const px = cx * GRID;
  const py = cy * GRID;
  const x0 = Math.max(0, Math.floor(px - R));
  const x1 = Math.min(GRID - 1, Math.ceil(px + R));
  const y0 = Math.max(0, Math.floor(py - R));
  const y1 = Math.min(GRID - 1, Math.ceil(py + R));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - px, y - py) / (R || 1);
      if (d >= 1) continue;
      const v = strength * (1 - d) ** shape;
      const i = idx(x, y);
      if (v > f[i]) f[i] = v;
    }
  }
}

/**
 * Where a surface is already bare, as a handful of points to grow from.
 *
 * The strongest cells, thinned so one gouge contributes a few sites rather
 * than four hundred - the field is a region, and corrosion nucleates at points
 * inside it.
 */
function exposedSites(f, limit = 6) {
  const picks = [];
  for (let i = 0; i < f.length; i++) if (f[i] > 0.45) picks.push([f[i], i]);
  picks.sort((a, b) => b[0] - a[0]);
  const out = [];
  for (const [, i] of picks) {
    const x = (i % GRID) / GRID;
    const y = Math.floor(i / GRID) / GRID;
    if (out.some((p) => Math.hypot(p.x - x, p.y - y) < 0.06)) continue;   // one per patch
    out.push({ x, y });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * How each kind of site corrodes. Not a style choice - it is the difference
 * between the places a plate actually goes:
 *
 *   edge     the sheet meets the world. Thin, clean, hugging the margin.
 *   bolt     a fastening. A halo, contained, about the size of the fitting.
 *   vent     an opening. Like a bolt, a little wider, and soot starts here too.
 *   chip     a knock in the coating near something else. Small.
 *   seam     two pieces joined - a weld, a lap, a bimetallic pair. Water gets
 *            UNDER the coating and the rust grows in layers that lift: SCALE.
 *            Thicker, harder-edged, and drawn as its own layer.
 *   exposed  bare metal an earlier event made. Rusts readily, like a seam.
 */
const SITE = Object.freeze({
  edge: { r: 0.07, k: 0.8, shape: 2.4 },
  bolt: { r: 0.06, k: 1, shape: 1.5 },
  vent: { r: 0.08, k: 0.85, shape: 1.3 },
  chip: { r: 0.035, k: 0.9, shape: 1.6 },
  seam: { r: 0.09, k: 1.2, shape: 0.9, scale: true },
  exposed: { r: 0.08, k: 1.15, shape: 1, scale: true },
});

/**
 * The processes. Each reads the surface state, writes what it leaves behind,
 * and returns its own mask. Order is decided by the history, never here.
 *
 * `at` is resolved by the history: a named anchor kind, an explicit point, or
 * the surface left by an earlier event.
 */
const PROCESS = {
  /* Cooking. Discolours, and weakens coating so later rust has somewhere to go. */
  heat(state, r, { at, intensity = 0.5 }) {
    const mask = field();
    for (const p of at) deposit(mask, p.x, p.y, 0.18 + intensity * 0.3, intensity, 1.6);
    const n = noiseField(r, { cells: 3 });
    for (let i = 0; i < mask.length; i++) {
      mask[i] = clamp01(mask[i] * (0.65 + 0.7 * n[i]));
      state.heated[i] = Math.max(state.heated[i], mask[i]);
    }
    return mask;
  },

  /* A strike. Takes the coating off and gouges the metal - the event that
     gives later events somewhere new to act. */
  impact(state, r, { at, severity = 0.5 }) {
    const mask = field();
    for (const p of at) {
      deposit(mask, p.x, p.y, 0.05 + severity * 0.08, 1, 0.55);
      const n = 2 + Math.floor(severity * 4);       // spall around the hit
      for (let k = 0; k < n; k++) {
        deposit(mask, clamp01(p.x + (r() - 0.5) * 0.18), clamp01(p.y + (r() - 0.5) * 0.18),
          0.02 + r() * 0.03, 0.5 + r() * 0.5, 0.7);
      }
    }
    for (let i = 0; i < mask.length; i++) {
      state.exposed[i] = Math.max(state.exposed[i], mask[i]);
      state.damaged[i] = Math.max(state.damaged[i], mask[i]);
    }
    return mask;
  },

  /*
   * Corrosion. The one that reads history rather than making it: it starts at
   * the fittings it is told about AND wherever metal is already bare, so an
   * earlier impact decides where a later rust bloom appears.
   *
   * `density` is how many sites take hold, `progress` how far each one got -
   * three deep blooms and a light speckle everywhere are different plates, and
   * one slider cannot tell them apart.
   */
  oxidation(state, r, { at, density = 0.4, progress = 0.4, stray = 0.2 }) {
    const clean = field();
    const scale = field();
    const sites = [];
    for (const p of at) if (r() < density) sites.push({ x: p.x, y: p.y, kind: p.kind || "bolt" });
    // Bare metal is not a nudge, it is the best site on the plate: wherever an
    // earlier event took the coating off, corrosion STARTS there and grows.
    for (const p of exposedSites(state.exposed)) sites.push({ x: p.x, y: p.y, kind: "exposed" });
    /*
     * A sheet of steel does not rust from the middle of itself. It rusts where
     * the world gets in: at an edge, at a fastening, and worst of all at a
     * SEAM, where an unsealed joint or a chipped coating lets water underneath
     * and the rust grows in layers that lift. So a stray mark is a chipped
     * coating NEAR something, not spontaneous corrosion in open field - the
     * earlier version scattered blooms anywhere and read as stained cloth.
     */
    // Any wear at all has to show somewhere, or the control reads as broken
    // until it is half way across. The first site is a FEATURE, though - the
    // most vulnerable place on the plate goes first, never open field.
    if (!sites.length && density > 0 && at.length) {
      const first = at[Math.floor(r() * at.length)];
      sites.push({ x: first.x, y: first.y, kind: first.kind || "bolt" });
    }
    const strays = density > 0 ? Math.max(1, Math.round(sites.length * stray + density * 2)) : 0;
    for (let i = 0; i < strays && sites.length; i++) {
      const host = sites[Math.floor(r() * sites.length)];
      sites.push({ x: clamp01(host.x + (r() - 0.5) * 0.22), y: clamp01(host.y + (r() - 0.5) * 0.22),
        kind: "chip" });
    }
    // Each kind of site corrodes in its own way. Edges go thin and clean, a
    // fastening haloes, and a seam builds scale: thicker, harder-edged, and
    // drawn as its own layer so it can be a different colour and sit on top.
    for (const s of sites) {
      const k = SITE[s.kind] || SITE.bolt;
      const into = k.scale ? scale : clean;
      deposit(into, s.x, s.y, k.r * (0.5 + progress), k.k * (0.4 + 0.6 * progress), k.shape);
    }
    // Break the discs into islands - without this it is a field of soft dots.
    // Scale breaks harder, which is what makes it read as crust and not stain.
    const n = noiseField(r, { cells: 6, octaves: 3 });
    for (let i = 0; i < clean.length; i++) {
      clean[i] = clamp01(clean[i] * (0.35 + 0.9 * clamp01((n[i] - 0.44) * 3 + 0.5)));
      scale[i] = clamp01(scale[i] * (0.15 + 1.5 * clamp01((n[i] - 0.5) * 6 + 0.5)));
      state.damaged[i] = Math.max(state.damaged[i], Math.max(clean[i], scale[i]) * 0.6);
    }
    return { oxidation: clean, scale };
  },

  /* Soot. Runs with gravity, not with the light: it streaks DOWN from vents
     and from whatever is already damaged. */
  soot(state, r, { at, amount = 0.4, gravity = 90 }) {
    const mask = field();
    const rad = (gravity * Math.PI) / 180;
    const gx = Math.cos(rad);
    const gy = Math.sin(rad);
    for (const p of at) {
      const len = (0.12 + amount * 0.5) * (0.6 + r() * 0.8);
      const steps = Math.max(2, Math.round(len * GRID));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        deposit(mask, clamp01(p.x + gx * len * t + (r() - 0.5) * 0.02),
          clamp01(p.y + gy * len * t + (r() - 0.5) * 0.02),
          0.03 + 0.05 * (1 - t), amount * (1 - t) ** 1.4, 1.4);
      }
    }
    const n = noiseField(r, { cells: 8 });
    for (let i = 0; i < mask.length; i++) mask[i] = clamp01(mask[i] * (0.5 + n[i]));
    return mask;
  },
};

/** How each process is drawn: the tint it wears, how it sits on what is under it. */
export const LOOK = Object.freeze({
  heat: { tint: "heat", blend: "multiply", opacity: 0.55, blur: 2 },
  impact: { tint: "bare", blend: "normal", opacity: 0.9, blur: 0 },
  oxidation: { tint: "rust", blend: "normal", opacity: 0.8, blur: 0.5 },
  // Scale is the crust at a seam: darker, harder, and NOT blurred - the hard
  // edge is the whole point of it against the soft blooms around it.
  scale: { tint: "scale", blend: "normal", opacity: 0.95, blur: 0 },
  soot: { tint: "soot", blend: "multiply", opacity: 0.7, blur: 1.5 },
});

/* ------------------------------------------------------------ histories */

/**
 * Named stories. The theme picks one of these; the generator takes any ordered
 * list, so a storyboard editor can feed it arbitrary events later without this
 * file changing.
 *
 * `at` says where an event acts: a hardware kind, "exposed" for whatever an
 * earlier event laid bare, or an explicit normalized point.
 */
export const HISTORIES = Object.freeze({
  none: [],
  "hangar-queen": [
    { process: "oxidation", at: ["edge", "bolt", "seam"] },
  ],
  "engine-room": [
    { process: "heat", at: ["vent"], intensity: 0.5 },
    { process: "soot", at: ["vent"], amount: 0.45 },
    { process: "oxidation", at: ["edge", "seam", "bolt"] },
  ],
  "battle-scarred": [
    { process: "heat", at: ["vent"], intensity: 0.35 },
    { process: "impact", at: [{ x: 0.72, y: 0.41 }], severity: 0.6 },
    { process: "heat", at: ["exposed"], intensity: 0.7 },
    { process: "oxidation", at: ["edge", "bolt", "seam"] },
    { process: "soot", at: ["exposed", "vent"], amount: 0.3 },
  ],
});

/** Resolve an event's `at` against the hardware and the surface so far. */
function where(at, hw, state) {
  const out = [];
  for (const spec of at || []) {
    if (spec && typeof spec === "object") { out.push(spec); continue; }
    if (spec === "exposed" || spec === "damaged" || spec === "heated") {
      // The strongest few cells of that state - an event acting on what an
      // earlier one left, which is the whole point of an ordered history.
      const f = state[spec];
      let best = [];
      for (let i = 0; i < f.length; i++) if (f[i] > 0.4) best.push([f[i], i]);
      best.sort((a, b) => b[0] - a[0]);
      for (const [, i] of best.slice(0, 3)) out.push({ x: (i % GRID) / GRID, y: Math.floor(i / GRID) / GRID });
      continue;
    }
    for (const a of hw) if (a.kind === spec) out.push(a);
  }
  return out;
}

/**
 * A plate's weathering.
 *
 * `seed` is the plate's own (theme weathering seed + tile id); each event adds
 * its index to it, so event four never disturbs events one to three.
 * Returns `{ layers, state, anchors }`; a layer is `{ process, mask, ...LOOK }`
 * with `mask` a GRID x GRID field of 0..1 for the caller to paint.
 */
export function materialArt({ history = "none", seed = 1, hardware = 1,
  wearDensity = 0.4, wearProgress = 0.4, gravity = 90, events = null, fittings = null } = {}) {
  const list = Array.isArray(events) ? events : (HISTORIES[history] || HISTORIES.none);
  // `fittings` is the hardware somebody else drew - the greebles ON this plate,
  // with their real positions. Corrosion should start where a part MEETS the
  // plate, and it can only do that if it is told where the parts are. Without
  // them the generator invents its own, which is the stand-in, not the point.
  const hw = [...(Array.isArray(fittings) && fittings.length ? fittings : anchors(seed, hardware)),
    ...edgeAnchors(seed, 7, gravity)];
  const state = { exposed: field(), heated: field(), damaged: field() };
  const layers = [];
  list.forEach((ev, i) => {
    const fn = PROCESS[ev.process];
    if (!fn) return;
    const r = seeded(seed + (i + 1) * 7919);       // per-event stream
    const at = where(ev.at, hw, state);
    if (!at.length) return;
    const made = fn(state, r, { ...ev, at, density: ev.density ?? wearDensity,
      progress: ev.progress ?? wearProgress, gravity });
    // A process can leave more than one KIND of mark - oxidation leaves clean
    // rust and, at a seam, scale. Each becomes its own layer so it can carry
    // its own colour and hardness.
    const marks = made instanceof Float64Array ? { [ev.process]: made } : made;
    for (const [name, mask] of Object.entries(marks)) {
      let any = false;
      for (let k = 0; k < mask.length; k++) if (mask[k] > 0.02) { any = true; break; }
      if (any) layers.push({ process: name, mask, ...LOOK[name] });
    }
  });
  return { layers, state, anchors: hw };
}

/**
 * What the weathering does to the ground under TEXT, as a luminance range.
 *
 * Swing alone is the wrong measure: a bright vein at 5% coverage is dramatic
 * and harmless, while a broad mottle at 40% eats a glyph. So the composite is
 * blurred to the size of a letter first - thin marks average away, anything
 * wide enough to sit under a stroke survives - and the range of what is left
 * is what has to stay small.
 */
export function composite(layers) {
  const out = field();
  for (const l of layers) {
    for (let i = 0; i < out.length; i++) out[i] = clamp01(out[i] + l.mask[i] * l.opacity);
  }
  return out;
}

/**
 * A field as a mask image the browser can use.
 *
 * White reveals, black hides, so the field IS the alpha of a luminance mask.
 * Drawn on a canvas because a field is pixels; the greebles are SVG because
 * they are shapes. In Node there is no canvas and no painting to do, so this
 * returns null and the tests stay on the fields, where the logic is.
 */
export function maskUri(mask, { size = 256, seed = 1, detail = 0.85 } = {}) {
  if (typeof document === "undefined" || !document.createElement) return null;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  // The history runs on a coarse field because that is all the physics needs.
  // Painting it straight would stretch 64 cells over a 350px tile, and every
  // bloom edge becomes a soft gradient - airbrushed cloud, not corrosion. So
  // the field is upsampled and multiplied by FINE noise at paint scale, which
  // is where the crust, the islands and the pitting actually live.
  const fine = noiseField(seeded(seed + 31337), { cells: 16, octaves: 4, size });
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * (GRID - 1);
      const fy = (y / size) * (GRID - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const a = mask[y0 * GRID + x0];
      const b = mask[y0 * GRID + Math.min(GRID - 1, x0 + 1)];
      const cc = mask[Math.min(GRID - 1, y0 + 1) * GRID + x0];
      const d = mask[Math.min(GRID - 1, y0 + 1) * GRID + Math.min(GRID - 1, x0 + 1)];
      const base = (a + (b - a) * tx) + ((cc + (d - cc) * tx) - (a + (b - a) * tx)) * ty;
      const n = fine[y * size + x];
      // Crust: the detail eats into the edge, so a bloom breaks up where it is
      // thin and stays solid where it is deep.
      const v = clamp01(base * (1 - detail + detail * 2 * n) - (1 - base) * 0.15);
      const px = (y * size + x) * 4;
      const g = Math.round(v * 255);
      img.data[px] = g;
      img.data[px + 1] = g;
      img.data[px + 2] = g;
      img.data[px + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

/** Where this plate's crop of its masks starts - so twelve tiles are not one tile twelve times. */
export function cropOffset(seed) {
  const r = seeded(seed + 104729);
  return `${Math.round(r() * 100)}% ${Math.round(r() * 100)}%`;
}

/** Box-blur a field by `cells`, then the range of what is left. */
export function legibilityRange(f, cells = 5) {
  const pass = (src) => {
    const dst = field();
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -cells; k <= cells; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= GRID) continue;
          sum += src[idx(xx, y)];
          n++;
        }
        dst[idx(x, y)] = sum / n;
      }
    }
    const t = field();
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -cells; k <= cells; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= GRID) continue;
          sum += dst[idx(x, yy)];
          n++;
        }
        t[idx(x, y)] = sum / n;
      }
    }
    return t;
  };
  const b = pass(f);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of b) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi - lo;
}
