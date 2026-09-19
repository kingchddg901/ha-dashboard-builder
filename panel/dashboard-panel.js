/**
 * Dashboard Builder - the panel. Version 1.0: the base everything else sits in.
 *
 * The panel owns the whole area and the render. Tiles are SHAPES on a snap
 * grid; what fills each one is a declaration handed to a renderer from the
 * closed registry in ./renderers.js. The rules for the grid live in
 * ./layout-core.js with their tests - this file is the disposable half.
 *
 *   desk  (panel wider than PHONE_MAX): tabs down the rail, tiles on the grid,
 *         and an edit mode to move, resize, send to another tab, or shelve
 *   phone (narrower): the same tiles as status rows in reading order; a tap
 *         opens the full control in a sheet
 *
 * Runs two ways with the same code:
 *   - as a sidebar panel through panel_custom (the `panel` / `narrow` props)
 *   - as a Lovelace card in a `panel` view (`setConfig`), which needs no restart
 *
 * The layout is stored per HA user with frontend/set_user_data under
 * STORE_KEY. Nothing is written until a layout is actually edited; until then
 * the starting layout in ./seed.js is shown.
 */

import { SEED } from "./seed.js";
import {
  sanitize, placeTile, moveToTab, shelveTile, unshelveTile, addTab, renameTab, removeTab,
  gridRows, readingOrder, cellsFromPixels, whyNot, findTile, COLS, copyToTab, availableFrom, addTile,
} from "./layout-core.js";
import { RENDERERS, rendererFor } from "./renderers.js";
import { tokenVar as T } from "./tokens.js";

const STORE_KEY = "dashboard_builder.layout";
const TAB_KEY = "dashboard_builder.tab";
const PHONE_MAX = 700;
const ROW_H = 64;
const GAP = 8;

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* private window - fine */ } },
};

class DashboardBuilderPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._dash = null;
    this._tab = null;
    this._edit = false;
    this._mode = "desk";
    this._els = new Map();       // tile id -> { sig, el, error }
    this._sheetId = null;
    this._status = "";
    this._narrow = false;
    this._asCard = false;
    this._resetArmed = null;
    this._onKey = (e) => { if (e.key === "Escape" && this._sheetId) this._closeSheet(); };
  }

  /* ---------------------------------------------------- Home Assistant API */

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
    else this._update();
  }

  get hass() { return this._hass; }
  set narrow(v) { const n = Boolean(v); if (n !== this._narrow) { this._narrow = n; this._render(); } }
  set panel(p) { this._panel = p; }
  set route(r) { this._route = r; }

  // Lovelace card mode: the same element inside a `panel` view, no restart needed.
  setConfig(config) { this._asCard = true; this._cardConfig = config || {}; }
  getCardSize() { return 12; }

  connectedCallback() {
    if (!this._ro && typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => this._measure());
      this._ro.observe(this);
    }
    document.addEventListener("keydown", this._onKey);
    this._measure();
  }

  disconnectedCallback() {
    this._ro?.disconnect(); this._ro = null;
    document.removeEventListener("keydown", this._onKey);
  }

  /**
   * Height comes from WHERE THE HOST STARTS, measured - not from an assumed
   * toolbar. As a panel HA draws no toolbar (top = 0); as a Lovelace card it
   * does. The same rule VA learned the hard way (VA src/main.js, panel offset).
   * Writes only on change so the observer cannot feed itself.
   */
  _measure() {
    const r = this.getBoundingClientRect();
    const top = `${Math.max(0, Math.round(r.top + (window.scrollY || 0)))}px`;
    if (top !== this._offset) { this._offset = top; this.style.setProperty("--db-offset", top); }
    const mode = r.width && r.width < PHONE_MAX ? "phone" : "desk";
    if (mode !== this._mode) {
      this._mode = mode;
      if (mode === "phone") this._edit = false;
      this._render();
    }
  }

  /* ------------------------------------------------------------ storage */

  async _load() {
    this._render();
    let raw = null;
    let failed = null;
    try {
      const res = await this._hass.connection.sendMessagePromise({ type: "frontend/get_user_data", key: STORE_KEY });
      raw = res?.value ?? null;
    } catch (e) { failed = e?.message || e?.code || String(e); }
    const { dash, repaired } = sanitize(raw, SEED);
    this._dash = dash;
    const saved = store.get(TAB_KEY);
    this._tab = dash.tabs.some((t) => t.id === saved) ? saved : dash.tabs[0].id;
    this._status = failed ? `could not read the saved layout (${failed}) - showing the starting one`
      : repaired.length ? `repaired: ${repaired.join("; ")}` : raw ? "" : "starting layout - edit to make it yours";
    this._render();
  }

  _saveSoon() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(async () => {
      try {
        await this._hass.connection.sendMessagePromise({ type: "frontend/set_user_data", key: STORE_KEY, value: this._dash });
        this._say("saved");
      } catch (e) {
        this._say(`NOT saved: ${e?.message || e?.code || e}`, true);
      }
    }, 400);
  }

  _say(text, bad = false) {
    this._status = text;
    const s = this.shadowRoot.querySelector(".status");
    if (s) { s.textContent = text; s.classList.toggle("bad", bad); }
  }

  /** Apply a layout-core result: refused edits say why and change nothing. */
  _commit(result, { render = true } = {}) {
    if (!result.ok) { this._say(`not moved: ${result.reason}`, true); return false; }
    this._dash = result.dash;
    if (render) this._render();
    this._saveSoon();
    return true;
  }

  /* ------------------------------------------------------------- render */

  _activeTab() { return this._dash?.tabs.find((t) => t.id === this._tab) || this._dash?.tabs[0] || null; }

  _render() {
    const root = this.shadowRoot;
    if (!this._dash) { root.innerHTML = `<style>${STYLE}</style><div class="shell"><div class="boot">loading layout…</div></div>`; return; }
    const tab = this._activeTab();
    const phone = this._mode === "phone";
    // As a panel on a narrow screen HA draws no toolbar, so the only way to the
    // sidebar is a button the panel provides. As a card, HA's toolbar has one.
    const menu = this._narrow && !this._asCard;
    const menuBtn = `<button class="menu" aria-label="Open the sidebar">☰</button>`;
    const tabs = this._dash.tabs;

    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="shell ${phone ? "phone" : "desk"} ${this._edit ? "editing" : ""}">
        <div class="elbow">${menu && !phone ? menuBtn : ""}</div>
        <header class="bar">
          ${menu && phone ? menuBtn : ""}
          <div class="band"></div>
          <h1 class="title">${esc(this._cardConfig?.title || this._panel?.config?.title || "House")}</h1>
          <div class="cap"></div>
        </header>
        <nav class="rail" aria-label="Tabs">
          ${tabs.map((t) => `<button class="tab ${t.id === tab.id ? "active" : ""}" data-tab="${esc(t.id)}"
              aria-current="${t.id === tab.id ? "page" : "false"}"><span>${esc(t.title)}</span></button>`).join("")}
          <div class="rail-fill"></div>
          ${phone ? "" : `<button class="tab tool edit-toggle" aria-pressed="${this._edit}"><span>${this._edit ? "Done" : "Edit layout"}</span></button>`}
        </nav>
        <main class="stage">
          <div class="status ${/NOT|could not/.test(this._status) ? "bad" : ""}">${esc(this._status)}</div>
          ${this._edit ? this._editBar(tab) : ""}
          ${phone ? this._rowsHtml(tab) : this._gridHtml(tab)}
          ${this._edit ? this._shelfHtml() : ""}
        </main>
        <div class="sheet" ${this._sheetId ? "" : "hidden"} role="dialog" aria-modal="true">
          <div class="sheet-bar"><span class="sheet-title"></span>
            <button class="close" aria-label="Close">Close</button></div>
          <div class="sheet-body"></div>
        </div>
      </div>`;

    if (phone) this._fillRows(tab); else this._fillGrid(tab);
    if (this._sheetId) this._openSheet(this._sheetId);
    this._wire(tab);
    this._measure();
  }

  _editBar(tab) {
    return `<div class="editbar">
      <label>Tab name <input class="tab-name" value="${esc(tab.title)}" maxlength="24"></label>
      <button class="btn add-tab">Add a tab</button>
      ${tab.tiles.length ? "" : `<button class="btn remove-tab">Remove this tab</button>`}
      <button class="btn reset">${this._resetArmed ? "Tap again to reset everything" : "Reset layout"}</button>
      <span class="hint">Drag <b>Move</b> to place a tile, drag the corner to resize. Controls are paused while editing.</span>
    </div>`;
  }

  _gridHtml(tab) {
    const rows = gridRows(tab.tiles) + (this._edit ? 6 : 0);
    const others = this._dash.tabs.filter((t) => t.id !== tab.id);
    return `<div class="grid" style="--rows:${Math.max(rows, 1)}">
      ${tab.tiles.map((t) => {
        const r = rendererFor(t.kind);
        const bar = this._edit || (r && r.html) || !r;
        return `<section class="tile ${bar ? "has-bar" : ""}" data-id="${esc(t.id)}"
            style="grid-column:${t.x + 1} / span ${t.w}; grid-row:${t.y + 1} / span ${t.h}">
          ${bar ? `<div class="tile-bar"><span class="tile-title">${esc(t.title || t.id)}</span>
            ${this._edit ? `<button class="grab" aria-label="Move ${esc(t.title)}">Move</button>
              <select class="to-tab" aria-label="Send to another tab">
                <option value="">Send to…</option>
                ${others.map((o) => `<option value="${esc(o.id)}">${esc(o.title)}</option>`).join("")}
              </select>
              <select class="copy-tab" aria-label="Also show on another tab">
                <option value="">Copy to…</option>
                ${this._dash.tabs.map((o) => `<option value="${esc(o.id)}">${esc(o.title)}</option>`).join("")}
              </select>
              <button class="shelve" aria-label="Remove ${esc(t.title)} to the shelf">Remove</button>` : ""}
          </div>` : ""}
          <div class="tile-body" data-body="${esc(t.id)}"></div>
          ${this._edit ? `<div class="resize" aria-label="Resize ${esc(t.title)}"></div>` : ""}
        </section>`;
      }).join("")}
      <div class="ghost" hidden></div>
    </div>`;
  }

  _shelfHtml() {
    const shelf = this._dash.shelf || [];
    const fresh = availableFrom(this._dash, SEED);
    const item = (t, cls) => `<div class="shelf-item"><span>${esc(t.title || t.id)}
        <small>${esc(rendererFor(t.kind)?.label || t.kind)}</small></span>
      <button class="btn ${cls}" data-id="${esc(t.id)}">Put on this tab</button></div>`;
    return `<div class="shelf"><div class="shelf-head">Shelf</div>
      ${shelf.length ? shelf.map((t) => item(t, "unshelve")).join("")
        : `<div class="shelf-empty">Removed tiles wait here, so nothing is lost.</div>`}
      ${fresh.length ? `<div class="shelf-head sub-head">From the starting layout</div>
        ${fresh.map((t) => item(t, "add-fresh")).join("")}` : ""}
    </div>`;
  }

  _rowsHtml(tab) {
    return `<div class="rows">
      ${readingOrder(tab.tiles).map((t) => `<button class="row" data-id="${esc(t.id)}">
        <span class="mark" aria-hidden="true"></span>
        <span class="row-title">${esc(t.title || t.id)}</span>
        <span class="row-sum"></span>
        <span class="chev" aria-hidden="true">›</span>
      </button>`).join("") || `<div class="shelf-empty">Nothing on this tab yet.</div>`}
    </div>`;
  }

  _fillGrid(tab) {
    for (const t of tab.tiles) {
      const body = this.shadowRoot.querySelector(`.tile-body[data-body="${CSS.escape(t.id)}"]`);
      if (body) this._mount(t, body);
    }
  }

  _fillRows(tab) {
    for (const t of tab.tiles) this._updateRow(t);
  }

  _updateRow(t) {
    const row = this.shadowRoot.querySelector(`.row[data-id="${CSS.escape(t.id)}"]`);
    if (!row) return;
    const r = rendererFor(t.kind);
    let s;
    try { s = r ? r.summary(this._hass, t.config || {}) : { text: `no renderer "${t.kind}"`, state: "none" }; }
    catch (e) { s = { text: `error: ${e.message}`, state: "none" }; }
    const sum = row.querySelector(".row-sum");
    if (sum.textContent !== s.text) sum.textContent = s.text;
    const cls = `row st-${s.state}`;
    if (row.className !== cls) row.className = cls;
    // Design rule 7: unavailable means pressing will not help, so the row is inert.
    row.disabled = s.state === "unavailable";
  }

  /**
   * Put a tile's control into `body`. Elements are kept per tile across
   * renders, so a fader's intent or a half-typed number survives a layout edit.
   */
  _mount(tile, body) {
    const r = rendererFor(tile.kind);
    if (!r) {
      body.innerHTML = `<div class="missing">No renderer called "${esc(tile.kind)}". The tile is kept; nothing is lost.</div>`;
      return;
    }
    const cfg = tile.config || {};
    if (r.html) { body.innerHTML = r.html(this._hass, cfg); body.dataset.native = "1"; return; }
    const sig = JSON.stringify([tile.kind, cfg]);
    let rec = this._els.get(tile.id);
    if (!rec || rec.sig !== sig) { rec = { sig, el: null, error: null }; this._els.set(tile.id, rec); }
    if (rec.el) { body.replaceChildren(rec.el); rec.el.hass = this._hass; return; }
    if (rec.error) { body.innerHTML = `<div class="missing">${esc(rec.error)}</div>`; return; }
    body.innerHTML = `<div class="loading">loading ${esc(r.label)}…</div>`;
    r.load().then(() => {
      if (!rec.el && !rec.error) {
        try {
          const el = document.createElement(r.tag);
          el.setConfig({ type: `custom:${r.tag}`, ...cfg });
          el.hass = this._hass;
          rec.el = el;
        } catch (e) { rec.error = `${r.label}: ${e.message}`; }
      }
      if (body.isConnected) {
        if (rec.el) body.replaceChildren(rec.el);
        else body.innerHTML = `<div class="missing">${esc(rec.error)}</div>`;
      }
    }).catch((e) => { rec.error = `could not load ${r.tag}: ${e.message}`; if (body.isConnected) body.innerHTML = `<div class="missing">${esc(rec.error)}</div>`; });
  }

  /** A state change: hand hass to the controls, refresh rows and native tiles. */
  _update() {
    if (!this._dash) return;
    for (const rec of this._els.values()) if (rec.el) rec.el.hass = this._hass;
    const tab = this._activeTab();
    if (this._mode === "phone") this._fillRows(tab);
    for (const t of tab.tiles) {
      const r = rendererFor(t.kind);
      if (!r?.html) continue;
      const body = this.shadowRoot.querySelector(`.tile-body[data-body="${CSS.escape(t.id)}"]`)
        || (this._sheetId === t.id ? this.shadowRoot.querySelector(".sheet-body") : null);
      if (!body) continue;
      const html = r.html(this._hass, t.config || {});
      if (body._html !== html) { body._html = html; body.innerHTML = html; }
    }
  }

  /* -------------------------------------------------------------- sheet */

  _openSheet(id) {
    const at = findTile(this._dash, id);
    if (!at) { this._sheetId = null; return; }
    this._sheetId = id;
    const sheet = this.shadowRoot.querySelector(".sheet");
    sheet.hidden = false;
    sheet.querySelector(".sheet-title").textContent = at.tile.title || id;
    this._mount(at.tile, sheet.querySelector(".sheet-body"));
    sheet.querySelector(".close").focus({ preventScroll: true });
  }

  _closeSheet() {
    this._sheetId = null;
    const sheet = this.shadowRoot.querySelector(".sheet");
    if (sheet) { sheet.hidden = true; sheet.querySelector(".sheet-body").replaceChildren(); }
  }

  /* --------------------------------------------------------------- wire */

  _wire(tab) {
    const r = this.shadowRoot;
    r.querySelector(".menu")?.addEventListener("click", () =>
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true })));
    r.querySelectorAll(".tab[data-tab]").forEach((b) => b.addEventListener("click", () => {
      this._tab = b.dataset.tab; store.set(TAB_KEY, this._tab); this._closeSheet(); this._render();
    }));
    r.querySelector(".edit-toggle")?.addEventListener("click", () => {
      this._edit = !this._edit; this._resetArmed = null; this._render();
    });
    r.querySelectorAll(".row").forEach((b) => b.addEventListener("click", () => this._openSheet(b.dataset.id)));
    r.querySelector(".sheet .close")?.addEventListener("click", () => this._closeSheet());
    r.querySelector(".sheet")?.addEventListener("click", (e) => { if (e.target.classList.contains("sheet")) this._closeSheet(); });
    if (this._edit) this._wireEdit(tab);
  }

  _wireEdit(tab) {
    const r = this.shadowRoot;
    r.querySelector(".tab-name")?.addEventListener("change", (e) => this._commit(renameTab(this._dash, tab.id, e.target.value)));
    r.querySelector(".add-tab")?.addEventListener("click", () => {
      const res = addTab(this._dash);
      if (this._commit(res, { render: false })) { this._tab = res.tab.id; store.set(TAB_KEY, this._tab); this._render(); }
    });
    r.querySelector(".remove-tab")?.addEventListener("click", () => {
      const res = removeTab(this._dash, tab.id);
      if (this._commit(res, { render: false })) { this._tab = this._dash.tabs[0].id; this._render(); }
    });
    r.querySelector(".reset")?.addEventListener("click", () => {
      if (!this._resetArmed) {
        this._resetArmed = setTimeout(() => { this._resetArmed = null; this._render(); }, 4000);
        this._render(); return;
      }
      clearTimeout(this._resetArmed); this._resetArmed = null;
      this._els.clear();
      this._commit({ ok: true, dash: SEED });
      this._say("layout reset to the starting one");
    });
    r.querySelectorAll(".to-tab").forEach((sel) => sel.addEventListener("change", () => {
      const id = sel.closest(".tile").dataset.id;
      const dest = this._dash.tabs.find((t) => t.id === sel.value);
      if (dest && this._commit(moveToTab(this._dash, id, dest.id))) this._say(`sent to ${dest.title}`);
    }));
    r.querySelectorAll(".copy-tab").forEach((sel) => sel.addEventListener("change", () => {
      const id = sel.closest(".tile").dataset.id;
      const dest = this._dash.tabs.find((t) => t.id === sel.value);
      if (dest && this._commit(copyToTab(this._dash, id, dest.id))) this._say(`copied to ${dest.title}`);
    }));
    r.querySelectorAll(".add-fresh").forEach((b) => b.addEventListener("click", () => {
      const tile = availableFrom(this._dash, SEED).find((t) => t.id === b.dataset.id);
      if (tile) this._commit(addTile(this._dash, tile, tab.id));
    }));
    r.querySelectorAll(".shelve").forEach((b) => b.addEventListener("click", () =>
      this._commit(shelveTile(this._dash, b.closest(".tile").dataset.id))));
    r.querySelectorAll(".unshelve").forEach((b) => b.addEventListener("click", () =>
      this._commit(unshelveTile(this._dash, b.dataset.id, tab.id))));
    r.querySelectorAll(".grab, .resize").forEach((h) => h.addEventListener("pointerdown", (e) => this._drag(e, h, tab)));
  }

  /**
   * Drag a tile (Move) or its corner (resize). The ghost shows where it would
   * land and turns red with the reason when it cannot; letting go on red
   * changes nothing.
   */
  _drag(ev, handle, tab) {
    const id = handle.closest(".tile").dataset.id;
    const at = findTile(this._dash, id);
    if (!at) return;
    ev.preventDefault();
    handle.setPointerCapture?.(ev.pointerId);
    const grid = this.shadowRoot.querySelector(".grid");
    const ghost = grid.querySelector(".ghost");
    const cols = this._dash.cols || COLS;
    const cellW = (grid.clientWidth - GAP * (cols - 1)) / cols;
    const resize = handle.classList.contains("resize");
    const t0 = at.tile;
    let cand = null;
    const onMove = (e) => {
      const { dx, dy } = cellsFromPixels(e.clientX - ev.clientX, e.clientY - ev.clientY, { cellW, rowH: ROW_H, gap: GAP });
      cand = resize
        ? { x: t0.x, y: t0.y, w: clamp(t0.w + dx, 1, cols - t0.x), h: Math.max(1, t0.h + dy) }
        : { x: clamp(t0.x + dx, 0, cols - t0.w), y: Math.max(0, t0.y + dy), w: t0.w, h: t0.h };
      const why = whyNot(at.tab.tiles, cand, { cols, ignore: id });
      ghost.hidden = false;
      ghost.style.gridColumn = `${cand.x + 1} / span ${cand.w}`;
      ghost.style.gridRow = `${cand.y + 1} / span ${cand.h}`;
      ghost.classList.toggle("bad", Boolean(why));
      ghost.textContent = why ? `can't: ${why}` : `${cand.w} × ${cand.h}`;
    };
    const end = (commit) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      ghost.hidden = true;
      if (commit && cand && (cand.x !== t0.x || cand.y !== t0.y || cand.w !== t0.w || cand.h !== t0.h)) {
        this._commit(placeTile(this._dash, id, cand));
      }
    };
    const onUp = () => end(true);
    const onCancel = () => end(false);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
  }
}

const STYLE = `
  :host {
    --db-bg: ${T("--lcars-background-color")};
    --db-text: ${T("--lcars-background-text")};
    --db-frame: ${T("--lcars-ui-secondary")};
    --db-frame-text: ${T("--lcars-ui-secondary-text")};
    --db-tab: ${T("--lcars-card-button-color")};
    --db-tab-text: ${T("--lcars-card-button-text")};
    --db-active: ${T("--lcars-ui-accent-color")};
    --db-active-text: ${T("--lcars-ui-accent-text")};
    --db-edit: ${T("--lcars-ui-tertiary")};
    --db-edit-text: ${T("--lcars-ui-tertiary-text")};
    --db-tile-bar: ${T("--lcars-card-top-color")};
    --db-tile-bar-text: ${T("--lcars-card-top-text")};
    --db-line: ${T("--lcars-ui-primary")};
    --db-ok: ${T("--success-color")};
    --db-rail-w: ${T("--lcars-vertical-border")};
    --db-outer: ${T("--lcars-outer-radius")};
    --db-inner: ${T("--lcars-inner-radius")};
    --db-font: ${T("--lcars-font")}, ${T("--lcars-fallback-font")}, Antonio, "Arial Narrow", sans-serif;
    display: block;
    height: calc(100dvh - var(--db-offset, 0px));
    background: var(--db-bg);
    color: var(--db-text);
    font-family: var(--db-font);
  }
  * { box-sizing: border-box; }
  button, select, input { font: inherit; }
  .boot { padding: 24px; }

  /* The frame is structure: elbow, bar and rail are grid cells, and the tabs
     live IN the rail rather than being painted on top of it. */
  .shell { height: 100%; display: grid; grid-template-columns: 150px 1fr; grid-template-rows: 60px 1fr;
           grid-template-areas: "elbow bar" "rail stage"; row-gap: 5px; overflow: hidden; }
  .elbow { grid-area: elbow; position: relative; background: var(--db-frame);
           border-top-left-radius: var(--db-outer); display: flex; align-items: flex-start; }
  .elbow::after { content: ""; position: absolute; left: 100%; top: 22px; width: var(--db-inner); height: var(--db-inner);
                  background: radial-gradient(circle at 100% 100%, transparent calc(var(--db-inner) - .5px), var(--db-frame) var(--db-inner)); }
  .menu { margin: 8px 0 0 14px; width: 44px; height: 40px; border: 0; border-radius: 20px; cursor: pointer;
          background: var(--db-bg); color: var(--db-text); font-size: 20px; }
  .bar { grid-area: bar; display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
  .band { height: 22px; flex: 1; background: var(--db-frame); }
  .title { margin: 0; font-size: 30px; line-height: 1; font-weight: 400; letter-spacing: .06em;
           text-transform: uppercase; color: var(--db-active); white-space: nowrap; }
  .cap { width: 34px; height: 22px; background: var(--db-frame); border-radius: 0 11px 11px 0; flex: none; }

  .rail { grid-area: rail; display: flex; flex-direction: column; gap: 5px; min-height: 0; overflow-y: auto; }
  .tab { border: 0; cursor: pointer; min-height: 56px; padding: 6px 10px; text-align: right;
         display: flex; align-items: flex-end; justify-content: flex-end;
         background: var(--db-tab); color: var(--db-tab-text); text-transform: uppercase; letter-spacing: .06em; font-size: 15px; }
  .tab.active { background: var(--db-active); color: var(--db-active-text); }
  .tab.tool { background: var(--db-edit); color: var(--db-edit-text); min-height: 48px; }
  .tab:focus-visible, .btn:focus-visible, .row:focus-visible, .close:focus-visible, .grab:focus-visible
    { outline: 2px solid var(--db-text); outline-offset: 2px; }
  .rail-fill { flex: 1; min-height: 20px; background: var(--db-frame); border-bottom-left-radius: var(--db-outer); }

  .stage { grid-area: stage; min-width: 0; min-height: 0; overflow: auto; padding: 4px 12px 16px 14px; }
  .status { font-size: 12px; min-height: 16px; color: var(--db-ok); letter-spacing: .04em; margin-bottom: 6px; }
  .status.bad { color: var(--db-edit); }

  .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: ${ROW_H}px;
          gap: ${GAP}px; min-height: calc(var(--rows) * ${ROW_H + GAP}px); position: relative; }
  .tile { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column;
          border: 1px solid var(--db-line); border-radius: 0 14px 14px 0; overflow: hidden; background: var(--db-bg); }
  .tile-bar { display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px; flex: none;
              background: var(--db-tile-bar); color: var(--db-tile-bar-text); text-transform: uppercase;
              letter-spacing: .05em; font-size: 13px; }
  .tile-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tile-body { flex: 1; min-height: 0; overflow: auto; }
  .editing .tile { border-color: var(--db-edit); }
  .editing .tile-body { pointer-events: none; opacity: .55; }
  .grab, .shelve, .to-tab, .copy-tab { border: 0; border-radius: 10px; padding: 4px 10px; cursor: pointer; font-size: 12px;
                            background: var(--db-bg); color: var(--db-text); text-transform: uppercase; }
  .grab { cursor: grab; touch-action: none; background: var(--db-active); color: var(--db-active-text); }
  .resize { position: absolute; right: 0; bottom: 0; width: 26px; height: 26px; cursor: nwse-resize; touch-action: none;
            background: linear-gradient(135deg, transparent 50%, var(--db-edit) 50%); }
  .ghost { grid-column: 1; grid-row: 1; z-index: 3; pointer-events: none; border: 2px dashed var(--db-ok);
           background: color-mix(in srgb, var(--db-ok) 18%, transparent); color: var(--db-text);
           display: flex; align-items: center; justify-content: center; font-size: 13px; border-radius: 0 14px 14px 0; }
  .ghost.bad { border-color: var(--db-edit); background: color-mix(in srgb, var(--db-edit) 22%, transparent); }
  .ghost[hidden] { display: none; }

  .editbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; }
  .editbar input { background: var(--db-bg); color: var(--db-text); border: 1px solid var(--db-edit);
                   border-radius: 10px; padding: 4px 10px; width: 12em; }
  .btn { border: 0; border-radius: 14px; padding: 6px 14px; cursor: pointer; font-size: 13px; text-transform: uppercase;
         letter-spacing: .04em; background: var(--db-tab); color: var(--db-tab-text); }
  .btn.reset { background: #000000; color: #ffffff; outline: 1px solid #ffffff; }
  .hint { opacity: .75; font-size: 12px; }
  .shelf { margin-top: 16px; border-top: 5px solid var(--db-frame); padding-top: 8px; font-size: 13px; }
  .shelf-head { text-transform: uppercase; letter-spacing: .08em; color: var(--db-active); margin-bottom: 6px; }
  .shelf-head.sub-head { margin-top: 12px; }
  .shelf-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; }
  .shelf-item small { opacity: .7; margin-left: 6px; }
  .shelf-empty, .missing, .loading { opacity: .75; font-size: 13px; padding: 10px; }

  /* Native tiles */
  .glance { padding: 8px 10px; display: grid; gap: 6px; }
  .g-row { display: flex; justify-content: space-between; gap: 10px; font-size: 15px; }
  .g-name { opacity: .8; }
  .g-val { font-variant-numeric: tabular-nums; text-align: right; }
  .g-row.on .g-val { color: var(--db-active); }
  .g-row.err .g-val { color: var(--db-edit); }
  .g-row.unavailable .g-val { text-decoration: line-through; opacity: .6; }

  /* Phone: status rows, the full control one tap deep in a sheet. */
  .shell.phone { grid-template-columns: 1fr; grid-template-rows: 52px auto 1fr;
                 grid-template-areas: "bar" "rail" "stage"; }
  .phone .elbow { display: none; }
  .phone .bar { position: relative; }
  .phone .band { height: 18px; border-top-left-radius: 18px; }
  .phone .title { font-size: 26px; }
  .phone .menu { margin: 0; flex: none; background: var(--db-frame); color: var(--db-frame-text); }
  .phone .rail { flex-direction: row; overflow-x: auto; overflow-y: hidden; }
  .phone .rail-fill { display: none; }
  .phone .tab { min-height: 40px; flex: none; border-radius: 20px; padding: 6px 16px; align-items: center; }
  .rows { display: flex; flex-direction: column; gap: 6px; }
  .row { display: grid; grid-template-columns: 18px 1fr auto; grid-template-areas: "mark title chev" "mark sum chev";
         column-gap: 10px; align-items: center; text-align: left; width: 100%; min-height: 60px; padding: 8px 12px;
         border: 0; border-radius: 0 20px 20px 0; cursor: pointer; background: var(--db-line); color: var(--db-text); }
  .row-title { grid-area: title; text-transform: uppercase; letter-spacing: .05em; font-size: 15px; }
  .row-sum { grid-area: sum; font-size: 13px; opacity: .85; font-variant-numeric: tabular-nums; }
  .chev { grid-area: chev; font-size: 22px; opacity: .7; }
  .mark { grid-area: mark; width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--db-text); opacity: .5; }
  .row.st-on .mark { background: var(--db-active); border-color: var(--db-active); opacity: 1; }
  .row.st-unavailable { opacity: .55; cursor: default; }
  .row.st-unavailable .mark { border-style: dashed; }
  .row.st-unavailable .row-sum { text-decoration: line-through; }
  .row.st-unknown .mark { border-style: dotted; opacity: 1; }
  .row.st-unknown .mark::after { content: "?"; display: block; font-size: 10px; line-height: 10px; text-align: center; }
  .row.st-none .mark { border-color: transparent; }

  .sheet { position: fixed; inset: 0; z-index: 10; background: color-mix(in srgb, #000 60%, transparent);
           display: flex; flex-direction: column; justify-content: flex-end; }
  .sheet[hidden] { display: none; }
  .sheet-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 8px 16px;
               background: var(--db-frame); color: var(--db-frame-text); border-radius: 20px 20px 0 0;
               text-transform: uppercase; letter-spacing: .06em; }
  .close { border: 0; border-radius: 16px; padding: 8px 18px; cursor: pointer; background: var(--db-bg); color: var(--db-text); }
  .sheet-body { background: var(--db-bg); max-height: 85dvh; overflow: auto; padding-bottom: env(safe-area-inset-bottom, 0px); }
`;

if (!customElements.get("dashboard-builder-panel")) {
  customElements.define("dashboard-builder-panel", DashboardBuilderPanel);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "dashboard-builder-panel")) {
  window.customCards.push({
    type: "dashboard-builder-panel",
    name: "Dashboard Builder panel (preview)",
    description: "The Dashboard Builder panel as a card - put it alone in a `panel` view.",
  });
}

export { RENDERERS };
