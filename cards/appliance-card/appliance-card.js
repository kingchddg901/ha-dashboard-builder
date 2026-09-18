/**
 * Appliance card — level 2, first pass. Ugly on purpose, real underneath.
 *
 * One appliance, its controls built from what level 1 found rather than from a
 * hand-written list: a notched fan speed because `percentage_step` says six, a
 * brightness bar only where a level exists, a kelvin strip over the MEASURED
 * range of whatever entity is actually driven.
 *
 * Layout follows the CARD's width, not the screen's. A vertical notch column is
 * right where there is height and no width, and useless the other way round, so
 * the axis flips at the wide breakpoint. Container queries, never a media query:
 * a card in a 300px column on a 4K screen is compact.
 *
 * The rules live in ./control-core.js and have the tests. This file draws them.
 *
 * type: custom:appliance-card
 * title: Ceiling fan
 * fan: fan.ceiling_fan
 * light: light.ceiling_fan_calibrated      # the corrected one, not the raw one
 * last_level: sensor.light_last_level      # optional, for off-state restore
 * notches: 6                               # optional, overrides percentage_step
 */

import { describeEntity } from "../builder-debug-card/capability-core.js";
import { speedControl, levelControl, kelvinControl, layoutFor, axisFor } from "./control-core.js";

const esc = (v) => String(v).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

class ApplianceCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = null;
    this._width = null;
  }

  setConfig(config) {
    if (!config.fan && !config.light) {
      throw new Error("appliance-card: needs a `fan`, a `light`, or both");
    }
    this._config = { title: "Appliance", last_level: "sensor.light_last_level", ...config };
    this._sig = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  connectedCallback() {
    // The card measures itself so the JS-side layout matches the CSS breakpoints.
    if (!this._ro && typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w && w !== this._width) { this._width = w; this._sig = null; this._render(); }
      });
      this._ro.observe(this);
    }
  }

  disconnectedCallback() { if (this._ro) { this._ro.disconnect(); this._ro = null; } }

  getCardSize() { return 6; }

  static getStubConfig() { return { fan: "", light: "" }; }

  _record(id) {
    if (!id || !this._hass?.states?.[id]) return null;
    return describeEntity({
      entityId: id,
      entry: this._hass.entities?.[id] || null,
      state: this._hass.states[id],
      devices: this._hass.devices || {},
      areas: this._hass.areas || {},
    });
  }

  _remembered(id) {
    const levels = this._hass?.states?.[this._config.last_level]?.attributes?.levels;
    return levels?.[id] || null;
  }

  _call(domain, service, data) {
    this._hass.callService(domain, service, data);
  }

  _render() {
    if (!this._hass || !this._config) return;
    const fan = this._record(this._config.fan);
    const light = this._record(this._config.light);
    const layout = layoutFor(this._width);
    const axis = axisFor(layout);
    const speed = fan ? speedControl(fan, { declaredNotches: this._config.notches }) : null;
    const level = light ? levelControl(light, { remembered: this._remembered(this._config.light) }) : null;
    const kelvin = light ? kelvinControl(light) : null;

    const sig = JSON.stringify([layout, fan?.state, light?.state, speed, level, kelvin]);
    if (sig === this._sig) return;
    this._sig = sig;

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card class="${esc(layout)} ${esc(axis)}">
        <div class="hd">${esc(this._config.title)}<span class="lay">${esc(layout)} · ${esc(axis)}</span></div>
        ${fan ? this._fanBlock(fan, speed) : ""}
        ${light ? this._lightBlock(light, level, kelvin) : ""}
      </ha-card>`;
    this._wire(fan, speed, light, level, kelvin);
  }

  _fanBlock(fan, speed) {
    const on = fan.state === "on";
    const dir = fan.raw.direction;
    const notches = speed.kind === "notches"
      ? `<div class="track notch" role="group" aria-label="Fan speed">
           ${speed.values.map((v, i) => `
             <button class="seg ${on && speed.index >= i + 1 ? "lit" : ""}"
                     data-pct="${v}" aria-label="Speed ${i + 1}">${i + 1}</button>`
        ).join("")}
         </div>`
      : `<input class="track slider" type="range" min="0" max="100"
                step="${speed.step}" value="${speed.current ?? 0}" aria-label="Fan speed">`;
    return `
      <div class="block fan ${on ? "on" : "off"}">
        <div class="side">
          <button class="power fan-power" aria-label="Fan power">✱</button>
          <div class="txt">
            <div class="name">Fan ${on ? "on" : "off"}</div>
            <div class="sub">${speed.kind === "notches"
        ? `speed ${speed.index || "—"} of ${speed.count}${on ? "" : " · resumes here"}`
        : `${speed.current ?? "—"}%`}
              <span class="src">${esc(speed.source)}</span>
            </div>
            ${dir ? `<button class="dir">${dir === "reverse" ? "↑ pull warm air up" : "↓ push cool air down"}</button>` : ""}
          </div>
        </div>
        ${notches}
      </div>`;
  }

  _lightBlock(light, level, kelvin) {
    const on = light.state === "on";
    const shown = level.pct ?? level.restore ?? 0;
    const bar = level.supported
      ? `<div class="track bar" role="group" aria-label="Brightness">
           <div class="fill ${level.state}" style="--v:${shown}%"></div>
           <input class="range" type="range" min="1" max="100" value="${shown}" aria-label="Brightness">
         </div>`
      : `<div class="track none">on / off only</div>`;
    return `
      <div class="block light ${on ? "on" : "off"}">
        <div class="side">
          <button class="power light-power" aria-label="Light power">☀</button>
          <div class="txt">
            <div class="name">Light ${on ? "on" : "off"}</div>
            <div class="sub">${level.state === "lit" ? `${level.pct}%`
        : level.state === "off-restores" ? `off · returns to ${level.restore}%`
          : "off · level unknown"}</div>
            ${kelvin ? `<div class="kel">
              <span class="klabel">colour</span>
              <input class="ktemp" type="range" min="${kelvin.min}" max="${kelvin.max}"
                     step="10" value="${kelvin.current ?? kelvin.min}" aria-label="Colour temperature">
              <span class="sub">${kelvin.current ? Math.round(kelvin.current) : "—"} K
                <span class="src">${kelvin.min}–${kelvin.max} measured</span></span>
            </div>` : ""}
          </div>
        </div>
        ${bar}
      </div>`;
  }

  _wire(fan, speed, light, level, kelvin) {
    const r = this.shadowRoot;
    const fanId = this._config.fan;
    const lightId = this._config.light;

    r.querySelector(".fan-power")?.addEventListener("click", () =>
      this._call("fan", fan.state === "on" ? "turn_off" : "turn_on", { entity_id: fanId }));
    r.querySelector(".dir")?.addEventListener("click", () =>
      this._call("fan", "set_direction", {
        entity_id: fanId,
        direction: fan.raw.direction === "reverse" ? "forward" : "reverse",
      }));
    r.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () =>
      this._call("fan", "set_percentage", { entity_id: fanId, percentage: Number(b.dataset.pct) })));
    r.querySelector(".slider")?.addEventListener("change", (e) =>
      this._call("fan", "set_percentage", { entity_id: fanId, percentage: Number(e.target.value) }));

    r.querySelector(".light-power")?.addEventListener("click", () =>
      this._call("light", light.state === "on" ? "turn_off" : "turn_on", { entity_id: lightId }));
    r.querySelector(".range")?.addEventListener("change", (e) =>
      this._call("light", "turn_on", { entity_id: lightId, brightness_pct: Number(e.target.value) }));
    r.querySelector(".ktemp")?.addEventListener("change", (e) =>
      this._call("light", "turn_on", { entity_id: lightId, color_temp_kelvin: Number(e.target.value) }));
  }
}

const STYLE = `
  :host { display: block; }
  ha-card { padding: 10px 12px 12px; container-type: inline-size; display: block; }
  .hd { font-size: 14px; font-weight: 600; display: flex; align-items: baseline; gap: 8px;
        padding-bottom: 8px; border-bottom: 1px solid var(--divider-color, #444); }
  .lay { margin-left: auto; font-size: 10.5px; font-weight: 400; letter-spacing: .04em;
         text-transform: uppercase; color: var(--secondary-text-color); }

  .block { display: flex; gap: 12px; padding: 12px 0; align-items: stretch;
           border-bottom: 1px solid var(--divider-color, #333); }
  .block:last-child { border-bottom: 0; }
  .block.off { opacity: .62; }
  .side { flex: 1; min-width: 0; display: flex; gap: 10px; align-items: flex-start; }
  .txt { min-width: 0; }
  .name { font-size: 13.5px; font-weight: 600; }
  .sub { font-size: 11.5px; color: var(--secondary-text-color); margin-top: 1px;
         font-variant-numeric: tabular-nums; }
  .src { opacity: .6; font-size: 10.5px; }

  .power { flex: none; width: 42px; height: 42px; border-radius: 50%; cursor: pointer;
           font-size: 17px; line-height: 1; border: 1px solid var(--divider-color, #555);
           background: var(--secondary-background-color, #222); color: var(--primary-text-color); }
  .block.on .power { background: var(--primary-text-color, #eee); color: var(--card-background-color, #111);
                     border-color: transparent; }
  .dir { margin-top: 6px; font: inherit; font-size: 11px; cursor: pointer; padding: 3px 7px;
         border-radius: 4px; border: 1px solid var(--divider-color, #555);
         background: none; color: var(--secondary-text-color); }

  /* Vertical by default - height is the axis a phone has to spare. */
  .track { flex: none; width: 54px; display: flex; flex-direction: column-reverse; gap: 3px; }
  .seg { flex: 1; min-height: 26px; cursor: pointer; border-radius: 4px; font-size: 10px;
         border: 1px solid var(--divider-color, #555); background: var(--secondary-background-color, #1c2126);
         color: var(--secondary-text-color); }
  .seg.lit { background: var(--accent-color, #ff9900); border-color: transparent; color: #111; font-weight: 600; }
  .bar { position: relative; border-radius: 6px; overflow: hidden; min-height: 96px;
         border: 1px solid var(--divider-color, #555); background: var(--secondary-background-color, #1c2126); }
  .fill { position: absolute; left: 0; right: 0; bottom: 0; height: var(--v);
          background: var(--primary-text-color, #eee); }
  .fill.off-restores { background: repeating-linear-gradient(45deg,
                       var(--secondary-text-color, #888) 0 6px, transparent 6px 12px); }
  .fill.off-unknown { background: none; }
  .bar .range { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
  .none { display: grid; place-items: center; font-size: 10.5px; text-align: center;
          color: var(--secondary-text-color); border: 1px dashed var(--divider-color, #555);
          border-radius: 6px; padding: 4px; }
  .kel { margin-top: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .klabel { font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase;
            color: var(--secondary-text-color); }
  .ktemp { width: 100%; max-width: 220px; accent-color: var(--accent-color, #ff9900); }

  /* Wide: the card has width and no height to spare, so the axis turns over. */
  @container (min-width: 620px) {
    .block { align-items: center; }
    .track { width: auto; flex: 1 1 auto; flex-direction: row; min-height: 0; }
    .seg { min-height: 34px; }
    .bar { min-height: 34px; }
    .fill { top: 0; right: auto; width: var(--v); height: auto; }
    .side { flex: 0 0 46%; }
  }
`;

customElements.define("appliance-card", ApplianceCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "appliance-card",
  name: "Appliance (level 2)",
  description: "Controls built from measured capability: notched speeds, real kelvin, honest off-states.",
});
