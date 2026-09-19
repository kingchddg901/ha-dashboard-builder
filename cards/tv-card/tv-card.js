/**
 * TV card - level 2, first pass. Small on purpose.
 *
 * Power, volume, source and a d-pad, built from what the media player claims and
 * shown back only as far as the set confirms it. The rules, and why each one is
 * there, live in ./tv-core.js with the tests.
 *
 * Two kinds of feedback, never mixed:
 *   - power, volume and mute come back from the set, so they show the live value;
 *   - a remote key gets no acknowledgement at all, so it can say SENT and nothing
 *     more. A key that "worked" is indistinguishable from one the set ignored.
 *
 * type: custom:tv-card
 * title: Big TV
 * media_player: media_player.big_tv_2
 * remote: remote.big_tv
 *
 * The d-pad speaks whichever language the remote's integration does - Samsung's
 * KEY_* codes or Android TV's DPAD_* names - looked up from the remote's own
 * platform. A remote on a platform with no key table gets no d-pad at all.
 *
 * Favourites: on a Samsung remote, the first few channels saved in the TV Plus
 * guide show as one-tap buttons - the same saved list, so reordering it in the
 * guide changes them here.
 *   favorites: 5        # how many (0 turns them off); default 5 on Samsung, else 0
 *   list: default       # which saved list, as in the guide card
 *   saved_for: user     # or house, as in the guide card
 *
 * TV Plus guide: on the same remotes, a button opens the whole guide (saved
 * channels, search, reminders) over the card, so the guide needs no tile of its
 * own. `guide: false` hides it. The d-pad's "guide" key is different: it is the
 * TV's own on-screen guide.
 */

import { describeEntity } from "../builder-debug-card/capability-core.js";
import { layoutFor, axisFor } from "../appliance-card/control-core.js";
import { platformKey, tvControls } from "./tv-core.js";
import { loadLineup, tuneCommand, tuneDuration, favoritesFrom } from "../samsung-tvplus-card/tvplus-core.js";
import { subscribeSaved } from "../samsung-tvplus-card/saved-list.js";

// TV Plus is Samsung's; only these remotes get favourites unless the card asks.
const TVPLUS_PLATFORMS = new Set(["samsungtv_smart", "samsungtv"]);

const esc = (v) => String(v).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

class TvCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = null;
    this._width = null;
    this._height = typeof window !== "undefined" ? window.innerHeight : null;
    this._onResize = () => {
      const h = window.innerHeight;
      if (h !== this._height) { this._height = h; this._sig = null; this._render(); }
    };
  }

  setConfig(config) {
    if (!config.media_player) throw new Error("tv-card: `media_player` is required");
    this._config = { title: "TV", ...config };
    this._sig = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._guide) this._guide.hass = hass;
    this._ensureFavs();
    this._render();
  }

  connectedCallback() {
    this._ensureFavs();
    this._onKey = this._onKey || ((e) => { if (e.key === "Escape") this._closeGuide(); });
    document.addEventListener("keydown", this._onKey);
    if (!this._ro && typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w && w !== this._width) { this._width = w; this._sig = null; this._render(); }
      });
      this._ro.observe(this);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this._onResize);
      window.addEventListener("orientationchange", this._onResize);
    }
  }

  disconnectedCallback() {
    if (this._onKey) document.removeEventListener("keydown", this._onKey);
    const unsub = this._unsub;
    this._unsub = null;
    unsub?.then((f) => f?.()).catch(() => {});
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this._onResize);
      window.removeEventListener("orientationchange", this._onResize);
    }
  }

  getCardSize() { return 6; }

  static getStubConfig() { return { media_player: "", remote: "" }; }

  _call(domain, service, data) { this._hass.callService(domain, service, data); }

  /* ---------------- favourites ---------------- */

  _remotePlatform() {
    return this._config?.remote ? (this._hass?.entities?.[this._config.remote]?.platform ?? null) : null;
  }

  _favCount() {
    if (!this._config?.remote) return 0;
    const c = this._config.favorites;
    if (Number.isFinite(c)) return Math.max(0, Math.min(8, Math.round(c)));
    return TVPLUS_PLATFORMS.has(this._remotePlatform()) ? 5 : 0;
  }

  /** Follow the saved list and load the lineup, once each, only if favourites are on. */
  _ensureFavs() {
    if (!this._favCount() || !this._hass?.connection || !this.isConnected) return;
    if (!this._unsub && !this._favFailed) {
      this._unsub = subscribeSaved(this._hass,
        { list: this._config.list, savedFor: this._config.saved_for }, (value) => {
          this._favSaved = value; this._sig = null; this._render();
        });
      this._unsub.catch(() => { this._unsub = null; this._favFailed = true; this._sig = null; this._render(); });
    }
    if (!this._lineup && !this._lineupLoading) {
      this._lineupLoading = true;
      loadLineup({ region: this._config.region || "us" })
        .then(({ index }) => { this._lineup = index; this._sig = null; this._render(); })
        .catch((e) => { this._lineupErr = e.message; this._sig = null; this._render(); });
    }
  }

  _tuneFav(name) {
    const ch = this._lineup?.[name];
    if (!ch || !this._config.remote) return;
    const opts = { platform: this._remotePlatform(), gapMs: this._config.key_gap_ms };
    this._call("remote", "send_command", { entity_id: this._config.remote, command: tuneCommand(ch.n, opts) });
    this._favSending = name;
    this._sig = null; this._render();
    clearTimeout(this._favT);
    this._favT = setTimeout(() => { this._favSending = null; this._sig = null; this._render(); },
      Math.max(1500, tuneDuration(ch.n, opts) + 500));
  }

  /* ---------------- the TV Plus guide, over the card ---------------- */

  _guideOn() {
    if (!this._config?.remote || this._config.guide === false) return false;
    return this._config.guide === true || TVPLUS_PLATFORMS.has(this._remotePlatform());
  }

  async _openGuide() {
    const modal = this.shadowRoot.querySelector(".modal");
    if (!modal) return;
    if (!this._guide) {
      try {
        await import("../samsung-tvplus-card/samsung-tvplus-card.js");
        const el = document.createElement("samsung-tvplus-card");
        const c = this._config;
        el.setConfig({ type: "custom:samsung-tvplus-card", title: "TV Plus guide", remote: c.remote,
          media_player: c.media_player, list: c.list, saved_for: c.saved_for, key_gap_ms: c.key_gap_ms,
          channels: c.channels, notify: c.notify, remind_lead: c.remind_lead, region: c.region });
        el.hass = this._hass;
        this._guide = el;
      } catch (e) {
        modal.querySelector(".mbody").innerHTML = `<div class="srcline">The guide could not load: ${esc(e.message)}</div>`;
      }
    }
    if (this._guide) modal.querySelector(".mbody").replaceChildren(this._guide);
    // The guide names itself; the bar says which TV it will tune.
    modal.querySelector(".mt").textContent = this._config.title;
    modal.hidden = false;
    modal.querySelector(".close").focus({ preventScroll: true });
  }

  _closeGuide() {
    const modal = this.shadowRoot.querySelector(".modal");
    if (modal && !modal.hidden) modal.hidden = true;
  }

  _favHtml(on) {
    const n = this._favCount();
    if (!n) return "";
    if (this._favFailed) return `<div class="srcline">favourites: the saved list could not be read</div>`;
    if (!this._lineup) return this._lineupErr ? `<div class="srcline">favourites: lineup unavailable</div>` : "";
    const favs = favoritesFrom(this._favSaved, this._lineup, n);
    if (!favs.length) {
      // The guide shows its starting list before anything is saved; nothing is
      // stored until a channel is saved or moved there, so say what makes them appear.
      return `<div class="srcline">Favourites appear here once you save or reorder channels in the TV Plus guide (the first ${n}).</div>`;
    }
    return `<div class="favs ${on ? "" : "dim"}" role="group" aria-label="Favourite channels">
      ${favs.map((f) => `<button class="fav ${this._favSending === f.name ? "sent" : ""}" data-fav="${esc(f.name)}"
          ${f.n == null ? "disabled" : ""} aria-label="Tune ${esc(f.name)}${f.n == null ? " (not in the lineup)" : ` (${f.n})`}">
          <span class="fno">${f.n ?? "—"}</span><span class="fnm">${esc(f.name)}</span></button>`).join("")}
    </div>
    <div class="srcline">${this._favSending ? `sending ${esc(this._favSending)} · the set doesn't confirm channel changes` : ""}</div>`;
  }

  _render() {
    if (!this._hass || !this._config) return;
    const id = this._config.media_player;
    const st = this._hass.states[id];
    const rec = st ? describeEntity({ entityId: id, entry: this._hass.entities?.[id] || null,
      state: st, devices: this._hass.devices || {}, areas: this._hass.areas || {} }) : null;
    const c = tvControls(rec);
    const remotePlatform = this._config.remote
      ? (this._hass.entities?.[this._config.remote]?.platform ?? null) : null;
    const hasPad = Boolean(this._config.remote && platformKey("OK", remotePlatform));
    const layout = layoutFor(this._width);
    const axis = axisFor(layout, this._height);

    const favHtml = this._favHtml(c.on);
    const guideOn = this._guideOn();
    const sig = JSON.stringify([layout, axis, c, this._lastKey, remotePlatform, favHtml, guideOn]);
    if (sig === this._sig) return;
    this._sig = sig;

    const stateWord = !c.available ? "unavailable" : !c.on ? "off"
      : c.power.confirmed ? "on" : "on (assumed)";
    const src = c.source;
    const srcLine = !c.on ? "" : src.kind === "exact" ? src.current
      : src.kind === "ambiguous" ? `${esc(src.list.join(" or "))} - the set can't say which` : "";
    // No source picker (Android TV has none): say which app is running instead,
    // as the package id it really is - HA gives no display name for it.
    const appLine = c.on && !c.source.canSelect && c.app ? `running ${esc(c.app)}` : "";

    // Built once, so the guide's pop-up survives every repaint of the card.
    if (!this.shadowRoot.querySelector(".content")) {
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="content"></div>
        <div class="modal" hidden role="dialog" aria-modal="true" aria-label="TV Plus guide">
          <div class="sheet"><div class="bar"><span class="mt"></span>
            <button type="button" class="close">Close</button></div><div class="mbody"></div></div>
        </div>`;
      const m = this.shadowRoot.querySelector(".modal");
      m.querySelector(".close").addEventListener("click", () => this._closeGuide());
      m.addEventListener("click", (e) => { if (e.target === m) this._closeGuide(); });
    }
    this.shadowRoot.querySelector(".content").innerHTML = `
      <ha-card class="${esc(axis)} ${c.on ? "on" : "off"}">
        <div class="hd">
          <span class="t">${esc(this._config.title)}</span>
          <span class="state ${esc(stateWord)}">${esc(stateWord)}</span>
        </div>
        <div class="body">
          <div class="col main">
            <div class="row power-row">
              <button class="power" aria-label="Power">⏻</button>
              <div class="vol ${c.on ? "" : "dim"}">
                <button class="vbtn vdown" aria-label="Volume down" ${c.on && c.volume.step ? "" : "disabled"}>−</button>
                <span class="vlevel">${c.volume.confirmed ? `${c.volume.level}%` : "—"}</span>
                <button class="vbtn vup" aria-label="Volume up" ${c.on && c.volume.step ? "" : "disabled"}>+</button>
                <button class="vbtn vmute ${c.volume.muted ? "active" : ""}" aria-label="Mute"
                        ${c.on && c.volume.mute ? "" : "disabled"}>${c.volume.muted ? "🔇" : "🔈"}</button>
              </div>
            </div>
            ${c.source.canSelect && src.list.length ? `
            <div class="row sources ${c.on ? "" : "dim"}">
              ${src.list.map((s) => `<button class="src ${src.kind === "exact" && src.current === s ? "active" : ""}"
                   data-src="${esc(s)}" ${c.on ? "" : "disabled"}>${esc(s)}</button>`).join("")}
            </div>
            <div class="srcline">${srcLine}</div>` : ""}
            ${appLine ? `<div class="srcline">${appLine}</div>` : ""}
            ${favHtml}
            ${guideOn ? `<div class="row guide-row">
              <button type="button" class="guide-open" aria-haspopup="dialog">TV Plus guide ›</button></div>` : ""}
          </div>
          ${this._config.remote && !hasPad ? `
          <div class="col pad"><div class="srcline">no key table for ${esc(remotePlatform || "this remote")}
            - the d-pad is left off rather than guessed</div></div>` : ""}
          ${hasPad ? `
          <div class="col pad ${c.on ? "" : "dim"}">
            <div class="dpad">
              <span></span><button class="k" data-k="UP" aria-label="Up">▲</button><span></span>
              <button class="k" data-k="LEFT" aria-label="Left">◀</button>
              <button class="k ok" data-k="OK" aria-label="OK">OK</button>
              <button class="k" data-k="RIGHT" aria-label="Right">▶</button>
              <span></span><button class="k" data-k="DOWN" aria-label="Down">▼</button><span></span>
            </div>
            <div class="navrow">
              <button class="k small" data-k="BACK">back</button>
              <button class="k small" data-k="HOME">home</button>
              <button class="k small" data-k="MENU">menu</button>
              <button class="k small" data-k="GUIDE">guide</button>
            </div>
            <div class="sent">${this._lastKey ? `sent ${esc(this._lastKey)} <span class="dim">· the set doesn't confirm keys</span>` : "&nbsp;"}</div>
          </div>` : ""}
        </div>
      </ha-card>`;
    this._wire(c);
  }

  _wire(c) {
    const r = this.shadowRoot;
    const id = this._config.media_player;
    r.querySelector(".power")?.addEventListener("click", () =>
      this._call("media_player", c.on ? "turn_off" : "turn_on", { entity_id: id }));
    r.querySelector(".vdown")?.addEventListener("click", () =>
      this._call("media_player", "volume_down", { entity_id: id }));
    r.querySelector(".vup")?.addEventListener("click", () =>
      this._call("media_player", "volume_up", { entity_id: id }));
    r.querySelector(".vmute")?.addEventListener("click", () =>
      this._call("media_player", "volume_mute", { entity_id: id, is_volume_muted: !c.volume.muted }));
    r.querySelectorAll(".fav").forEach((b) => b.addEventListener("click", () => this._tuneFav(b.dataset.fav)));
    r.querySelector(".guide-open")?.addEventListener("click", () => this._openGuide());
    r.querySelectorAll(".src").forEach((b) => b.addEventListener("click", () =>
      this._call("media_player", "select_source", { entity_id: id, source: b.dataset.src })));
    const platform = this._config.remote
      ? (this._hass.entities?.[this._config.remote]?.platform ?? null) : null;
    r.querySelectorAll(".k").forEach((b) => b.addEventListener("click", () => {
      const cmd = platformKey(b.dataset.k, platform);
      if (!cmd || !this._config.remote) return;
      this._call("remote", "send_command", { entity_id: this._config.remote, command: cmd });
      this._lastKey = cmd;
      this._sig = null; this._render();
    }));
  }
}

const STYLE = `
  :host { display: block; }
  ha-card { padding: 10px 12px 12px; display: block; }
  .hd { display: flex; align-items: baseline; gap: 8px; padding-bottom: 8px;
        border-bottom: 1px solid var(--divider-color, #444); }
  .t { font-size: 14px; font-weight: 600; }
  .state { margin-left: auto; font-size: 11px; letter-spacing: .05em; text-transform: uppercase;
           color: var(--secondary-text-color); }
  .state.on { color: var(--success-color, #66bb6a); }
  .state.unavailable { color: var(--error-color, #ff5252); }
  .body { display: flex; flex-direction: column; gap: 12px; padding-top: 10px; }
  ha-card.horizontal .body { flex-direction: row; align-items: flex-start; }
  ha-card.horizontal .col.main { flex: 1 1 55%; min-width: 0; }
  ha-card.horizontal .col.pad { flex: 0 0 auto; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .dim { opacity: .5; }
  .power { width: 44px; height: 44px; border-radius: 50%; font-size: 18px; cursor: pointer; flex: none;
           border: 1px solid var(--divider-color, #555); background: var(--secondary-background-color, #222);
           color: var(--primary-text-color); }
  ha-card.on .power { background: var(--primary-text-color, #eee); color: var(--card-background-color, #111);
                      border-color: transparent; }
  .vol { display: flex; align-items: center; gap: 6px; }
  .vbtn, .src, .k { font: inherit; cursor: pointer; border-radius: 8px; color: var(--primary-text-color);
                    border: 1px solid var(--divider-color, #555); background: var(--secondary-background-color, #1c2126); }
  .vbtn { min-width: 40px; height: 40px; font-size: 18px; }
  .vbtn:disabled, .src:disabled { cursor: default; }
  .vbtn.active { border-color: var(--accent-color, #ff9900); }
  .vlevel { min-width: 42px; text-align: center; font-size: 13px; font-weight: 600;
            font-variant-numeric: tabular-nums; }
  .sources { margin-top: 10px; }
  .src { padding: 6px 14px; font-size: 12.5px; }
  .src.active { border-color: var(--accent-color, #ff9900); background: none; }
  .srcline { font-size: 11px; color: var(--secondary-text-color); margin-top: 4px; min-height: 14px; }
  .dpad { display: grid; grid-template-columns: repeat(3, 52px); grid-template-rows: repeat(3, 52px);
          gap: 6px; justify-content: center; }
  .k { font-size: 15px; }
  .k.ok { font-weight: 700; font-size: 13px; border-color: var(--accent-color, #ff9900); }
  .navrow { display: flex; gap: 6px; justify-content: center; margin-top: 8px; }
  .k.small { padding: 6px 12px; font-size: 12px; }
  .sent { font-size: 10.5px; color: var(--secondary-text-color); text-align: center; margin-top: 6px;
          min-height: 14px; font-variant-numeric: tabular-nums; }
  .sent .dim { opacity: .7; }
  .favs { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 6px; margin-top: 10px; }
  .fav { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid var(--divider-color, #555);
         background: var(--secondary-background-color, #1c2126); color: var(--primary-text-color);
         padding: 6px 8px; display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
         min-width: 0; text-align: left; }
  .fno { font-size: 12px; font-weight: 700; color: var(--accent-color, #ff9900); font-variant-numeric: tabular-nums; }
  .fnm { font-size: 12px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fav.sent { border-color: var(--accent-color, #ff9900); }
  .fav:disabled { opacity: .45; cursor: default; }
  .guide-row { margin-top: 10px; }
  .guide-open { font: inherit; cursor: pointer; border-radius: 8px; padding: 7px 14px; font-size: 13px;
                color: var(--primary-text-color); border: 1px solid var(--accent-color, #ff9900);
                background: var(--secondary-background-color, #1c2126); }
  .guide-open:focus-visible, .close:focus-visible { outline: 2px solid var(--accent-color, #ff9900); outline-offset: 1px; }
  .modal { position: fixed; inset: 0; z-index: 20; background: color-mix(in srgb, #000 60%, transparent);
           display: flex; align-items: flex-end; justify-content: center; }
  .modal[hidden] { display: none; }
  .sheet { width: min(720px, 100%); max-height: 90dvh; display: flex; flex-direction: column;
           background: var(--card-background-color, #111); border-radius: 16px 16px 0 0; overflow: hidden; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 8px 16px;
         border-bottom: 1px solid var(--divider-color, #444); font-size: 13px; }
  .close { font: inherit; cursor: pointer; border-radius: 12px; padding: 6px 14px; border: 1px solid var(--divider-color, #555);
           background: none; color: var(--primary-text-color); }
  .mbody { flex: 1; min-height: 0; overflow: auto; padding-bottom: env(safe-area-inset-bottom, 0px); }
  /* Searching or browsing the whole lineup: the pop-up takes the full height. */
  .sheet:has(samsung-tvplus-card[data-mode="search"]) { height: 90dvh; }
`;

// Guarded: the panel and a Lovelace resource can both load this module, and a
// second define would throw and take the whole module down with it.
if (!customElements.get("tv-card")) customElements.define("tv-card", TvCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tv-card",
  name: "TV (level 2)",
  description: "Power, volume, source and a d-pad - live where the set reports back, 'sent' where it cannot.",
});
