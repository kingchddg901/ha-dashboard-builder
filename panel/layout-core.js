/**
 * The layout core - tabs of tiles on a snap grid. No DOM, no Home Assistant.
 *
 * A tile is a SHAPE: a rectangle of whole cells. What renders inside it is data
 * the tile carries (`kind` + `config`) and is none of this file's business, so
 * the rules here hold for any renderer, including ones not written yet.
 *
 * The invariants, and every function below keeps them:
 *   - tiles sit on whole cells, inside the column count, and never overlap;
 *   - an edit that would break that is REFUSED and says why - it is never
 *     "fixed" by nudging a neighbour, because a layout that rearranges itself
 *     under your finger is worse than one that says no;
 *   - a tile is never silently lost: removing one puts it on the shelf, and
 *     damaged stored data is repaired by relocating, not dropping.
 *
 * Every function returns a NEW dashboard; nothing is mutated in place.
 */

export const COLS = 12;
export const SCHEMA = 1;

const int = (v) => Number.isInteger(v);

export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Inside the grid and made of whole cells. */
export function inBounds(r, cols = COLS) {
  return int(r.x) && int(r.y) && int(r.w) && int(r.h)
    && r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= cols;
}

/** Why a rectangle cannot go here, or null if it can. */
export function whyNot(tiles, rect, { cols = COLS, ignore = null } = {}) {
  if (!inBounds(rect, cols)) return "outside the grid";
  const hit = tiles.find((t) => t.id !== ignore && overlaps(t, rect));
  return hit ? `overlaps ${hit.id}` : null;
}

export const canPlace = (tiles, rect, opts) => whyNot(tiles, rect, opts) === null;

/** The first free w x h slot in reading order: top row first, then left to right. */
export function firstFit(tiles, w, h, cols = COLS) {
  const width = Math.min(Math.max(1, w), cols);
  for (let y = 0; ; y++) {
    for (let x = 0; x + width <= cols; x++) {
      if (canPlace(tiles, { x, y, w: width, h }, { cols })) return { x, y, w: width, h };
    }
  }
}

/** Rows the grid needs to show every tile. */
export const gridRows = (tiles) => tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0);

/** Phone order: the desk layout read like a page. Same data, no second list to keep. */
export function readingOrder(tiles) {
  return tiles.slice().sort((a, b) => a.y - b.y || a.x - b.x);
}

const tabOf = (dash, tabId) => dash.tabs.find((t) => t.id === tabId) || null;
const withTab = (dash, tabId, fn) => ({
  ...dash, tabs: dash.tabs.map((t) => (t.id === tabId ? fn(t) : t)),
});

/** Where a tile lives: `{ tab, tile }`, or null. */
export function findTile(dash, tileId) {
  for (const tab of dash.tabs) {
    const tile = tab.tiles.find((t) => t.id === tileId);
    if (tile) return { tab, tile };
  }
  return null;
}

/**
 * Move and/or resize one tile within its tab.
 * Returns `{ ok, dash, reason }`; on refusal `dash` is the input, untouched.
 */
export function placeTile(dash, tileId, rect, { cols = dash.cols || COLS } = {}) {
  const at = findTile(dash, tileId);
  if (!at) return { ok: false, dash, reason: "no such tile" };
  const next = { x: rect.x ?? at.tile.x, y: rect.y ?? at.tile.y, w: rect.w ?? at.tile.w, h: rect.h ?? at.tile.h };
  const reason = whyNot(at.tab.tiles, next, { cols, ignore: tileId });
  if (reason) return { ok: false, dash, reason };
  return { ok: true, reason: null, dash: withTab(dash, at.tab.id, (tab) => ({
    ...tab, tiles: tab.tiles.map((t) => (t.id === tileId ? { ...t, ...next } : t)),
  })) };
}

/**
 * Send a tile to another tab. It keeps its size and takes the first free slot
 * there - the grid grows downward, so a slot always exists.
 */
export function moveToTab(dash, tileId, toTabId) {
  const at = findTile(dash, tileId);
  const dest = tabOf(dash, toTabId);
  if (!at) return { ok: false, dash, reason: "no such tile" };
  if (!dest) return { ok: false, dash, reason: "no such tab" };
  if (dest.id === at.tab.id) return { ok: false, dash, reason: "already on that tab" };
  const cols = dash.cols || COLS;
  const spot = firstFit(dest.tiles, at.tile.w, at.tile.h, cols);
  const moved = { ...at.tile, ...spot };
  let out = withTab(dash, at.tab.id, (tab) => ({ ...tab, tiles: tab.tiles.filter((t) => t.id !== tileId) }));
  out = withTab(out, dest.id, (tab) => ({ ...tab, tiles: [...tab.tiles, moved] }));
  return { ok: true, dash: out, reason: null };
}

/** Take a tile off the grid and keep it on the shelf, so removing is never losing. */
export function shelveTile(dash, tileId) {
  const at = findTile(dash, tileId);
  if (!at) return { ok: false, dash, reason: "no such tile" };
  const { x, y, ...kept } = at.tile;
  const out = withTab(dash, at.tab.id, (tab) => ({ ...tab, tiles: tab.tiles.filter((t) => t.id !== tileId) }));
  return { ok: true, reason: null, dash: { ...out, shelf: [...(out.shelf || []), kept] } };
}

/** Put a shelved tile back, at the first free slot of a tab. */
export function unshelveTile(dash, tileId, tabId) {
  const item = (dash.shelf || []).find((t) => t.id === tileId);
  const dest = tabOf(dash, tabId);
  if (!item) return { ok: false, dash, reason: "not on the shelf" };
  if (!dest) return { ok: false, dash, reason: "no such tab" };
  const spot = firstFit(dest.tiles, item.w || 4, item.h || 4, dash.cols || COLS);
  const out = { ...dash, shelf: dash.shelf.filter((t) => t.id !== tileId) };
  return { ok: true, reason: null, dash: withTab(out, dest.id, (tab) => ({ ...tab, tiles: [...tab.tiles, { ...item, ...spot }] })) };
}

export function addTab(dash, title) {
  let n = dash.tabs.length + 1;
  const taken = new Set(dash.tabs.map((t) => t.id));
  while (taken.has(`tab${n}`)) n++;
  const tab = { id: `tab${n}`, title: String(title || `Tab ${n}`).trim() || `Tab ${n}`, tiles: [] };
  return { ok: true, reason: null, tab, dash: { ...dash, tabs: [...dash.tabs, tab] } };
}

export function renameTab(dash, tabId, title) {
  const name = String(title ?? "").trim();
  if (!name) return { ok: false, dash, reason: "a tab needs a name" };
  if (!tabOf(dash, tabId)) return { ok: false, dash, reason: "no such tab" };
  return { ok: true, reason: null, dash: withTab(dash, tabId, (t) => ({ ...t, title: name })) };
}

/** Only an empty tab can go - a tab with tiles on it is refused, not emptied for you. */
export function removeTab(dash, tabId) {
  const tab = tabOf(dash, tabId);
  if (!tab) return { ok: false, dash, reason: "no such tab" };
  if (tab.tiles.length) return { ok: false, dash, reason: "move or shelve its tiles first" };
  if (dash.tabs.length === 1) return { ok: false, dash, reason: "the last tab stays" };
  return { ok: true, reason: null, dash: { ...dash, tabs: dash.tabs.filter((t) => t.id !== tabId) } };
}

/**
 * Stored data -> a dashboard that keeps every invariant.
 *
 * Not the right shape at all, or another schema version -> the seed, because
 * there is nothing trustworthy to repair. Otherwise REPAIR, never drop: a tile
 * with a bad size is given a sane one, and a tile that overlaps or falls outside
 * the grid is moved to the first free slot. A tile whose `kind` nobody renders
 * is kept as-is - the renderer may simply not be loaded yet.
 */
export function sanitize(raw, seed) {
  if (!raw || typeof raw !== "object" || raw.v !== SCHEMA || !Array.isArray(raw.tabs) || !raw.tabs.length) {
    return { dash: seed, repaired: raw == null ? [] : ["unreadable - using the starting layout"] };
  }
  const cols = int(raw.cols) && raw.cols > 0 ? raw.cols : COLS;
  const repaired = [];
  const seen = new Set();
  const tile = (t, where) => {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || !t.id || seen.has(t.id)) {
      repaired.push(`dropped an unnamed or duplicate tile on ${where}`);
      return null;
    }
    seen.add(t.id);
    const w = int(t.w) && t.w >= 1 ? Math.min(t.w, cols) : 4;
    const h = int(t.h) && t.h >= 1 ? t.h : 4;
    if (w !== t.w || h !== t.h) repaired.push(`${t.id}: bad size`);
    return { ...t, w, h };
  };
  const tabs = [];
  const tabIds = new Set();
  for (const [i, tab] of raw.tabs.entries()) {
    let id = typeof tab?.id === "string" && tab.id ? tab.id : `tab${i + 1}`;
    while (tabIds.has(id)) id = `${id}_`;
    tabIds.add(id);
    const placed = [];
    for (const t0 of Array.isArray(tab?.tiles) ? tab.tiles : []) {
      const t = tile(t0, id);
      if (!t) continue;
      if (canPlace(placed, t, { cols })) { placed.push(t); continue; }
      repaired.push(`${t.id}: relocated`);
      placed.push({ ...t, ...firstFit(placed, t.w, t.h, cols) });
    }
    tabs.push({ id, title: String(tab?.title || `Tab ${i + 1}`), tiles: placed });
  }
  const shelf = (Array.isArray(raw.shelf) ? raw.shelf : []).map((t) => tile(t, "the shelf")).filter(Boolean)
    .map(({ x, y, ...rest }) => rest);
  return { dash: { v: SCHEMA, cols, tabs, shelf }, repaired };
}

/** Pointer offset in pixels -> whole cells, for a drag or a resize. */
export function cellsFromPixels(dx, dy, { cellW, rowH, gap }) {
  return { dx: Math.round(dx / (cellW + gap)), dy: Math.round(dy / (rowH + gap)) };
}
