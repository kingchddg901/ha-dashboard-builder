/**
 * Greebles and surface texture for the cockpit frame - generated SVG, handed to
 * the stylesheet as data URIs. No DOM.
 *
 * Greebles are HARDWARE, lit from one source above: raised angular plates with
 * a bright top edge and a dark underside, hatches with stencilled part numbers,
 * conduit with clamps, slanted ribs, hex bolts, vent slots. They never emit
 * light - a lamp on a dashboard reads as data, and one that means nothing
 * teaches you to ignore the ones that do.
 *
 * `greebleArt(density)` lays them out: density 0 is a bare plate, 1 is packed.
 * Each surface has a fixed seed, so the same density always gives the same
 * layout - dragging the slider adds and removes hardware, it does not reshuffle
 * it. All lighting is white or black at low alpha, never a colour, so it falls
 * correctly on whatever plate colour a theme gives the frame.
 */

const LIT = "rgba(255,255,255,.18)";      // an edge facing the light
const FACE = "rgba(255,255,255,.05)";     // a raised face
const SHADE = "rgba(0,0,0,.6)";           // an edge facing away
const RECESS = "rgba(0,0,0,.5)";          // a hole
const INK = "rgba(255,255,255,.22)";      // stencil paint
const LABELS = ["PNL 04-B", "C-7", "AUX 2", "PWR", "B1-7", "HX-3", "07", "SVC", "4A"];

const n = (v) => Math.round(v * 10) / 10;
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

/* ------------------------------------------------------------ the parts */

function plate(x, y, w, h, cut = 7) {
  const top = [[x, y + cut], [x + cut, y], [x + w - cut, y], [x + w, y + cut]];
  return `<polygon points="${pts([...top, [x + w, y + h], [x, y + h]])}" fill="${FACE}"/>`
    + `<polyline points="${pts(top)}" fill="none" stroke="${LIT}"/>`
    + `<line x1="${n(x)}" y1="${n(y + h + .5)}" x2="${n(x + w)}" y2="${n(y + h + .5)}" stroke="${SHADE}"/>`;
}

function vents(x, y, count, w, h, gap) {
  let s = "";
  for (let i = 0; i < count; i++) {
    const vx = x + i * (w + gap);
    s += `<rect x="${n(vx)}" y="${n(y)}" width="${w}" height="${h}" fill="${RECESS}"/>`
      + `<line x1="${n(vx)}" y1="${n(y + h + .5)}" x2="${n(vx + w)}" y2="${n(y + h + .5)}" stroke="${LIT}" stroke-opacity=".7"/>`;
  }
  return s;
}

function conduit(x, y, len, clamps) {
  let s = `<rect x="${n(x)}" y="${n(y)}" width="${n(len)}" height="7" fill="${FACE}"/>`
    + `<line x1="${n(x)}" y1="${n(y + .5)}" x2="${n(x + len)}" y2="${n(y + .5)}" stroke="${LIT}"/>`
    + `<line x1="${n(x)}" y1="${n(y + 7.5)}" x2="${n(x + len)}" y2="${n(y + 7.5)}" stroke="${SHADE}"/>`;
  for (const c of clamps) {
    s += `<rect x="${n(x + c)}" y="${n(y - 3)}" width="5" height="13" fill="rgba(255,255,255,.08)"/>`
      + `<line x1="${n(x + c)}" y1="${n(y - 2.5)}" x2="${n(x + c + 5)}" y2="${n(y - 2.5)}" stroke="${LIT}"/>`
      + `<line x1="${n(x + c)}" y1="${n(y + 10.5)}" x2="${n(x + c + 5)}" y2="${n(y + 10.5)}" stroke="${SHADE}"/>`;
  }
  return s;
}

function hatch(x, y, w, h, label) {
  const c = 8;
  return `<polygon points="${pts([[x, y], [x + w, y], [x + w, y + h - c], [x + w - c, y + h], [x, y + h]])}" fill="${FACE}" stroke="${SHADE}"/>`
    + `<polyline points="${pts([[x, y + h], [x, y], [x + w, y]])}" fill="none" stroke="${LIT}"/>`
    + (w >= 34 ? `<text x="${n(x + 6)}" y="${n(y + h / 2 + 3)}" font-family="monospace" font-size="7" letter-spacing="1" fill="${INK}">${label}</text>` : "");
}

function ribs(x, y, count, h) {
  let s = "";
  for (let i = 0; i < count; i++) {
    const rx = x + i * 13;
    s += `<polygon points="${pts([[rx, y + h], [rx + 8, y], [rx + 14, y], [rx + 6, y + h]])}" fill="${FACE}"/>`
      + `<line x1="${n(rx)}" y1="${n(y + h)}" x2="${n(rx + 8)}" y2="${n(y)}" stroke="${LIT}"/>`;
  }
  return s;
}

function bolt(cx, cy, r = 4) {
  const hex = [0, 1, 2, 3, 4, 5].map((i) => [cx + r * Math.cos((Math.PI / 3) * i), cy + r * Math.sin((Math.PI / 3) * i)]);
  return `<polygon points="${pts(hex)}" fill="rgba(255,255,255,.07)" stroke="${SHADE}"/>`
    + `<polyline points="${pts([hex[3], hex[4], hex[5], hex[0]])}" fill="none" stroke="${LIT}"/>`;
}

/**
 * One module for a horizontal run of height `h`, at `x`, at most `room` wide.
 * Returns [svg, width] or null if nothing fits.
 */
function module(r, x, h, room) {
  const kinds = [
    () => { const w = 40 + r() * 70; return [plate(x, h * .17, w, h * .6), w]; },
    () => { const k = 3 + Math.floor(r() * 5); return [vents(x, h * .28, k, 6, h * .44, 4), k * 10 - 4]; },
    () => { const w = 60 + r() * 80; return [conduit(x, h / 2 - 3.5, w, [w * .15, w * .55, w * .85].map(Math.round)), w]; },
    () => { const w = 44 + r() * 36; return [hatch(x, h * .14, w, h * .7, LABELS[Math.floor(r() * LABELS.length)]), w]; },
    () => { const k = 3 + Math.floor(r() * 4); return [ribs(x, h * .22, k, h * .56), k * 13 + 1]; },
    () => { const k = 1 + Math.floor(r() * 3); let s = ""; for (let i = 0; i < k; i++) s += bolt(x + 5 + i * 14, h / 2); return [s, k * 14]; },
  ];
  const made = kinds[Math.floor(r() * kinds.length)]();
  return made[1] <= room ? made : null;
}

/**
 * A horizontal run `w` wide. Where the slots fall, what goes in each and each
 * slot's keep roll come from `r` alone - never from density - so the layout is
 * fixed and density only decides which slots are shown: raising it adds
 * hardware in place, lowering it takes hardware away, nothing moves. Returns
 * the SVG body, the count and where each placed slot sits, as "slot@x" (the
 * tests read those - a slot that keeps its number but moves is a reshuffle).
 */
function run(r, w, h, density) {
  let body = "";
  const placed = [];
  let x = 6;
  for (let slot = 0; x < w - 12; slot++) {
    const m = module(r, x, h, w - 6 - x);
    if (!m) break;
    const [svg, mw] = m;
    if (r() < density) { body += svg; placed.push(`${slot}@${n(x)}`); }
    x += mw + 4 + r() * 12;
  }
  return { body, count: placed.length, placed };
}

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${body}</svg>`;
const uri = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

/** Fine metal grain: white speckle at low alpha, tiling. Not density-driven. */
export const GRAIN = uri(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">`
  + `<filter id="g" x="0" y="0"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>`
  + `<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .09 0"/></filter>`
  + `<rect width="160" height="160" filter="url(#g)"/></svg>`);

const cache = new Map();

/**
 * The cockpit's greebles at a density from 0 to 1, as CSS values:
 *   strip   either side of the glare shield's cluster (tiles across)
 *   corner  the shield's left cell
 *   column  the side console's open space (tiles down)
 * plus `counts` and `placed` ("slot@x"). The same density gives the same
 * art, and a higher density keeps every module a lower one placed.
 */
export function greebleArt(density) {
  const d = Math.max(0, Math.min(1, Math.round((Number(density) || 0) * 100) / 100));
  if (cache.has(d)) return cache.get(d);
  const strip = run(seeded(1977), 640, 36, d);
  const corner = run(seeded(1983), 110, 30, d);
  const rows = [];
  let colBody = "";
  const r = seeded(2015);
  for (let y = 0; y < 180; y += 34) {
    const row = run(r, 138, 30, d);
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
  cache.set(d, art);
  return art;
}
