/**
 * Dashboard Builder - the panel. Version 1.0: the base everything else sits in.
 *
 * The panel owns the whole area and the render. Tiles are SHAPES on a snap
 * grid; what fills each one is a declaration handed to a renderer from the
 * closed registry in ./renderers.js. The rules for the grid live in
 * ./layout-core.js with their tests - this file is the disposable half.
 *
 *   desk  (a tablet or desktop - see modeFor): tabs down the rail, tiles on the grid,
 *         and an edit mode to move, resize, send to another tab, or shelve
 *   phone (narrower): the same tiles as status rows in reading order; a tap
 *         opens the full control in a sheet
 *
 * The last tab is the theme: token-theme-kit's editor (vendored), which builds
 * one control per token from ./token-groups.js - declare a token, a control
 * appears. Where the values come from is ./theme-core.js.
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
  sanitize, placeTile, moveToTab, shelveTile, unshelveTile, addTab, renameTab, removeTab, moveTab,
  gridRows, readingOrder, cellsFromPixels, whyNot, findTile, COLS, copyToTab, availableFrom, addTile, modeFor,
} from "./layout-core.js";
import { RENDERERS, rendererFor } from "./renderers.js";
import { tokenVar as T } from "./tokens.js";
import { THEMES } from "./themes.js";
import { OWN_THEMES } from "./own-themes.js";
import {
  THEME_GROUPS, THEME_TOKENS, activeFrame, baseValues, groupsWithDefaults, paintVars, statusVerdicts, textPairs, drawnVerdicts,
  frameArtVars,
} from "./theme-core.js";
import { createThemeKit } from "../vendor/token-theme-kit/src/kit.js";
import { haUserDataAdapter } from "../vendor/token-theme-kit/src/adapters/ha.js";
import { cvdValidator } from "../vendor/token-theme-kit/src/plugins/cvd.js";
import { defineThemeKitEditor } from "../vendor/token-theme-kit/src/element.js";
import { clockParts, hour12For, msToNextTick } from "../cards/clock-card/clock-core.js";
import { discover, unplacedByArea, withStartingTiles } from "./discover-core.js";
import { sentence } from "../cards/readings-card/readings-core.js";
import { upgradeProperties } from "./upgrade-props.js";
import { FRAME_STYLES } from "./frame-styles.js";
import { FRAMES } from "./panel-tokens.js";
import { materialArt, maskUri, cropOffset, LOOK } from "./material-art.js";
import {
  readLibrary, listThemes, saveAs, updateTheme, removeTheme, exportTheme, ingestTheme, fileNameFor, emptyLibrary, USER_PREFIX,
} from "./theme-library.js";
import {
  DEVICE_KEY, DEVICE_TOKENS_KEY, accountPick, readPick, writePick, resolveTheme, isLocked, readDraft, writeDraft,
} from "./device-theme.js";
import { readVaTheme } from "./va-theme.js";

/** What a card dispatches to ask the panel to host its modal (see `_onModalAsk`). */
const MODAL_EVENT = "db-open-modal";
const STORE_KEY = "dashboard_builder.layout";
const TAB_KEY = "dashboard_builder.tab";
const THEME_KEY = "dashboard_builder.theme";
const TOKENS_KEY = "dashboard_builder.theme_tokens";
const LIB_KEY = "dashboard_builder.saved_themes";
// Every starting theme by name: the panel's own first, then the 24 mined LCARS ones.
const PRESETS = Object.freeze({ ...OWN_THEMES, ...THEMES });
// Its own tag, so another copy of the kit on the page cannot hand us its class.
const EDITOR_TAG = "db-theme-editor";
const haThemeOf = (h) => `${h?.selectedTheme?.theme ?? h?.themes?.theme ?? ""}|${h?.selectedTheme?.dark ?? h?.themes?.darkMode ?? ""}`;
const ROW_H = 64;
const GAP = 8;

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** What each process is tinted when nothing has chosen a colour for it. */
const WEAR_TINTS = Object.freeze({ rust: "#8a4622", soot: "#120e0c", heat: "#4a3a52", bare: "#b9b3ab" });

/** A tile's id as a number, so its scars follow the tile and not its place on the grid. */
const hashSeed = (id) => {
  let h = 0x811c9dc5;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % 100000;
};
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
    this._hosted = null;         // a card's modal the panel is showing instead (MODAL_EVENT)
    this._narrow = false;
    this._asCard = false;
    this._resetArmed = null;
    this._theme = null;          // what THIS browser shows: the account's theme, or its own lock
    this._accountTheme = null;   // what the shared setting says, which everyone on the account sees
    this._pick = accountPick();  // this browser's lock, if it has one (device-theme.js)
    this._libLoaded = false;     // saved themes read; before that, no pin can be called deleted
    this._overrides = {};        // the draft in play: this browser's while locked, else the shared one
    this._themeOpen = false;
    this._library = emptyLibrary();   // your saved themes (theme-library.js)
    this._lib = { mode: null, msg: "", target: null, deleteArmed: false };   // the theme tab's library panel
    this._onKey = (e) => { if (e.key === "Escape" && (this._sheetId || this._hosted)) this._closeSheet(); };
  }

  /* ---------------------------------------------------- Home Assistant API */

  set hass(hass) {
    const first = !this._hass;
    const themeWas = haThemeOf(this._hass);
    this._hass = hass;
    if (!first && haThemeOf(hass) !== themeWas) requestAnimationFrame(() => this._refreshTheme());
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

  /**
   * A card that wants a modal asks for one instead of drawing its own.
   *
   * A card's own overlay is `position: fixed`, which escapes nothing once any
   * ancestor makes itself a containing block - inside Home Assistant the TV
   * Plus guide came out INSIDE the remote tile, scrollbar and all. And on a
   * phone the tile is already in the panel's sheet, so a second overlay drew a
   * second Close bar under the first. One owner fixes both: the panel has a
   * sheet, and the sheet is a child of the panel, not of a tile.
   *
   * The card calls `preventDefault()`'s answer: if the event was cancelled the
   * panel took it, and if nothing answered the card draws its own - which is
   * what happens when the card is used as a plain Lovelace card with no panel
   * around it.
   */
  _onModalAsk(e) {
    const d = e.detail || {};
    if (!d.element) return;
    e.preventDefault();
    this._hosted = { title: d.title || "", element: d.element, onClose: d.onClose || null,
      wasSheetId: this._sheetId };
    this._sheetId = null;
    this._showHosted();
  }

  _showHosted() {
    const h = this._hosted;
    const sheet = this.shadowRoot.querySelector(".sheet");
    if (!h || !sheet) return;
    sheet.hidden = false;
    sheet.querySelector(".sheet-title").textContent = h.title;
    sheet.querySelector(".sheet-body").replaceChildren(h.element);
    sheet.querySelector(".close").focus({ preventScroll: true });
  }

  connectedCallback() {
    // On an uncached load HA sets hass/panel/narrow before this class exists;
    // replay them through the setters, or the panel never renders (upgrade-props.js).
    upgradeProperties(this);
    this.addEventListener(MODAL_EVENT, this._onModalAsk);
    if (!this._ro && typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => this._measure());
      this._ro.observe(this);
    }
    document.addEventListener("keydown", this._onKey);
    this._measure();
    this._tickClock();
  }

  disconnectedCallback() {
    clearTimeout(this._clockT); this._clockT = null;
    this._ro?.disconnect(); this._ro = null;
    this._tokenStore?.flush();
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
    const mode = modeFor({ hostWidth: r.width, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
    if (mode !== this._mode) {
      this._mode = mode;
      this._render();
    }
  }

  /* -------------------------------------------------------------- theme */

  /**
   * The kit, made once. Your changes live in `_overrides` and the editor reads
   * them from there, not from HA: coming back to the tab inside the save
   * debounce would otherwise show the older set.
   */
  _themeKit() {
    if (this._kit) return this._kit;
    this._tokenStore = haUserDataAdapter(() => this._hass, TOKENS_KEY);
    this._kit = createThemeKit({
      adapter: {
        load: async () => ({ ...this._overrides }),
        save: (values) => { this._overrides = { ...values }; return this._saveDraft(values); },
      },
    });
    this._kit.registerValidator(statusVerdicts);
    this._kit.registerValidator(drawnVerdicts);
    this._kit.registerValidator(cvdValidator({ pairs: textPairs(THEME_TOKENS) }));
    return this._kit;
  }

  /**
   * Where a draft goes: this browser's own store while it is locked, the
   * account's otherwise. A locked browser must not write the shared draft -
   * it would be editing what it cannot see, over the other person's work.
   */
  _saveDraft(values) {
    if (!isLocked(this._pick)) return this._tokenStore.save(values);
    store.set(DEVICE_TOKENS_KEY, writeDraft(values));
    return Promise.resolve();
  }

  /**
   * What this browser shows, from its lock and the shared setting. A pin on a
   * theme deleted elsewhere is dropped here - but only once the library has
   * loaded, or the first render would throw away a good pin.
   */
  _resolveShown() {
    const r = resolveTheme({ pick: this._pick, accountTheme: this._accountTheme,
      known: (n) => Boolean(this._presetFor(n)), libraryLoaded: this._libLoaded });
    if (r.stale) {
      this._pick = accountPick();
      store.set(DEVICE_KEY, writePick(this._pick));
      this._say("that theme was deleted - following the shared one again");
    }
    this._theme = r.theme;
    return r;
  }

  /**
   * Lock this browser to what it is showing, or let it follow the account
   * again. Locking keeps the theme AND the draft as they are, so the moment
   * of locking changes nothing on screen; unlocking brings the shared pair
   * back. Either way the other person's devices are untouched.
   */
  async _setLock(on) {
    if (on) {
      this._pick = { mode: "device", theme: this._theme ?? null };
      store.set(DEVICE_KEY, writePick(this._pick));
      store.set(DEVICE_TOKENS_KEY, writeDraft(this._overrides));
      this._refreshTheme();
      this._say(`this device only: ${this._themeLabel(this._theme)}`);
    } else {
      this._pick = accountPick();
      store.set(DEVICE_KEY, writePick(this._pick));
      this._resolveShown();
      let own = null;
      try { own = await this._tokenStore.load(); } catch { own = null; }
      this._overrides = own && typeof own === "object" && !Array.isArray(own) ? own : {};
      if (this._themeEditor) this._themeEditor.values = this._overrides;
      this._refreshTheme();
      this._say(`following the shared theme: ${this._themeLabel(this._theme)}`);
    }
    this._render();
  }

  /**
   * Re-read the layers under your changes - Home Assistant's theme and the
   * picked one (theme-core) - then paint. Run when either changes. HA's theme is
   * read from ABOVE the panel, because the panel's own writes would answer back.
   * A new base re-registers the groups, so the editor shows what is on screen
   * and a reset lands on it.
   */
  _refreshTheme() {
    const above = this.parentElement || this.getRootNode()?.host || document.documentElement;
    const cs = getComputedStyle(above);
    const base = baseValues(THEME_TOKENS, { preset: this._presetFor(this._theme), read: (v) => cs.getPropertyValue(v),
      overrides: this._overrides });
    const sig = JSON.stringify(base);
    if (sig !== this._baseSig) {
      this._baseSig = sig;
      this._base = base;
      const kit = this._themeKit();
      for (const g of groupsWithDefaults(THEME_GROUPS, base)) kit.registerTokenGroup(g);
    }
    this._paintTheme();
  }

  /**
   * Write the chosen layers onto the panel; everything inside inherits them.
   * The frame is structure, not a colour, so it goes on as an attribute the
   * stylesheet selects on (`:host([data-frame="cockpit"])`).
   */
  _paintTheme() {
    for (const k of this._themeSet || []) this.style.removeProperty(k);
    const vars = {
      ...paintVars(THEME_TOKENS, { base: this._base, preset: this._presetFor(this._theme), overrides: this._overrides }),
      ...frameArtVars(this._base, this._overrides),
    };
    for (const [k, v] of Object.entries(vars)) this.style.setProperty(k, v);
    this._themeSet = Object.keys(vars);
    this.setAttribute("data-frame", activeFrame(this._base, this._overrides));
  }

  /**
   * This tile's weathering, as a stack of tinted masks.
   *
   * Seeded by the tile's ID, never its position - a tile carries its scars
   * when you move it. The whole ship re-rolls only if the theme's history
   * changes, which is why the cache key holds both.
   */
  _wearHtml(tile) {
    const v = { ...this._base, ...(this._overrides || {}) };
    const history = v["wear-history"] || "none";
    if (history === "none") return "";
    const key = `${tile.id}|${history}|${v["wear-density"]}|${v["wear-progress"]}|${v["greeble-density"]}`;
    this._wearCache = this._wearCache || new Map();
    if (!this._wearCache.has(key)) {
      const seed = hashSeed(tile.id);
      const art = materialArt({ history, seed,
        hardware: Number(v["greeble-density"] ?? 60) / 100,
        wearDensity: Number(v["wear-density"] ?? 0.4),
        wearProgress: Number(v["wear-progress"] ?? 0.4),
        gravity: 90 });
      const spans = art.layers.map((l) => {
        const uri = maskUri(l.mask, { seed: seed + l.process.length });
        if (!uri) return "";
        // Every tint carries its own fallback: paintVars only writes a token
        // that a theme, a preset or a frame actually chose, so an untouched
        // colour resolves to NOTHING and the layer paints transparent.
        const tint = `var(--db-wear-${l.tint}, ${WEAR_TINTS[l.tint]})`;
        const inner = `<span class="wear-layer" style="background:${tint};`
          + `-webkit-mask-image:url(${uri});mask-image:url(${uri});`
          + `mix-blend-mode:${l.blend};opacity:${l.opacity}"></span>`;
        // Blur goes on a WRAPPER: CSS runs filter before mask, so blurring the
        // span itself would blur the flat tint and then hard-clip it.
        return l.blur ? `<span class="wear-blur" style="filter:blur(${l.blur}px)">${inner}</span>` : inner;
      }).join("");
      this._wearCache.set(key, spans
        ? `<div class="tile-wear" style="--wear-crop:${cropOffset(seed)}">${spans}</div>` : "");
    }
    return this._wearCache.get(key);
  }

  /** A theme's values by the name the theme key stores: built in, or "user:<id>" from your library. */
  _presetFor(name) {
    if (!name) return null;
    if (name.startsWith(USER_PREFIX)) return this._library.themes[name.slice(USER_PREFIX.length)]?.tokens || null;
    return PRESETS[name] || null;
  }

  _themeLabel(name) {
    if (!name) return "Home Assistant's theme";
    return name.startsWith(USER_PREFIX) ? this._library.themes[name.slice(USER_PREFIX.length)]?.name || "a deleted theme" : name;
  }

  /** Pick a theme: this browser's own while locked, everyone's otherwise. */
  async _setTheme(name) {
    this._theme = name && this._presetFor(name) ? name : null;
    this._refreshTheme();
    if (isLocked(this._pick)) {
      this._pick = { mode: "device", theme: this._theme };
      store.set(DEVICE_KEY, writePick(this._pick));
      this._say(`this device only: ${this._themeLabel(this._theme)}`);
      return;
    }
    this._accountTheme = this._theme;
    try {
      await this._hass.connection.sendMessagePromise({ type: "frontend/set_user_data", key: THEME_KEY, value: this._theme });
      this._say(`theme: ${this._themeLabel(this._theme)}`);
    } catch (e) { this._say(`theme NOT saved: ${e?.message || e}`, true); }
  }

  _themeHtml() {
    const cs = getComputedStyle(this.parentElement || this.getRootNode()?.host || document.documentElement);
    const read = (v) => cs.getPropertyValue(v);
    const frameLabel = (f) => FRAMES.find((x) => x.value === f)?.label || "LCARS";
    const card = (name, label) => {
      const v = baseValues(THEME_TOKENS, { preset: this._presetFor(name), read });
      const r = Math.min(8, Math.round((Number(v["tile-radius"]) || 0) / 2));
      const vars = `--m-bg:${v.background};--m-text:${v["background-text"]};--m-frame:${v["ui-secondary"]};`
        + `--m-tab:${v["card-button"]};--m-on:${v["tab-active"]};--m-surf:${v["tile-surface"]};--m-line:${v["tile-border"]};--m-r:${r}px`;
      const on = (name || "") === (this._theme || "");
      // While locked, say which one the rest of the account is on - otherwise
      // the shared theme is invisible from here and looks like it went away.
      const shared = isLocked(this._pick) && (name || "") === (this._accountTheme || "");
      return `<button class="theme-card ${on ? "on" : ""}" data-theme="${esc(name || "")}" aria-pressed="${on}">
        <span class="mini" style="${esc(vars)}"><i class="m-band"></i><i class="m-rail"><b class="on"></b><b></b><b></b></i>
          <i class="m-tile"><u></u><u></u></i></span>
        <span class="theme-name">${esc(label)}${shared ? `<span class="theme-badge">shared</span>` : ""}</span>
        <span class="theme-frame">${esc(frameLabel(v.frame))} frame</span></button>`;
    };
    const mine = listThemes(this._library);
    const groups = [
      ["Your themes", mine.map((t) => card(USER_PREFIX + t.id, t.name))],
      ["Written for this panel", [card(null, "Home Assistant's theme"), ...Object.keys(OWN_THEMES).map((n) => card(n, n))]],
      ["LCARS themes", Object.keys(THEMES).map((n) => card(n, n))],
    ].filter(([, items]) => items.length);
    const draft = Object.keys(this._overrides || {}).length > 0;
    const isUser = (this._theme || "").startsWith(USER_PREFIX);
    const active = this._themeLabel(this._theme);
    const L = this._lib;
    const panel = L.mode === "saveas" ? `<div class="lib-panel"><label>Name <input class="lib-name" maxlength="60"
          value="${esc(draft || !isUser ? `${active}${draft ? " (edited)" : " copy"}` : `${active} copy`)}"></label>
        <button class="btn lib-saveas-go">Save</button><button class="btn lib-cancel">Cancel</button></div>`
      : L.mode === "import" ? `<div class="lib-panel lib-panel-col"><textarea class="lib-json" rows="6"
          placeholder="Paste a theme's JSON - what Export copies"></textarea>
        <div><button class="btn lib-import-go">Import</button><button class="btn lib-cancel">Cancel</button></div></div>`
      : L.mode === "export" ? `<div class="lib-panel lib-panel-col"><textarea class="lib-json" rows="6" readonly>${esc(L.json || "")}</textarea>
        <div><button class="btn lib-cancel">Done</button></div></div>`
      : L.mode === "switch" ? `<div class="lib-panel"><span>Switching to ${esc(this._themeLabel(L.target))} discards your unsaved changes.</span>
        <button class="btn lib-switch-go">Switch</button><button class="btn lib-cancel">Cancel</button></div>`
      : "";
    return `<div class="theme-view">
      <div class="theme-lib">${groups.map(([label, items]) =>
        `<div class="lib-group"><div class="lib-label">${esc(label)}</div><div class="lib-grid">${items.join("")}</div></div>`).join("")}</div>
      <div class="lib-actions">${this._libActionsInner()}</div>
      ${panel}
      ${L.msg ? `<div class="lib-msg">${esc(L.msg)}</div>` : ""}
      <span class="hint">${isLocked(this._pick)
        ? "<b>This device</b> is picked, so choosing a theme below changes this browser and nothing else."
        : "<b>Shared</b> is picked, so choosing a theme below changes it for everyone on this Home Assistant account."}</span>
      <span class="hint">Pick a theme to use it whole - frame, colours and all. What you change below is a draft on top of
        it: <b>Save</b> keeps it in your own theme, <b>Save as new</b> makes a theme of it, <b>Discard</b> drops it.
        Export and Download give the theme as a file to share; Import and Upload add one to your themes.
        <b>Only on this device</b> keeps the theme and your draft to this browser, for when one Home Assistant
        account is shared - everyone else keeps the shared theme, marked <i>shared</i> above.</span>
      <div class="theme-slot"></div>
    </div>`;
  }

  /** The draft line and the library's buttons: Save and Discard only while there is a draft. */
  _libActionsInner() {
    const draft = Object.keys(this._overrides || {}).length > 0;
    const isUser = (this._theme || "").startsWith(USER_PREFIX);
    const active = this._themeLabel(this._theme);
    const locked = isLocked(this._pick);
    const lead = locked
      ? `<span class="lib-draft">On this device only: ${esc(active)}${draft ? ", edited" : ""}</span>`
      : draft ? `<span class="lib-draft">Unsaved changes to ${esc(active)}</span>`
        : `<span class="lib-draft">Using ${esc(active)}</span>`;
    /* The scope is a SWITCH, not an action on the theme you already picked.
       As a single "Only on this device" button it read as something you press
       after choosing - and choosing first had already changed the theme for
       everyone on the account. Here the two scopes sit side by side with the
       live one marked, so the question is answered before a theme is picked
       and the gallery's hint says which one a tap will change. */
    return `${lead}
      <span class="lib-scope" role="group" aria-label="This theme applies to">
        <button class="btn scope-shared${locked ? "" : " on"}" aria-pressed="${!locked}">Shared</button>
        <button class="btn scope-device${locked ? " on" : ""}" aria-pressed="${locked}">This device</button>
      </span>
      ${isUser && draft ? `<button class="btn lib-save">Save</button>` : ""}
      <button class="btn lib-saveas">Save as new</button>
      ${draft ? `<button class="btn lib-discard">Discard</button>` : ""}
      <button class="btn lib-export">Export</button>
      <button class="btn lib-download">Download</button>
      <button class="btn lib-import">Import</button>
      <button class="btn lib-upload">Upload</button><input type="file" class="lib-file" accept=".json,application/json" hidden>
      ${isUser ? `<button class="btn lib-delete">${this._lib.deleteArmed ? "Tap again to delete" : "Delete"}</button>` : ""}`;
  }

  /**
   * An edit in the token editor can start or end a draft. Redraw the library's
   * bar alone when it does - never the editor, which would lose the control
   * under your finger mid-drag.
   */
  _syncLibBar() {
    const bar = this.shadowRoot.querySelector(".lib-actions");
    const draft = Object.keys(this._overrides || {}).length > 0;
    if (!bar || bar.dataset.draft === String(draft)) return;
    bar.dataset.draft = String(draft);
    bar.innerHTML = this._libActionsInner();
    this._wireLibActions();
  }

  /**
   * Your draft (token changes) replaced wholesale - saved, and the editor told.
   * Saved through `_saveDraft`, never straight to the account: Discard and
   * Save as new come through here too, and on a locked browser those must not
   * reach the shared draft.
   */
  _setOverrides(values) {
    this._overrides = { ...values };
    this._themeKit();
    this._saveDraft(this._overrides);
    if (this._themeEditor) this._themeEditor.values = this._overrides;
  }

  async _saveLibrary(lib) {
    this._library = lib;
    try {
      await this._hass.connection.sendMessagePromise({ type: "frontend/set_user_data", key: LIB_KEY, value: lib });
      return true;
    } catch (e) { this._say(`themes NOT saved: ${e?.message || e}`, true); return false; }
  }

  /** Everything on screen now: the active theme with your draft on top. */
  _resolvedTheme() { return { ...this._base, ...this._overrides }; }

  _libDone(msg = "") { this._lib = { mode: null, msg, target: null, deleteArmed: false }; this._render(); }

  async _saveAsNew(name) {
    const { lib, id } = saveAs(this._library, { name, tokens: this._resolvedTheme() }, { alsoTaken: Object.keys(PRESETS) });
    if (!(await this._saveLibrary(lib))) return;
    this._setOverrides({});
    await this._setTheme(USER_PREFIX + id);
    this._libDone(`Saved "${lib.themes[id].name}" to your themes.`);
  }

  async _addImported(text) {
    const names = [...listThemes(this._library).map((t) => t.name), ...Object.keys(PRESETS)];
    const got = ingestTheme(text, { tokens: THEME_TOKENS, names });
    // A Vacuum Agent theme speaks another vocabulary, so the gate above refuses
    // it whole - rightly, it cannot be half-imported. It CAN be read, though:
    // the colours cross, the frame does not. See va-theme.js.
    if (!got.ok && ["wrong_kind", "nothing_usable", "invalid_tokens"].includes(got.reason)) {
      const va = readVaTheme(text, { tokens: THEME_TOKENS });
      if (va.ok) return this._addVaTheme(va);
    }
    if (!got.ok) {
      const why = { not_json: "that isn't JSON", invalid_payload: "that isn't a theme", wrong_kind: "that is another program's theme",
        missing_name: "the theme has no name", invalid_tokens: "the theme has no settings",
        nothing_usable: "none of its settings are ones this panel has" }[got.reason] || got.reason;
      this._lib = { ...this._lib, msg: `Not imported: ${why}.` };
      this._render();
      return;
    }
    const { lib } = saveAs(this._library, got.theme, { alsoTaken: Object.keys(PRESETS) });
    await this._saveLibrary(lib);
    const notes = [got.dropped.length ? `${got.dropped.length} setting(s) left out: ${got.dropped.join(", ")}` : "",
      got.clamped.length ? `brought into range: ${got.clamped.join(", ")}` : ""].filter(Boolean).join("; ");
    this._libDone(`Imported "${got.theme.name}" into your themes${notes ? ` - ${notes}` : ""}.`);
  }

  /** A theme read from Vacuum Agent: saved like any other, with what it left behind. */
  async _addVaTheme(va) {
    const { lib } = saveAs(this._library, { ...va.theme, source: "community" }, { alsoTaken: Object.keys(PRESETS) });
    if (!(await this._saveLibrary(lib))) return;
    const notes = [`${va.landed.length} setting(s) read`,
      va.flattened.length ? `${va.flattened.length} flattened onto the background` : "",
      va.leftBehind.length ? `${va.leftBehind.length} left behind (Vacuum Agent's own)` : ""].filter(Boolean).join("; ");
    this._libDone(`Read "${va.theme.name}" from Vacuum Agent - ${notes}. Its frame is this panel's, not the theme's.`);
  }

  _wireThemeLibrary() {
    const r = this.shadowRoot;
    const on = (sel, fn) => r.querySelector(sel)?.addEventListener("click", fn);
    const hasDraft = () => Object.keys(this._overrides || {}).length > 0;
    const bar = r.querySelector(".lib-actions");
    if (bar) bar.dataset.draft = String(hasDraft());
    this._wireLibActions();
    r.querySelectorAll(".theme-card").forEach((b) => b.addEventListener("click", () => {
      const target = b.dataset.theme || null;
      if ((target || "") === (this._theme || "")) return;
      if (hasDraft()) { this._lib = { ...this._lib, mode: "switch", target, msg: "" }; this._render(); return; }
      this._setTheme(target).then(() => this._render());
    }));
    on(".lib-switch-go", async () => {
      const target = this._lib.target;
      this._setOverrides({});
      await this._setTheme(target);
      this._libDone();
    });
    on(".lib-cancel", () => this._libDone());
    on(".lib-saveas-go", () => this._saveAsNew(r.querySelector(".lib-name")?.value));
    on(".lib-import-go", () => this._addImported(r.querySelector(".lib-json")?.value || ""));
  }

  _wireLibActions() {
    const r = this.shadowRoot;
    const on = (sel, fn) => r.querySelector(`.lib-actions ${sel}`)?.addEventListener("click", fn);
    on(".scope-shared", () => { if (isLocked(this._pick)) this._setLock(false); });
    on(".scope-device", () => { if (!isLocked(this._pick)) this._setLock(true); });
    on(".lib-discard", () => { this._setOverrides({}); this._refreshTheme(); this._libDone("Changes discarded."); });
    on(".lib-save", async () => {
      const id = (this._theme || "").slice(USER_PREFIX.length);
      if (!(await this._saveLibrary(updateTheme(this._library, id, this._resolvedTheme())))) return;
      this._setOverrides({});
      this._baseSig = null;
      this._refreshTheme();
      this._libDone(`Saved "${this._themeLabel(this._theme)}".`);
    });
    on(".lib-saveas", () => { this._lib = { ...this._lib, mode: "saveas", msg: "" }; this._render(); r.querySelector(".lib-name")?.select(); });
    on(".lib-export", async () => {
      const json = JSON.stringify(exportTheme({ name: this._themeLabel(this._theme), tokens: this._resolvedTheme() }), null, 2);
      let copied = false;
      try { await navigator.clipboard.writeText(json); copied = true; } catch { /* not a secure page - select it instead */ }
      this._lib = { ...this._lib, mode: "export", json, msg: copied ? "Copied - paste it anywhere to share." : "" };
      this._render();
      const ta = r.querySelector(".lib-json");
      if (ta && !copied) {
        ta.focus(); ta.select();
        try { copied = document.execCommand("copy"); } catch { copied = false; }
        this._lib.msg = copied ? "Copied - paste it anywhere to share." : "Select it all and copy it.";
        const m = r.querySelector(".lib-msg"); if (m) m.textContent = this._lib.msg; else this._render();
      }
    });
    on(".lib-download", () => {
      const name = this._themeLabel(this._theme);
      const blob = new Blob([JSON.stringify(exportTheme({ name, tokens: this._resolvedTheme() }), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileNameFor(name);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      this._say(`downloaded ${a.download}`);
    });
    on(".lib-import", () => { this._lib = { ...this._lib, mode: "import", msg: "" }; this._render(); r.querySelector(".lib-json")?.focus(); });
    on(".lib-upload", () => r.querySelector(".lib-actions .lib-file")?.click());
    r.querySelector(".lib-actions .lib-file")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) this._addImported(await file.text());
    });
    on(".lib-delete", async () => {
      if (!this._lib.deleteArmed) { this._lib = { ...this._lib, deleteArmed: true }; this._render(); return; }
      const id = (this._theme || "").slice(USER_PREFIX.length);
      const name = this._themeLabel(this._theme);
      if (!(await this._saveLibrary(removeTheme(this._library, id)))) return;
      this._setOverrides({});
      await this._setTheme(null);
      this._libDone(`Deleted "${name}".`);
    });
  }

  /** The editor element is made once and moved into each render. */
  _mountThemeEditor() {
    const slot = this.shadowRoot.querySelector(".theme-slot");
    if (!slot) return;
    if (!this._themeEditor) {
      defineThemeKitEditor(EDITOR_TAG);
      const ed = document.createElement(EDITOR_TAG);
      // The editor saves through our adapter first, so `_overrides` is current here.
      ed.addEventListener("change", () => { this._refreshTheme(); this._syncLibBar(); });
      ed.addEventListener("reset", () => { this._refreshTheme(); this._syncLibBar(); this._say("reset"); });
      ed.kit = this._themeKit();
      this._themeEditor = ed;
    }
    slot.appendChild(this._themeEditor);
  }

  /* -------------------------------------------------------------- clock */

  /* The house's time in the header band: Home Assistant's zone and 12/24-hour
     setting, turning over on the minute. `clock: false` in the panel's config
     (or the card's) takes it out. */
  _clockOn() {
    const c = this._asCard ? this._cardConfig : this._panel?.config;
    return c?.clock !== false;
  }

  _clockParts() {
    return clockParts(Date.now(), { timeZone: this._hass?.config?.time_zone || undefined,
      hour12: hour12For(this._hass?.locale?.time_format),
      language: this._hass?.locale?.language || this._hass?.language || undefined });
  }

  _clockHtml() {
    if (!this._clockOn()) return "";
    const p = this._clockParts();
    return `<span class="clock" title="${esc(`${p.date} · ${p.zone}`)}">${esc(p.time)}${p.ampm
      ? `<span class="clock-ampm">${esc(p.ampm)}</span>` : ""}</span>`;
  }

  _tickClock() {
    clearTimeout(this._clockT);
    if (!this.isConnected) return;
    const el = this.shadowRoot.querySelector(".clock");
    if (el) el.outerHTML = this._clockHtml();
    this._clockT = setTimeout(() => this._tickClock(), msToNextTick(Date.now()) + 20);
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
    try {
      const l = await this._hass.connection.sendMessagePromise({ type: "frontend/get_user_data", key: LIB_KEY });
      this._library = readLibrary(l?.value);
    } catch { this._library = emptyLibrary(); }
    this._libLoaded = true;
    try {
      const t = await this._hass.connection.sendMessagePromise({ type: "frontend/get_user_data", key: THEME_KEY });
      this._accountTheme = typeof t?.value === "string" && this._presetFor(t.value) ? t.value : null;
    } catch { this._accountTheme = null; }
    this._pick = readPick(store.get(DEVICE_KEY));
    this._resolveShown();
    this._themeKit();
    if (isLocked(this._pick)) {
      this._overrides = readDraft(store.get(DEVICE_TOKENS_KEY));
    } else {
      const own = await this._tokenStore.load();
      this._overrides = own && typeof own === "object" && !Array.isArray(own) ? own : {};
    }
    const { dash, repaired } = sanitize(raw, SEED);
    this._dash = dash;
    const saved = store.get(TAB_KEY);
    this._tab = dash.tabs.some((t) => t.id === saved) ? saved : dash.tabs[0].id;
    this._status = sentence(failed ? `could not read the saved layout (${failed}) - showing the starting one`
      : repaired.length ? `repaired: ${repaired.join("; ")}` : raw ? "" : "starting layout - edit to make it yours");
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

  /**
   * The status line. Messages are written as they read - "saved", "not added:
   * ..." - and get their capital HERE, so a new message cannot forget it and no
   * call site has to remember. `sentence` touches the first letter only, so an
   * entity's own name and words like NOT survive.
   */
  _say(text, bad = false) {
    this._status = sentence(text);
    const s = this.shadowRoot.querySelector(".status");
    if (s) { s.textContent = this._status; s.classList.toggle("bad", bad); }
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
    // A render replaces the rail, and a new rail starts scrolled to the top.
    const oldRail = root.querySelector(".rail");
    const railAt = oldRail ? [oldRail.scrollTop, oldRail.scrollLeft] : null;

    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="shell ${phone ? "phone" : "desk"} ${this._edit ? "editing" : ""}">
        <div class="elbow">${menu && !phone ? menuBtn : ""}</div>
        <header class="bar">
          ${menu && phone ? menuBtn : ""}
          <div class="band"></div>
          ${this._clockHtml()}
          <h1 class="title">${esc(this._cardConfig?.title || this._panel?.config?.title || "House")}</h1>
          <div class="cap"></div>
        </header>
        <nav class="rail" aria-label="Tabs">
          ${tabs.map((t) => { const on = t.id === tab.id && !this._themeOpen;
            return `<button class="tab ${on ? "active" : ""}" data-tab="${esc(t.id)}"
              aria-current="${on ? "page" : "false"}"><span>${esc(t.title)}</span></button>`; }).join("")}
          <div class="rail-fill"></div>
          <div class="tools">
            <button class="tab tool edit-toggle" aria-pressed="${this._edit}"><span>${this._edit ? "Done" : phone ? "Edit" : "Edit layout"}</span></button>
            <button class="tab tool theme-toggle" aria-pressed="${this._themeOpen}"><span>${this._themeOpen ? "Done" : "Theme"}</span></button>
          </div>
        </nav>
        <main class="stage">
          <div class="status ${/NOT|could not/.test(this._status) ? "bad" : ""}">${esc(this._status)}</div>
          ${this._themeOpen ? this._themeHtml() : `
            ${this._edit ? this._editBar(tab) : ""}
            ${phone ? this._rowsHtml(tab) : this._gridHtml(tab)}
            ${this._edit ? this._shelfHtml() : ""}`}
        </main>
        <div class="sheet" ${this._sheetId ? "" : "hidden"} role="dialog" aria-modal="true">
          <div class="sheet-bar"><span class="sheet-title"></span>
            <button class="close" aria-label="Close">Close</button></div>
          <div class="sheet-body"></div>
        </div>
      </div>`;

    const rail = root.querySelector(".rail");
    if (rail && railAt) [rail.scrollTop, rail.scrollLeft] = railAt;
    this._revealActiveTab();
    if (!this._themeApplied) { this._themeApplied = true; this._refreshTheme(); }
    if (this._themeOpen) this._mountThemeEditor();
    else if (phone) this._fillRows(tab); else this._fillGrid(tab);
    if (this._sheetId) this._openSheet(this._sheetId);
    else if (this._hosted) this._showHosted();
    this._wire(tab);
    this._measure();
  }

  /**
   * Keep the selected tab in view: with more tabs than fit, the pinned tools
   * cover the rail's far end. Scrolls the rail only - never the page.
   */
  _revealActiveTab() {
    const rail = this.shadowRoot.querySelector(".rail");
    const tab = rail?.querySelector(".tab.active");
    if (!tab) return;
    const r = rail.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const tools = rail.querySelector(".tools")?.getBoundingClientRect();
    if (this._mode === "phone") {
      const end = r.right - (tools?.width || 0) - 5;
      if (t.left < r.left) rail.scrollLeft -= r.left - t.left;
      else if (t.right > end) rail.scrollLeft += t.right - end;
    } else {
      const end = r.bottom - (tools?.height || 0) - 5;
      if (t.top < r.top) rail.scrollTop -= r.top - t.top;
      else if (t.bottom > end) rail.scrollTop += t.bottom - end;
    }
  }

  _editBar(tab) {
    // The rail runs down on a desk and across on a phone, so the words follow it.
    const at = this._dash.tabs.findIndex((t) => t.id === tab.id);
    const [back, on] = this._mode === "phone" ? ["Move left", "Move right"] : ["Move up", "Move down"];
    return `<div class="editbar">
      <label>Tab name <input class="tab-name" value="${esc(tab.title)}" maxlength="24"></label>
      <span class="tab-move" role="group" aria-label="Move this tab">
        <button class="btn move-tab" data-by="-1" ${at <= 0 ? "disabled" : ""}>${back}</button>
        <button class="btn move-tab" data-by="1" ${at >= this._dash.tabs.length - 1 ? "disabled" : ""}>${on}</button>
      </span>
      <button class="btn add-tab">Add a tab</button>
      ${tab.tiles.length ? "" : `<button class="btn remove-tab">Remove this tab</button>`}
      <button class="btn reset">${this._resetArmed ? "Tap again to reset everything" : "Reset layout"}</button>
      <span class="hint">${this._mode === "phone"
        ? "Add from the shelf below, send, copy or remove rows. Order and size are set on a wider screen - the phone reads that layout top to bottom."
        : "Drag <b>Move</b> to place a tile, drag the corner to resize. Controls are paused while editing."}</span>
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
          ${this._wearHtml(t)}
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

  /**
   * What can be added: HA's candidates by area, and the starting layout's
   * tiles. Where the starting layout has a hand-made tile for the same thing
   * (the fan with its corrected light and preset helper), that tile stands in
   * for the discovered one - listed under the candidate's area, so an area's
   * tab gets it. The starting layout's own section keeps only what discovery
   * cannot find (the clock, the glance, the room tiles, the guide).
   */
  _offers() {
    const fresh = availableFrom(this._dash, SEED);
    const h = this._hass || {};
    return withStartingTiles(unplacedByArea(discover({ states: h.states, entities: h.entities, devices: h.devices,
      areas: h.areas, panels: h.panels }), this._dash), fresh);
  }

  _shelfHtml() {
    const shelf = this._dash.shelf || [];
    const { found, fresh } = this._offers();
    const item = (t, cls) => `<div class="shelf-item"><span>${esc(t.title || t.id)}
        <small>${esc(rendererFor(t.kind)?.label || t.kind)}</small></span>
      <button class="btn ${cls}" data-id="${esc(t.id)}">Put on this tab</button></div>`;
    return `<div class="shelf"><div class="shelf-head">Shelf</div>
      ${shelf.length ? shelf.map((t) => item(t, "unshelve")).join("")
        : `<div class="shelf-empty">Removed tiles wait here, so nothing is lost.</div>`}
      ${fresh.length ? `<div class="shelf-head sub-head">From the starting layout</div>
        ${fresh.map((t) => item(t, "add-fresh")).join("")}` : ""}
      <div class="shelf-head sub-head">From Home Assistant - not on the dashboard yet</div>
      ${found.length ? found.map((g) => `<div class="area-group">
          <div class="area-head"><span>${esc(g.area || "No area")}</span>
            ${g.area ? `<button class="btn area-tab" data-area="${esc(g.area)}">Make a tab of these</button>` : ""}</div>
          ${g.candidates.map((c) => `<div class="shelf-item"><span>${esc(c.title)}
              <small>${esc(rendererFor(c.kind)?.label || c.kind)}</small></span>
            <button class="btn add-found" data-id="${esc(c.id)}">Put on this tab</button></div>`).join("")}
        </div>`).join("")
        : `<div class="shelf-empty">Everything Home Assistant has that a tile can show is on the dashboard.</div>`}
    </div>`;
  }

  _rowsHtml(tab) {
    // Two "Kitchen" rows (the light and the room) read the same; where titles
    // repeat on a tab, each row says what kind of thing it is.
    const count = {};
    for (const t of tab.tiles) { const k = String(t.title || t.id).toLowerCase(); count[k] = (count[k] || 0) + 1; }
    const kind = (t) => {
      if (count[String(t.title || t.id).toLowerCase()] < 2) return "";
      const r = rendererFor(t.kind);
      const noun = r?.noun ? r.noun(t.config || {}) : r?.label;
      return noun ? ` <span class="row-kind">${esc(noun)}</span>` : "";
    };
    if (this._edit) {
      const others = this._dash.tabs.filter((o) => o.id !== tab.id);
      return `<div class="rows">
        ${readingOrder(tab.tiles).map((t) => `<div class="row edit-row" data-id="${esc(t.id)}">
          <span class="row-title">${esc(t.title || t.id)}${kind(t)}</span>
          <span class="row-tools">
            <select class="to-tab" aria-label="Send ${esc(t.title)} to another tab"><option value="">Send to…</option>
              ${others.map((o) => `<option value="${esc(o.id)}">${esc(o.title)}</option>`).join("")}</select>
            <select class="copy-tab" aria-label="Also show ${esc(t.title)} on another tab"><option value="">Copy to…</option>
              ${this._dash.tabs.map((o) => `<option value="${esc(o.id)}">${esc(o.title)}</option>`).join("")}</select>
            <button class="shelve" aria-label="Remove ${esc(t.title)} to the shelf">Remove</button>
          </span>
        </div>`).join("") || `<div class="shelf-empty">Nothing on this tab yet - add from the shelf below.</div>`}
      </div>`;
    }
    return `<div class="rows">
      ${readingOrder(tab.tiles).map((t) => `<button class="row" data-id="${esc(t.id)}">
        <span class="mark" aria-hidden="true"></span>
        <span class="row-title">${esc(t.title || t.id)}${kind(t)}</span>
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
    // Edit rows carry tools, not a status line - there is nothing to fill, and
    // writing to the missing line threw and stopped the edit tools being wired.
    if (this._edit) return;
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
    if (this._themeOpen) return;
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
    const hosted = this._hosted;
    this._hosted = null;
    this._sheetId = null;
    const sheet = this.shadowRoot.querySelector(".sheet");
    if (sheet) { sheet.hidden = true; sheet.querySelector(".sheet-body").replaceChildren(); }
    if (!hosted) return;
    hosted.onClose?.();
    // On a phone the guide was opened from a tile's own sheet; closing it goes
    // back there rather than all the way out to the dashboard.
    if (hosted.wasSheetId) this._openSheet(hosted.wasSheetId);
  }

  /* --------------------------------------------------------------- wire */

  _wire(tab) {
    const r = this.shadowRoot;
    r.querySelector(".menu")?.addEventListener("click", () =>
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true })));
    r.querySelectorAll(".tab[data-tab]").forEach((b) => b.addEventListener("click", () => {
      this._tab = b.dataset.tab; store.set(TAB_KEY, this._tab); this._themeOpen = false; this._closeSheet(); this._render();
    }));
    r.querySelector(".edit-toggle")?.addEventListener("click", () => {
      this._edit = !this._edit; this._resetArmed = null; if (this._edit) this._themeOpen = false; this._render();
    });
    r.querySelector(".theme-toggle")?.addEventListener("click", () => {
      this._themeOpen = !this._themeOpen; if (this._themeOpen) this._edit = false; this._closeSheet(); this._render();
    });
    if (this._themeOpen) this._wireThemeLibrary();
    if (!this._edit) r.querySelectorAll("button.row").forEach((b) => b.addEventListener("click", () => this._openSheet(b.dataset.id)));
    r.querySelector(".sheet .close")?.addEventListener("click", () => this._closeSheet());
    r.querySelector(".sheet")?.addEventListener("click", (e) => { if (e.target.classList.contains("sheet")) this._closeSheet(); });
    if (this._edit) this._wireEdit(tab);
  }

  _wireEdit(tab) {
    const r = this.shadowRoot;
    r.querySelector(".tab-name")?.addEventListener("change", (e) => this._commit(renameTab(this._dash, tab.id, e.target.value)));
    r.querySelectorAll(".move-tab").forEach((b) => b.addEventListener("click", () => {
      const by = Number(b.dataset.by);
      if (!this._commit(moveTab(this._dash, tab.id, by))) return;
      this._say(`moved ${tab.title}`);
      // The render replaced the button; keep the keyboard where it was, or on
      // the other one once this end of the row is reached.
      const again = this.shadowRoot.querySelector(`.move-tab[data-by="${by}"]`);
      (again && !again.disabled ? again : this.shadowRoot.querySelector(`.move-tab[data-by="${-by}"]`))?.focus();
    }));
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
      const id = sel.closest("[data-id]").dataset.id;
      const dest = this._dash.tabs.find((t) => t.id === sel.value);
      if (dest && this._commit(moveToTab(this._dash, id, dest.id))) this._say(`sent to ${dest.title}`);
    }));
    r.querySelectorAll(".copy-tab").forEach((sel) => sel.addEventListener("change", () => {
      const id = sel.closest("[data-id]").dataset.id;
      const dest = this._dash.tabs.find((t) => t.id === sel.value);
      if (dest && this._commit(copyToTab(this._dash, id, dest.id))) this._say(`copied to ${dest.title}`);
    }));
    // Discovered candidates: a tile written from what HA reports.
    const asTile = (c) => {
      const r0 = rendererFor(c.kind);
      return { id: c.id, kind: c.kind, title: c.title, w: c.w || r0?.size?.w || 4, h: c.h || r0?.size?.h || 4, config: c.config };
    };
    r.querySelectorAll(".add-found").forEach((b) => b.addEventListener("click", () => {
      const c = this._offers().found.flatMap((g) => g.candidates).find((x) => x.id === b.dataset.id);
      if (c && this._commit(addTile(this._dash, asTile(c), tab.id))) this._say(`added ${c.title}`);
    }));
    // "Then group them": a tab named after the area, holding its candidates.
    r.querySelectorAll(".area-tab").forEach((b) => b.addEventListener("click", () => {
      const group = this._offers().found.find((g) => g.area === b.dataset.area);
      if (!group) return;
      let res = addTab(this._dash, group.area);
      if (!res.ok) { this._say(`not added: ${res.reason}`, true); return; }
      let dash = res.dash;
      for (const c of group.candidates) {
        const next = addTile(dash, asTile(c), res.tab.id);
        if (next.ok) dash = next.dash;
      }
      this._tab = res.tab.id;
      store.set(TAB_KEY, this._tab);
      this._commit({ ok: true, dash });
      this._say(`made a ${group.area} tab with ${group.candidates.length} tile${group.candidates.length === 1 ? "" : "s"}`);
    }));
    r.querySelectorAll(".add-fresh").forEach((b) => b.addEventListener("click", () => {
      const tile = availableFrom(this._dash, SEED).find((t) => t.id === b.dataset.id);
      if (tile) this._commit(addTile(this._dash, tile, tab.id));
    }));
    r.querySelectorAll(".shelve").forEach((b) => b.addEventListener("click", () =>
      this._commit(shelveTile(this._dash, b.closest("[data-id]").dataset.id))));
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
    /* The panel's own tokens (panel-tokens.js). Each falls back to the LCARS
       frame as it was, or to the token it follows. */
    --db-surface: var(--db-tile-surface, var(--db-bg));
    --db-border: var(--db-tile-border, var(--db-line));
    --db-tab-on: var(--db-tab-active, var(--db-active));
    --db-tab-on-text: var(--db-tab-active-text, var(--db-active-text));
    --db-radius: var(--db-tile-radius, 14px);
    --db-radius-start: var(--db-tile-radius-start, 0px);
    --db-tab-r: var(--db-tab-radius, 0px);
    --db-ctl-r: var(--db-control-radius, 20px);
    --db-key-r: var(--db-key-radius, 50px);
    --db-shadow: var(--db-tile-shadow, none);
    --db-c: var(--db-chamfer, 14px);
    --db-mono: ui-monospace, "Cascadia Mono", Consolas, "Roboto Mono", monospace;
    /* The tiles' cards read Home Assistant's standard variables. Pointing those
       at the LCARS roles here themes every tile - and every pop-up a tile opens -
       with no change to the cards; outside the panel they keep HA's theme.

       HA's variables carry COLOUR and nothing else, so a frame stopped at the
       card's edge: a cockpit tile held pill-shaped buttons because the card had
       written 8px into its own stylesheet. This panel's own cards may therefore
       also read three SHAPE variables - --db-ctl-r for a control, --db-radius
       for a card-sized surface, --db-key-r for a round key - each with the
       card's old value as the fallback, so a card in a plain Lovelace dashboard
       is exactly what it was. A card from anywhere else still only needs HA's
       variables; these are an opt-in, not a requirement.
       (No back-ticks in here: this whole block is inside a template literal.) */
    --primary-text-color: var(--db-text);
    --text-primary-color: var(--db-active-text);        /* HA's name for text ON the accent */
    --secondary-text-color: color-mix(in srgb, var(--db-text) 62%, var(--db-bg));
    --accent-color: var(--db-active);
    --card-background-color: var(--db-surface);
    --ha-card-background: var(--db-surface);
    --secondary-background-color: color-mix(in srgb, var(--db-tab) 30%, var(--db-bg));
    --divider-color: color-mix(in srgb, var(--db-frame) 55%, var(--db-bg));
    --ha-card-border-radius: 0;
    --ha-card-border-width: 0;
    --ha-card-box-shadow: none;
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
  .menu { margin: 8px 0 0 14px; width: 44px; height: 40px; border: 0; border-radius: var(--db-ctl-r); cursor: pointer;
          background: var(--db-bg); color: var(--db-text); font-size: 20px; }
  .bar { grid-area: bar; display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
  .band { height: 22px; flex: 1; background: var(--db-frame); }
  .title { margin: 0; font-size: 30px; line-height: 1; font-weight: 400; letter-spacing: .06em;
           text-transform: uppercase; color: var(--db-active); white-space: nowrap; }
  .cap { width: 34px; height: 22px; background: var(--db-frame); border-radius: 0 11px 11px 0; flex: none; }
  /* The band breaks for the time, as LCARS bars break for text. */
  .clock { flex: none; font-size: 24px; line-height: 22px; letter-spacing: .05em; white-space: nowrap;
           color: var(--db-text); font-variant-numeric: tabular-nums; }
  .clock-ampm { font-size: .6em; margin-left: .25em; letter-spacing: .08em; opacity: .85; }
  .phone .clock { font-size: 20px; line-height: 18px; }

  .rail { grid-area: rail; display: flex; flex-direction: column; gap: 5px; min-height: 0; overflow-y: auto; }
  .tab { border: 0; border-radius: var(--db-tab-r); cursor: pointer; min-height: 56px; padding: 6px 10px; text-align: right;
         display: flex; align-items: flex-end; justify-content: flex-end;
         background: var(--db-tab); color: var(--db-tab-text); text-transform: uppercase; letter-spacing: .06em; font-size: 15px; }
  .tab.active { background: var(--db-tab-on); color: var(--db-tab-on-text); }
  .tab.tool { background: var(--db-edit); color: var(--db-edit-text); min-height: 48px; }
  .tab:focus-visible, .btn:focus-visible, .row:focus-visible, .close:focus-visible, .grab:focus-visible
    { outline: 2px solid var(--db-text); outline-offset: 2px; }
  .rail-fill { flex: 1; min-height: 20px; background: var(--db-frame); border-bottom-left-radius: var(--db-outer); }
  .tools { display: flex; flex-direction: column; gap: 5px; }
  /* With more tabs than fit, the tabs scroll and the tools stay pinned at the
     rail's foot. The shadow paints the rail's 5px gap over a tab scrolling under. */
  .desk .tools { position: sticky; bottom: 0; z-index: 1; background: var(--db-bg); box-shadow: 0 -5px 0 var(--db-bg); }
  .theme-view { max-width: 980px; }
  .theme-lib { display: grid; gap: 14px; margin-bottom: 12px; }
  .lib-label { font-size: 12px; letter-spacing: .08em; opacity: .8; margin-bottom: 6px; text-transform: uppercase; }
  .lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
  .theme-card { display: grid; gap: 3px; padding: 6px; text-align: left; cursor: pointer; font: inherit; color: var(--db-text);
    background: transparent; border: 1px solid color-mix(in srgb, var(--db-text) 20%, transparent); border-radius: 6px; }
  .theme-card.on { outline: 2px solid var(--db-active); outline-offset: 1px; }
  .theme-card:focus-visible { outline: 2px solid var(--db-text); outline-offset: 2px; }
  .theme-name { font-size: 13px; } .theme-frame { font-size: 11px; opacity: .7; }
  .theme-badge { margin-left: 6px; padding: 0 5px; border-radius: 999px; font-size: 10px; letter-spacing: .04em;
    text-transform: uppercase; background: var(--db-tile-border); color: var(--db-text); opacity: .85; }
  .mini { position: relative; display: block; height: 72px; overflow: hidden; border-radius: 3px; background: var(--m-bg); }
  .mini i, .mini b, .mini u { position: absolute; display: block; font-style: normal; text-decoration: none; }
  .m-band { left: 0; right: 0; top: 0; height: 10px; background: var(--m-frame); }
  .m-rail { left: 4px; top: 16px; width: 26px; display: grid; gap: 3px; }
  .m-rail b { position: static; height: 11px; background: var(--m-tab); border-radius: calc(var(--m-r) / 2); }
  .m-rail b.on { background: var(--m-on); }
  .m-tile { left: 36px; right: 6px; top: 16px; bottom: 6px; background: var(--m-surf); border: 1px solid var(--m-line);
    border-radius: 0 var(--m-r) var(--m-r) 0; }
  .m-tile u { left: 6px; height: 4px; background: var(--m-text); opacity: .75; }
  .m-tile u:first-child { top: 7px; right: 30%; } .m-tile u + u { top: 16px; width: 40%; background: var(--m-on); opacity: 1; }
  .lib-actions, .lib-panel { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; }
  .lib-panel-col { flex-direction: column; align-items: stretch; }
  .lib-panel-col > div { display: flex; gap: 8px; }
  .lib-draft { opacity: .85; margin-right: 4px; }
  .lib-panel input, .lib-json { background: var(--db-bg); color: var(--db-text); border: 1px solid var(--db-edit);
    border-radius: var(--db-ctl-r); padding: 4px 10px; font: inherit; }
  .lib-json { font-family: var(--db-mono, ui-monospace, monospace); font-size: 12px; border-radius: 6px; width: 100%; }
  .lib-msg { font-size: 13px; margin: 4px 0 8px; color: var(--db-ok); }
  .theme-slot { margin-top: 4px; }

  .stage { grid-area: stage; min-width: 0; min-height: 0; overflow: auto; padding: 4px 12px 16px 14px; }
  .status { font-size: 12px; min-height: 16px; color: var(--db-ok); letter-spacing: .04em; margin-bottom: 6px; }
  .status.bad { color: var(--db-edit); }

  .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: ${ROW_H}px;
          gap: ${GAP}px; min-height: calc(var(--rows) * ${ROW_H + GAP}px); position: relative; }
  .tile { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column;
          border: 1px solid var(--db-border); box-shadow: var(--db-shadow);
          border-radius: var(--db-radius-start) var(--db-radius) var(--db-radius) var(--db-radius-start);
          overflow: hidden; background: var(--db-surface); }
  /* What happened to this plate (material-art.js). A positioned layer under
     positioned content - NOT z-index:-1, which would put it behind the tile's
     own background and only work while some ancestor happens to make a
     stacking context. Nothing here needs to slide between the tile and its
     fill, so nothing here needs that trick. */
  .tile-wear { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
               border-radius: inherit; }
  .tile-wear .wear-blur { position: absolute; inset: 0; }
  .tile-wear .wear-layer { position: absolute; inset: 0;
    mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat;
    /* cover, never stretch: a wide tile crops its damage instead of pulling
       round blooms into ellipses. The crop starts where this tile's seed says,
       so twelve tiles are not one tile twelve times. */
    mask-size: cover; -webkit-mask-size: cover;
    mask-position: var(--wear-crop, center); -webkit-mask-position: var(--wear-crop, center);
    mask-mode: luminance; -webkit-mask-source-type: luminance; }
  .tile-bar, .tile-body { position: relative; z-index: 1; }
  .tile-bar { display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px; flex: none;
              background: var(--db-tile-bar); color: var(--db-tile-bar-text); text-transform: uppercase;
              letter-spacing: .05em; font-size: 13px; }
  .tile-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tile-body { flex: 1; min-height: 0; overflow: auto; }
  /* A card's outer box is see-through here, so the tile's own surface - and in
     the cockpit frame its texture - shows wherever there is no control. Only
     --ha-card-background: pop-ups, inputs and sticky headers paint
     --card-background-color, which stays solid. */
  .tile-body, .sheet-body { --ha-card-background: transparent; }
  .editing .tile { border-color: var(--db-edit); }
  .editing .tile-body { pointer-events: none; opacity: .55; }
  .grab, .shelve, .to-tab, .copy-tab { border: 0; border-radius: var(--db-ctl-r); padding: 4px 10px; cursor: pointer; font-size: 12px;
                            background: var(--db-bg); color: var(--db-text); text-transform: uppercase; }
  .grab { cursor: grab; touch-action: none; background: var(--db-active); color: var(--db-active-text); }
  .resize { position: absolute; right: 0; bottom: 0; width: 26px; height: 26px; cursor: nwse-resize; touch-action: none;
            background: linear-gradient(135deg, transparent 50%, var(--db-edit) 50%); }
  .ghost { grid-column: 1; grid-row: 1; z-index: 3; pointer-events: none; border: 2px dashed var(--db-ok);
           background: color-mix(in srgb, var(--db-ok) 18%, transparent); color: var(--db-text);
           display: flex; align-items: center; justify-content: center; font-size: 13px;
           border-radius: var(--db-radius-start) var(--db-radius) var(--db-radius) var(--db-radius-start); }
  .ghost.bad { border-color: var(--db-edit); background: color-mix(in srgb, var(--db-edit) 22%, transparent); }
  .ghost[hidden] { display: none; }

  .editbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; }
  .editbar input { background: var(--db-bg); color: var(--db-text); border: 1px solid var(--db-edit);
                   border-radius: var(--db-ctl-r); padding: 4px 10px; width: 12em; }
  .btn { border: 0; border-radius: var(--db-ctl-r); padding: 6px 14px; cursor: pointer; font-size: 13px; text-transform: uppercase;
         letter-spacing: .04em; background: var(--db-tab); color: var(--db-tab-text); }
  .btn.reset { background: #000000; color: #ffffff; outline: 1px solid #ffffff; }
  .lib-scope { display: inline-flex; gap: 2px; }
  .lib-scope .btn { background: var(--db-tile-surface); color: var(--db-text); opacity: .8; }
  .lib-scope .btn.on { background: var(--db-tab-active); color: var(--db-tab-active-text); opacity: 1; }
  .btn:disabled { opacity: .4; cursor: default; }
  .tab-move { display: inline-flex; gap: 6px; }
  .hint { opacity: .75; font-size: 12px; }
  .shelf { margin-top: 16px; border-top: 5px solid var(--db-frame); padding-top: 8px; font-size: 13px; }
  .shelf-head { text-transform: uppercase; letter-spacing: .08em; color: var(--db-active); margin-bottom: 6px; }
  .shelf-head.sub-head { margin-top: 12px; }
  .area-group { margin: 6px 0 10px; padding-left: 10px; border-left: 3px solid var(--db-frame); }
  .area-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 2px;
               text-transform: uppercase; letter-spacing: .06em; font-size: 12px; color: var(--db-text); }
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
  .phone .tab { min-height: 40px; flex: none; border-radius: var(--db-ctl-r); padding: 6px 16px; align-items: center; }
  /* With a dozen tabs the strip scrolls; Edit and Theme stay pinned at its right edge. */
  .phone .tools { flex-direction: row; position: sticky; right: 0; z-index: 1; margin-left: auto;
                  background: var(--db-bg); box-shadow: -5px 0 0 var(--db-bg); }
  .rows { display: flex; flex-direction: column; gap: 6px; }
  .row { display: grid; grid-template-columns: 18px 1fr auto; grid-template-areas: "mark title chev" "mark sum chev";
         column-gap: 10px; align-items: center; text-align: left; width: 100%; min-height: 60px; padding: 8px 12px;
         border: 0; cursor: pointer; background: var(--db-line); color: var(--db-text);
         border-radius: var(--db-radius-start) calc(var(--db-radius) * 10 / 7) calc(var(--db-radius) * 10 / 7) var(--db-radius-start); }
  .row-title { grid-area: title; text-transform: uppercase; letter-spacing: .05em; font-size: 15px; }
  .row.edit-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; cursor: default;
                  box-shadow: inset 3px 0 0 var(--db-edit); }
  .row.edit-row .row-title { flex: 1 1 140px; }
  .row-tools { display: flex; flex-wrap: wrap; gap: 6px; }
  .phone .editbar label { flex: 1 1 100%; }
  .phone .editbar input { width: 100%; }
  .row-kind { font-size: 11px; letter-spacing: .08em; padding: 1px 7px; margin-left: 6px; border-radius: var(--db-ctl-r);
              vertical-align: 2px; background: var(--db-frame); color: var(--db-frame-text); }
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
               background: var(--db-frame); color: var(--db-frame-text);
               border-radius: calc(var(--db-radius) * 10 / 7) calc(var(--db-radius) * 10 / 7) 0 0;
               text-transform: uppercase; letter-spacing: .06em; }
  .close { border: 0; border-radius: var(--db-ctl-r); padding: 8px 18px; cursor: pointer; background: var(--db-bg); color: var(--db-text); }
  .sheet-body { background: var(--db-surface); max-height: 85dvh; overflow: auto; padding-bottom: env(safe-area-inset-bottom, 0px); }
  /* A phone on its side has little height to give; the sheet takes nearly all of it. */
  @media (max-height: 500px) { .sheet-body { max-height: calc(100dvh - 64px); } }

  /* Every frame but LCARS draws with its own block - see ./frame-styles.js. */
  ${FRAME_STYLES}
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
