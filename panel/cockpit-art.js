/**
 * Greebles and surface texture for the cockpit frame - generated SVG, handed to
 * the stylesheet as data URIs. No DOM.
 *
 * Greebles are HARDWARE: raised angular plates, hatches with stencilled part
 * numbers, conduit with clamps, slanted ribs, hex bolts, vent slots. They are
 * LIT - they never emit light. A lamp on a dashboard reads as data, and one
 * that means nothing teaches you to ignore the ones that do.
 *
 * Each part is geometry (convex polygons, raised or recessed); `light` decides
 * how it is shaded. Every edge's outward normal is compared with the direction
 * the light comes from: an edge facing it gets a highlight in proportion, an
 * edge facing away gets shadow. A raised part casts a short shadow on the plate
 * opposite the light, darker as the light gets stronger; a hole is the reverse
 * of a raised part - its far wall catches the light.
 *
 * `greebleArt(density, light)`: density 0 is a bare plate, 1 is packed. Each
 * surface has a fixed seed and fixed slots, so the same density always gives
 * the same layout and dragging it adds or removes hardware in place. Light only
 * changes shading, never placement. All of it is white or black at low alpha,
 * never a colour, so it falls correctly on whatever plate colour a theme gives.
 */

const INK = "rgba(255,255,255,.22)";      // stencil paint - paint, not light
const LABELS = ["PNL 04-B", "C-7", "AUX 2", "PWR", "B1-7", "HX-3", "07", "SVC", "4A"];

/** Shading strengths, per unit of light intensity. At 0 deg and .6 these are the frame's original look. */
const HI = 0.3;       // a highlight on an edge facing the light
const SH = 1.0;       // shadow on an edge facing away
const FACE = 0.083;   // a raised face
const CAST = 0.45;    // a cast shadow
const CAST_PX = 2.5;  // how far it falls
const RECESS = "rgba(0,0,0,.5)";

const n = (v) => Math.round(v * 10) / 10;
const a3 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
const pts = (list) => list.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");

/** A small seeded generator (mulberry32): the same seed, the same sequence. */
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The light: `angle` in degrees is where it comes FROM, clockwise from above
 * (0 above, 90 from the right); `intensity` 0-1. Returns the unit vector
 * pointing from a surface toward the light, in screen space (y runs down).
 */
export function lightOf({ angle = 0, intensity = 0.6 } = {}) {
  const r = ((Number(angle) || 0) * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r), k: Math.max(0, Math.min(1, Number(intensity) || 0)) };
}

/**
 * How each edge of a convex polygon is lit: [{ from, to, hi, sh }] with the
 * highlight and shadow alphas. A recess uses the inward normal - its walls face
 * into the hole. Pure; the tests read it directly.
 */
export function shadeEdges(points, light, { raised = true } = {}) {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  return points.map((from, i) => {
    const to = points[(i + 1) % points.length];
    let nx = to[1] - from[1];
    let ny = -(to[0] - from[0]);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const mx = (from[0] + to[0]) / 2 - cx;
    const my = (from[1] + to[1]) / 2 - cy;
    if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }            // outward
    const facing = (raised ? 1 : -1) * (nx * light.x + ny * light.y);
    return { from, to, hi: facing > 0.05 ? a3(HI * light.k * facing) : 0, sh: facing < -0.05 ? a3(SH * light.k * -facing) : 0 };
  });
}

/** One shape, shaded: cast shadow, face, then its lit and shadowed edges. */
function draw(shape, light) {
  const { points, raised } = shape;
  let s = "";
  if (raised && light.k > 0) {
    const cast = points.map(([x, y]) => [x - light.x * CAST_PX, y - light.y * CAST_PX]);
    s += `<polygon points="${pts(cast)}" fill="rgba(0,0,0,${a3(CAST * light.k)})"/>`;
  }
  s += `<polygon points="${pts(points)}" fill="${raised ? `rgba(255,255,255,${a3(FACE * light.k)})` : RECESS}"/>`;
  for (const e of shadeEdges(points, light, { raised })) {
    if (!e.hi && !e.sh) continue;
    const stroke = e.hi ? `rgba(255,255,255,${e.hi})` : `rgba(0,0,0,${e.sh})`;
    s += `<line x1="${n(e.from[0])}" y1="${n(e.from[1])}" x2="${n(e.to[0])}" y2="${n(e.to[1])}" stroke="${stroke}"/>`;
  }
  return s;
}

/* ------------------------------------------------------------ the parts
   Each returns shapes: { points, raised }. */

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function plate(x, y, w, h, cut = 7) {
  return [{ raised: true, points: [[x, y + cut], [x + cut, y], [x + w - cut, y], [x + w, y + cut], [x + w, y + h], [x, y + h]] }];
}
function vents(x, y, count, w, h, gap) {
  return Array.from({ length: count }, (_, i) => ({ raised: false, points: rect(x + i * (w + gap), y, w, h) }));
}
function conduit(x, y, len, clamps) {
  return [{ raised: true, points: rect(x, y, len, 7) },
    ...clamps.map((c) => ({ raised: true, points: rect(x + c, y - 3, 5, 13) }))];
}
function hatch(x, y, w, h) {
  const c = 8;
  return [{ raised: true, points: [[x, y], [x + w, y], [x + w, y + h - c], [x + w - c, y + h], [x, y + h]] }];
}
function ribs(x, y, count, h) {
  return Array.from({ length: count }, (_, i) => {
    const rx = x + i * 13;
    return { raised: true, points: [[rx, y + h], [rx + 8, y], [rx + 14, y], [rx + 6, y + h]] };
  });
}
function bolt(cx, cy, r = 4) {
  return { raised: true, points: [0, 1, 2, 3, 4, 5].map((i) => [cx + r * Math.cos((Math.PI / 3) * i), cy + r * Math.sin((Math.PI / 3) * i)]) };
}
const stencil = (x, y, label) =>
  `<text x="${n(x)}" y="${n(y)}" font-family="monospace" font-size="7" letter-spacing="1" fill="${INK}">${label}</text>`;

/**
 * One module for a horizontal run of height `h`, at `x`, at most `room` wide:
 * { shapes, text, width } or null if it does not fit. Draws from `r` the same
 * way whatever the density or light, so placement never depends on either.
 */
function module(r, x, h, room) {
  const kinds = [
    () => { const w = 40 + r() * 70; return { shapes: plate(x, h * .17, w, h * .6), width: w }; },
    () => { const k = 3 + Math.floor(r() * 5); return { shapes: vents(x, h * .28, k, 6, h * .44, 4), width: k * 10 - 4 }; },
    () => { const w = 60 + r() * 80; return { shapes: conduit(x, h / 2 - 3.5, w, [w * .15, w * .55, w * .85].map(Math.round)), width: w }; },
    () => {
      const w = 44 + r() * 36;
      const label = LABELS[Math.floor(r() * LABELS.length)];
      return { shapes: hatch(x, h * .14, w, h * .7), text: w >= 34 ? stencil(x + 6, h * .14 + h * .35 + 3, label) : "", width: w };
    },
    () => { const k = 3 + Math.floor(r() * 4); return { shapes: ribs(x, h * .22, k, h * .56), width: k * 13 + 1 }; },
    () => { const k = 1 + Math.floor(r() * 3); return { shapes: Array.from({ length: k }, (_, i) => bolt(x + 5 + i * 14, h / 2)), width: k * 14 }; },
  ];
  const made = kinds[Math.floor(r() * kinds.length)]();
  return made.width <= room ? made : null;
}

/**
 * A horizontal run `w` wide. Where the slots fall, what goes in each and each
 * slot's keep roll come from `r` alone - never from density or light - so the
 * layout is fixed and density only decides which slots are shown: raising it
 * adds hardware in place, lowering it takes hardware away, nothing moves.
 * Returns the SVG body, the count and where each placed slot sits, as "slot@x"
 * (the tests read those - a slot that keeps its number but moves is a reshuffle).
 */
function run(r, w, h, density, light) {
  let body = "";
  const placed = [];
  let x = 6;
  for (let slot = 0; x < w - 12; slot++) {
    const m = module(r, x, h, w - 6 - x);
    if (!m) break;
    if (r() < density) {
      body += m.shapes.map((s) => draw(s, light)).join("") + (m.text || "");
      placed.push(`${slot}@${n(x)}`);
    }
    x += m.width + 4 + r() * 12;
  }
  return { body, count: placed.length, placed };
}

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${body}</svg>`;
const uri = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

/** Fine metal grain: white speckle at low alpha, tiling. Not density- or light-driven. */
export const GRAIN = uri(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">`
  + `<filter id="g" x="0" y="0"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>`
  + `<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .09 0"/></filter>`
  + `<rect width="160" height="160" filter="url(#g)"/></svg>`);

const tileCache = new Map();

/**
 * Hardware on a PLATE rather than along a run - what a tile carries.
 *
 * Fittings belong at the margins of a panel, which is where they are in life
 * (a plate is bolted round its edges) and also where the text is not, so the
 * hardware costs nothing to read. The middle is left clear on purpose.
 *
 * Returns the art AND the footprints, in normalized coordinates, because the
 * weathering hangs off them: corrosion starts where a part meets the plate,
 * and a part that is bolted down PROTECTS what is under it. Same fixed-slot
 * rule as the runs - position and kind come from the seed alone, `density`
 * only decides which slots are there.
 */
export function tileGreebles(seed, density = 0.6, lightIn = {}) {
  const d = Math.max(0, Math.min(1, Math.round(density * 100) / 100));
  const angle = Math.round((((Number(lightIn.angle) || 0) % 360) + 360) % 360);
  const intensity = Math.round((lightIn.intensity ?? 0.6) * 100) / 100;
  const key = `${seed}|${d}|${angle}|${intensity}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const light = lightOf({ angle, intensity });
  const r = seeded(seed);
  const W = 240;
  const H = 160;
  const parts = [];
  let body = "";
  // Six slots round the margin: three along the bottom, one each side, one top
  // right. Fixed places, so hardware appears and disappears without moving.
  const slots = [
    { x: 14, y: H - 22, h: 18 }, { x: 92, y: H - 22, h: 18 }, { x: 170, y: H - 22, h: 18 },
    { x: 8, y: 30, h: 16 }, { x: W - 66, y: 12, h: 16 }, { x: W - 58, y: 74, h: 16 },
  ];
  for (const [i, s] of slots.entries()) {
    // Two tries: a module names its own width and returns nothing when it does
    // not fit, and at one try most slots came back empty - so the density
    // control had almost nothing left to decide.
    const m = module(r, s.x, s.h, Math.min(86, W - 8 - s.x))
      || module(r, s.x, s.h, Math.min(86, W - 8 - s.x));
    const keep = r();
    if (!m || keep >= d) continue;
    body += `<g transform="translate(0 ${n(s.y)})">`
      + m.shapes.map((sh) => draw(sh, light)).join("") + (m.text || "") + "</g>";
    parts.push({ id: `t${i}`, kind: m.width > 50 ? "seam" : "bolt",
      x: (s.x + m.width / 2) / W, y: (s.y + s.h / 2) / H,
      w: m.width / W, h: s.h / H });
  }
  const art = { uri: parts.length ? uri(svg(W, H, body)) : null, parts, W, H };
  tileCache.set(key, art);
  return art;
}

const cache = new Map();

/**
 * The cockpit's greebles at a density from 0 to 1, under a light
 * ({ angle, intensity }, see lightOf), as CSS values:
 *   strip   either side of the glare shield's cluster (tiles across)
 *   corner  the shield's left cell
 *   column  the side console's open space (tiles down)
 * plus `counts` and `placed` ("slot@x"). The same inputs give the same art,
 * and a higher density keeps every module a lower one placed.
 */
export function greebleArt(density, lightIn = {}) {
  const d = Math.max(0, Math.min(1, Math.round((Number(density) || 0) * 100) / 100));
  const angle = Math.round((((Number(lightIn.angle) || 0) % 360) + 360) % 360);
  const intensity = Math.round((lightIn.intensity ?? 0.6) * 100) / 100;
  const key = `${d}|${angle}|${intensity}`;
  if (cache.has(key)) return cache.get(key);
  const light = lightOf({ angle, intensity });
  const strip = run(seeded(1977), 640, 36, d, light);
  const corner = run(seeded(1983), 110, 30, d, light);
  const rows = [];
  let colBody = "";
  const r = seeded(2015);
  for (let y = 0; y < 180; y += 34) {
    const row = run(r, 138, 30, d, light);
    rows.push(row.count);
    colBody += `<g transform="translate(0 ${y})">${row.body}</g>`;
  }
  const art = {
    strip: uri(svg(640, 36, strip.body)),
    corner: uri(svg(150, 60, `<g transform="translate(34 6)">${corner.body}</g>`)),
    column: uri(svg(138, 204, colBody)),
    counts: { strip: strip.count, corner: corner.count, column: rows.reduce((a, b) => a + b, 0) },
    placed: { strip: strip.placed, corner: corner.placed },
  };
  cache.set(key, art);
  return art;
}
