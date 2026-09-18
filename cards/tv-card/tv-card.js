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
 */

import { describeEntity } from "../builder-debug-card/capability-core.js";
import { layoutFor, axisFor } from "../appliance-card/control-core.js";
import { platformKey, tvControls } from "./tv-core.js";

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

  set hass(hass) { this._hass = hass; this._render(); }

  connectedCallback() {
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
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this._onResize);
      window.removeEventListener("orientationchange", this._onResize);
    }
  }

  getCardSize() { return 6; }

  static getStubConfig() { return { media_player: "", remote: "" }; }

  _call(domain, service, data) { this._hass.callService(domain, service, data); }

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

    const sig = JSON.stringify([layout, axis, c, this._lastKey, remotePlatform]);
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

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
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
`;

customElements.define("tv-card", TvCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "tv-card",
  name: "TV (level 2)",
  description: "Power, volume, source and a d-pad - live where the set reports back, 'sent' where it cannot.",
});
