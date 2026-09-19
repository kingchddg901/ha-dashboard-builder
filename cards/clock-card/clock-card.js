/**
 * Clock card - the house's time, in Home Assistant's time zone.
 *
 * The zone and the 12/24-hour choice come from Home Assistant (the configured
 * time zone, and the profile's time format); the tick comes from the device.
 * It turns over on the whole minute - or second, with `seconds: true` - rather
 * than on an interval counted from whenever the page loaded.
 *
 * type: custom:clock-card
 * seconds: false     # optional
 * title: ...         # optional, shown small above the time
 */

import { hour12For, clockParts, msToNextTick } from "./clock-core.js";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

class ClockCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._last = null;
  }

  setConfig(config) { this._config = { seconds: false, ...(config || {}) }; this._last = null; this._paint(); }
  set hass(hass) { this._hass = hass; this._paint(); }
  getCardSize() { return 2; }
  static getStubConfig() { return {}; }

  connectedCallback() { this._schedule(); }
  disconnectedCallback() { clearTimeout(this._t); this._t = null; }

  _schedule() {
    clearTimeout(this._t);
    if (!this.isConnected) return;
    this._t = setTimeout(() => { this._paint(); this._schedule(); },
      msToNextTick(Date.now(), { seconds: this._config?.seconds }) + 20);
  }

  _paint() {
    if (!this._config) return;
    const tz = this._hass?.config?.time_zone;
    const p = clockParts(Date.now(), {
      timeZone: tz || undefined,
      hour12: hour12For(this._hass?.locale?.time_format),
      language: this._hass?.locale?.language || this._hass?.language || undefined,
    });
    const key = JSON.stringify([p, this._config.seconds, this._config.title, tz]);
    if (key === this._last) return;
    this._last = key;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <ha-card><div class="face" role="timer" aria-live="off" aria-label="${esc(`${p.time} ${p.ampm} ${p.date}`)}">
        ${this._config.title ? `<div class="title">${esc(this._config.title)}</div>` : ""}
        <div class="time">${esc(p.time)}${this._config.seconds ? `<span class="sec">:${esc(p.seconds)}</span>` : ""}${p.ampm
          ? `<span class="ampm">${esc(p.ampm)}</span>` : ""}</div>
        <div class="date">${esc(p.date)}</div>
        <div class="zone">${esc(p.zone)}${tz ? "" : " · device zone (Home Assistant's is not known yet)"}</div>
      </div></ha-card>`;
  }
}

const STYLE = `
  :host { display: block; container-type: inline-size; height: 100%; }
  ha-card { height: 100%; display: flex; align-items: center; justify-content: center; }
  .face { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 12px; text-align: center; }
  .title { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--secondary-text-color); }
  .time { font-size: clamp(34px, 24cqw, 120px); line-height: 1; letter-spacing: .02em;
          font-variant-numeric: tabular-nums; color: var(--lcars-ui-accent-color, var(--accent-color, #ff7700)); }
  .sec { font-size: .42em; opacity: .8; }
  .ampm { font-size: .3em; margin-left: .25em; letter-spacing: .08em; color: var(--primary-text-color); }
  .date { font-size: clamp(13px, 4.5cqw, 22px); color: var(--primary-text-color); letter-spacing: .03em; }
  .zone { font-size: 11px; color: var(--secondary-text-color); letter-spacing: .08em; }
`;

// Guarded: the panel and a Lovelace resource can both load this module.
if (!customElements.get("clock-card")) customElements.define("clock-card", ClockCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "clock-card",
  name: "Clock",
  description: "The house's time, in Home Assistant's time zone and 12/24-hour setting.",
});
