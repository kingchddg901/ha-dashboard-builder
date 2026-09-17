/**
 * Builder debug card — level 1, deliberately ugly.
 *
 * Shows what Home Assistant will tell us about each entity, before any of it is
 * turned into a control: friendly name AND entity id, the hints (domain,
 * platform, entity_category, how the area resolved, the device and its siblings),
 * the decoded capabilities, and the raw attribute dump underneath.
 *
 * This is a window onto ./capability-core.js, which holds the rules and has the
 * tests. This file is the disposable half.
 *
 * type: custom:builder-debug-card
 * domains: [light]          # default [light]
 * area: bedroom             # optional, filters by resolved area
 * entities: [light.x]       # optional, overrides `domains`
 * raw: true                 # attribute dump, default true
 */

import { selectEntities, deviceSiblings } from "./capability-core.js";

const esc = (v) => String(v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const dash = (v) => (v === null || v === undefined || v === "" ? "—" : esc(v));

class BuilderDebugCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = null;
  }

  setConfig(config) {
    this._config = {
      domains: ["light"],
      area: null,
      entities: null,
      raw: true,
      title: "Builder debug — level 1",
      ...config,
    };
    this._sig = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() { return 12; }

  static getStubConfig() { return { domains: ["light"] }; }

  _records() {
    const hass = this._hass;
    return selectEntities({
      states: hass.states || {},
      entities: hass.entities || {},
      devices: hass.devices || {},
      areas: hass.areas || {},
      domains: this._config.domains,
      area: this._config.area,
      include: this._config.entities,
    });
  }

  _render() {
    if (!this._hass || !this._config) return;
    const records = this._records();
    const sig = JSON.stringify(records);
    if (sig === this._sig) return;          // states churn; the debug view does not
    this._sig = sig;

    const hass = this._hass;
    const missing = ["entities", "devices", "areas"].filter((k) => !hass[k]);
    const counted = records.length;
    const placed = records.filter((r) => r.area.via).length;

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="hd">
          <div class="t">${esc(this._config.title)}</div>
          <div class="sub">
            ${counted} ${counted === 1 ? "entity" : "entities"}
            · ${esc((this._config.entities ? ["explicit"] : this._config.domains).join(", "))}
            ${this._config.area ? `· area ${esc(this._config.area)}` : ""}
            · area resolves for ${placed}/${counted}
          </div>
          ${missing.length ? `<div class="warn">hass.${missing.join(" / hass.")} not exposed by this
            frontend — registry hints unavailable, states only</div>` : ""}
        </div>
        ${counted ? records.map((r) => this._row(r)).join("") : `<div class="empty">nothing matched</div>`}
      </ha-card>`;
  }

  _row(r) {
    const sib = r.device ? deviceSiblings(r.device.id, this._hass.entities || {}) : null;
    const feat = r.features.none
      ? `<b class="zero">0 — no capability bits at all</b>`
      : [...r.features.names.map((n) => `<b>${esc(n)}</b>`), ...r.features.unknown.map((u) => `<b class="unk">${esc(u)}</b>`)].join(" ")
        + ` <span class="dim">(${r.features.bits}${r.features.tabulated ? "" : ", domain not tabulated"})</span>`;

    const caps = Object.entries(r.capabilities);
    const dc = r.device_class;

    return `
      <div class="row">
        <div class="name">
          <span class="fn">${dash(r.friendly_name)}</span>
          <code class="eid">${esc(r.entity_id)}</code>
          <span class="st ${r.available === false ? "bad" : ""}">${dash(r.state)}</span>
        </div>

        <div class="grid">
          <span class="k">domain / platform</span>
          <span class="v">${dash(r.domain)} / ${dash(r.platform)}${r.in_registry ? "" : ` <span class="unk">not in registry</span>`}</span>

          <span class="k">entity_category</span>
          <span class="v">${r.entity_category ? `${esc(r.entity_category)} <span class="dim">(plumbing)</span>` : `<span class="ok">primary</span>`}${r.hidden ? ` <span class="unk">hidden</span>` : ""}</span>

          <span class="k">area</span>
          <span class="v">${r.area.id
        ? `${dash(r.area.name)} <code>${esc(r.area.id)}</code> <span class="dim">via ${esc(r.area.via)}</span>`
        : `<span class="unk">none — invisible to area discovery</span>`}</span>

          <span class="k">device</span>
          <span class="v">${r.device
        ? `${dash(r.device.name)} <span class="dim">${dash(r.device.manufacturer)} / ${dash(r.device.model)}</span>`
        + (sib ? `<br><span class="dim">${sib.total} entities on it, ${sib.primaryCount} primary: ${sib.primary.map((e) => `<code>${esc(e)}</code>`).join(" ")}</span>` : "")
        : `<span class="unk">none — group by device and this entity disappears</span>`}</span>

          ${r.group.members.length || r.group.memberOf.length ? `<span class="k">grouped control</span>
          <span class="v">${r.group.members.length
        ? `drives ${r.group.members.length}: ${r.group.members.map((e) => `<code>${esc(e)}</code>`).join(" ")}` : ""}
            ${r.group.members.length && r.group.memberOf.length ? "<br>" : ""}
            ${r.group.memberOf.length
        ? `inside ${r.group.memberOf.map((e) => `<code>${esc(e)}</code>`).join(" ")}` : ""}
            <br><span class="dim">a group and its members both answer an area query - which one is
            the control is yours to set, not HA's</span></span>` : ""}

          <span class="k">supported_features</span>
          <span class="v">${feat}</span>

          ${dc ? `<span class="k">device_class</span>
          <span class="v"><code>${esc(dc.value)}</code> ${dc.known === true ? `<span class="ok">known</span>`
        : dc.known === false ? `<span class="unk">not in this domain's set — custom</span>`
          : `<span class="dim">set not checked</span>`}</span>` : ""}

          ${caps.length ? `<span class="k">capabilities</span>
          <span class="v">${caps.map(([k, v]) => `<span class="cap"><i>${esc(k)}</i> ${esc(JSON.stringify(v))}</span>`).join("")}</span>` : ""}
        </div>

        ${this._config.raw ? `<details><summary>raw attributes (${Object.keys(r.raw).length})</summary><pre>${esc(JSON.stringify(r.raw, null, 1))}</pre></details>` : ""}
      </div>`;
  }
}

const STYLE = `
  /* A card lives in a dashboard COLUMN, which is narrower than the viewport, so the
     breakpoint below asks the card how wide IT is - a viewport media query would keep
     two columns in a 300px sidebar on a wide screen. */
  ha-card { padding: 8px 10px 10px; container-type: inline-size; }
  .hd { padding: 4px 2px 8px; border-bottom: 1px solid var(--divider-color, #444); }
  .t { font-size: 15px; font-weight: 600; }
  .sub { font-size: 11.5px; color: var(--secondary-text-color); margin-top: 2px; }
  .warn { margin-top: 6px; font-size: 11.5px; color: var(--error-color, #d33);
          border: 1px solid var(--error-color, #d33); border-radius: 3px; padding: 4px 6px; }
  .empty { padding: 14px 4px; color: var(--secondary-text-color); font-size: 12.5px; }
  .row { padding: 9px 2px; border-bottom: 1px solid var(--divider-color, #333); }
  .name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
  .fn { font-size: 13.5px; font-weight: 600; }
  .eid, code { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 11.5px;
               background: var(--secondary-background-color, #0003); padding: 0 3px; border-radius: 2px; }
  .st { margin-left: auto; font-size: 11.5px; color: var(--secondary-text-color); }
  .st.bad { color: var(--error-color, #d33); }
  .grid { display: grid; grid-template-columns: 124px 1fr; gap: 2px 8px; margin-top: 6px; font-size: 11.5px; }
  .k { color: var(--secondary-text-color); text-align: right; }
  .v { min-width: 0; overflow-wrap: anywhere; }
  .v b { font-weight: 600; }
  .dim { color: var(--secondary-text-color); opacity: .8; }
  .ok { color: var(--success-color, #2a2); }
  .unk { color: var(--warning-color, #c80); }
  .zero { color: var(--error-color, #d33); }
  .cap { display: inline-block; margin: 0 8px 2px 0; }
  .cap i { color: var(--secondary-text-color); font-style: normal; }
  details { margin-top: 6px; font-size: 11.5px; }
  summary { cursor: pointer; color: var(--secondary-text-color); }
  pre { margin: 4px 0 0; padding: 6px; max-height: 260px; overflow: auto; font-size: 11px;
        background: var(--secondary-background-color, #0002); border-radius: 3px; }
  @container (max-width: 460px) {
    .grid { grid-template-columns: 1fr; gap: 0; }
    .k { text-align: left; margin-top: 4px; }
  }
`;

customElements.define("builder-debug-card", BuilderDebugCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "builder-debug-card",
  name: "Builder debug (level 1)",
  description: "What HA says an entity is: names, ids, hints, capabilities, raw attributes.",
});
