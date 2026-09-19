/**
 * VA room tile - one robot's rooms: pick a room, start it with its saved
 * settings. Editing those settings opens Vacuum Agent's OWN room card, because
 * the rules behind them are VA's (see ./va-room-core.js for the stop line).
 *
 * Tap a room to select it: its saved settings show in VA's own words, with when
 * it was last cleaned, a Start button and Edit settings. Start runs the same
 * sequence as VA's room card. The robot's name is the title of its VA panel.
 *
 * type: custom:va-room-card
 * vacuum: vacuum.alfred
 * room_id: 2          # optional - just this room, already open
 * title: ...          # optional - default: the robot's VA panel title
 */

import { roomsFor, savedSettings, startCalls, robotName } from "./va-room-core.js";
import { robotGlance, relativeTime } from "../readings-card/readings-core.js";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

class VaRoomCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selected = null;
    this._busy = null;          // room being started
    this._sent = null;          // room whose start was sent, until the robot reports back
    this._note = "";
    this._sig = null;
    this._onKey = (e) => { if (e.key === "Escape") this._closeEditor(); };
  }

  setConfig(config) {
    if (!config?.vacuum || !String(config.vacuum).startsWith("vacuum.")) {
      throw new Error("va-room-card: `vacuum` must be a vacuum entity");
    }
    this._config = { ...config };
    this._sig = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._editor) this._editor.hass = hass;
    this._render();
  }

  getCardSize() { return 5; }
  static getStubConfig() { return { vacuum: "" }; }

  connectedCallback() { document.addEventListener("keydown", this._onKey); }
  disconnectedCallback() { document.removeEventListener("keydown", this._onKey); }

  _build() {
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <ha-card><div class="content"></div></ha-card>
      <div class="modal" hidden role="dialog" aria-modal="true">
        <div class="sheet">
          <div class="bar"><span class="mt"></span><button type="button" class="close">Close</button></div>
          <div class="body"></div>
        </div>
      </div>`;
    const r = this.shadowRoot;
    r.querySelector(".content").addEventListener("click", (e) => this._onClick(e));
    r.querySelector(".close").addEventListener("click", () => this._closeEditor());
    r.querySelector(".modal").addEventListener("click", (e) => { if (e.target.classList.contains("modal")) this._closeEditor(); });
    this._built = true;
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._built) this._build();
    const vacuum = this._config.vacuum;
    const states = this._hass.states;
    const glance = robotGlance(states, vacuum.split(".")[1]);
    if (this._sent && glance.running) this._sent = null;     // the robot has reported back
    let rooms = roomsFor(states, vacuum);
    const only = this._config.room_id != null ? rooms.find((r) => String(r.room_id) === String(this._config.room_id)) : null;
    if (only) { rooms = [only]; this._selected = only.entity_id; }
    const name = this._config.title || robotName(this._hass.panels, vacuum, states);
    const status = !glance.available ? "unavailable" : glance.error ? `error: ${glance.error}` : String(glance.state).replace(/_/g, " ");
    const sig = JSON.stringify([name, status, rooms.map((r) => [r.entity_id, r.selected, r.lastCleaned, savedSettings(r.attrs)]),
      this._selected, this._busy, this._sent, this._note]);
    if (sig === this._sig) return;
    this._sig = sig;

    const stCls = !glance.available ? "unavailable" : glance.error ? "error" : glance.running ? "on" : "off";
    this.shadowRoot.querySelector(".content").innerHTML = `
      <div class="hd"><span class="t">${esc(only ? `${name} · ${only.name}` : name)}</span>
        <span class="st st-${stCls}">${esc(status)}</span></div>
      ${this._note ? `<div class="note">${esc(this._note)}</div>` : ""}
      ${rooms.length ? `<div class="rows">${rooms.map((r) => this._roomHtml(r, glance, !!only)).join("")}</div>`
        : `<div class="msg">No rooms from Vacuum Agent for this robot.</div>`}`;
  }

  _roomHtml(room, glance, only) {
    const open = this._selected === room.entity_id;
    const when = room.lastCleaned ? `cleaned ${relativeTime(new Date(room.lastCleaned))}` : "not cleaned yet";
    const head = only ? "" : `<button type="button" class="row ${open ? "sel" : ""}" data-act="select"
        data-id="${esc(room.entity_id)}" aria-expanded="${open}">
        <span class="nm">${esc(room.name)}${room.selected ? ` <span class="badge">selected</span>` : ""}</span>
        <span class="lc">${esc(when)}</span></button>`;
    if (!open) return head;
    const settings = savedSettings(room.attrs);
    const busy = this._busy === room.entity_id;
    const sent = this._sent === room.entity_id;
    const canStart = glance.available && room.map_id && !busy;
    return `${head}<div class="detail">
      ${only ? `<div class="lc">${esc(when)}</div>` : ""}
      <div class="chips" aria-label="Saved settings">${settings.length
        ? settings.map((s) => `<span class="chip">${esc(s)}</span>`).join("")
        : `<span class="hint">No saved settings for this room.</span>`}</div>
      <div class="acts">
        <button type="button" class="tb start" data-act="start" data-id="${esc(room.entity_id)}" ${canStart ? "" : "disabled"}>
          ${busy ? "Starting…" : `Start ${esc(room.name)}`}</button>
        <button type="button" class="tb" data-act="edit" data-id="${esc(room.entity_id)}">Edit settings</button>
      </div>
      ${sent ? `<div class="hint">Sent. The robot's state above changes when it picks it up.</div>`
        : glance.running ? `<div class="hint">The robot is busy - starting this room redirects it.</div>` : ""}
    </div>`;
  }

  _room(id) { return roomsFor(this._hass.states, this._config.vacuum).find((r) => r.entity_id === id) || null; }

  async _onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    if (b.dataset.act === "select") {
      this._selected = this._selected === id ? null : id;
      this._note = "";
      this._render();
    } else if (b.dataset.act === "start") {
      await this._start(id);
    } else if (b.dataset.act === "edit") {
      this._openEditor(id);
    }
  }

  async _start(id) {
    const rooms = roomsFor(this._hass.states, this._config.vacuum);
    const room = rooms.find((r) => r.entity_id === id);
    const calls = startCalls(rooms, room, this._config.vacuum);
    if (!calls.length) return;
    this._busy = id; this._note = ""; this._render();
    try {
      for (const c of calls) await this._hass.callService(c.domain, c.service, c.data);
      this._sent = id;
    } catch (err) {
      this._note = `Not started: ${err?.message || err}`;
    } finally {
      this._busy = null;
      this._sig = null; this._render();
    }
  }

  /* Editing belongs to Vacuum Agent: open its own room card over the tile. */
  _openEditor(id) {
    const room = this._room(id);
    if (!room) return;
    if (!customElements.get("eufy-room-card")) {
      this._note = "Vacuum Agent's room card is not loaded on this page.";
      this._sig = null; this._render();
      return;
    }
    const el = document.createElement("eufy-room-card");
    el.setConfig({ type: "custom:eufy-room-card", vacuum_entity_id: this._config.vacuum, room_id: room.room_id });
    el.hass = this._hass;
    this._editor = el;
    const modal = this.shadowRoot.querySelector(".modal");
    modal.querySelector(".mt").textContent = `${room.name} - Vacuum Agent`;
    modal.querySelector(".body").replaceChildren(el);
    modal.hidden = false;
    modal.querySelector(".close").focus({ preventScroll: true });
  }

  _closeEditor() {
    const modal = this.shadowRoot.querySelector(".modal");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.querySelector(".body").replaceChildren();
    this._editor = null;
  }
}

const STYLE = `
  :host { display: block; }
  * { box-sizing: border-box; }
  ha-card { padding: 10px 0 8px; display: block; }
  .hd { display: flex; align-items: baseline; gap: 8px; padding: 0 14px 8px; }
  .t { font-size: 14px; font-weight: 600; }
  .st { margin-left: auto; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--secondary-text-color); }
  .st-on { color: var(--success-color, #66bb6a); }
  .st-error { color: var(--error-color, #ff5252); }
  .st-unavailable { text-decoration: line-through; }
  .note { margin: 0 14px 8px; font-size: 12px; color: var(--warning-color, #f5a623); }
  .msg, .hint { font-size: 12px; color: var(--secondary-text-color); }
  .msg { padding: 8px 14px; }
  .rows { display: flex; flex-direction: column; }
  .row { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: none; font: inherit;
         color: var(--primary-text-color); text-align: left; padding: 9px 14px; cursor: pointer; }
  .row:hover { background: var(--secondary-background-color, #1c2126); }
  .row.sel { background: var(--secondary-background-color, #1c2126); box-shadow: inset 3px 0 0 var(--accent-color, #ff9900); }
  .row:focus-visible, .tb:focus-visible, .close:focus-visible { outline: 2px solid var(--accent-color, #ff9900); outline-offset: 1px; }
  .nm { flex: 1; min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lc { font-size: 11.5px; color: var(--secondary-text-color); }
  .badge { font-size: 10.5px; color: var(--accent-color, #ff9900); border: 1px solid currentColor; border-radius: 6px;
           padding: 0 4px; margin-left: 4px; }
  .detail { display: flex; flex-direction: column; gap: 10px; padding: 8px 14px 12px;
            background: var(--secondary-background-color, #1c2126); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 12px; padding: 3px 9px; border-radius: 8px; border: 1px solid var(--divider-color, #555); }
  .acts { display: flex; gap: 8px; }
  .tb { font: inherit; cursor: pointer; border-radius: 8px; color: var(--primary-text-color); padding: 8px 12px;
        font-size: 13px; border: 1px solid var(--divider-color, #555); background: var(--card-background-color, #111); }
  .tb.start { flex: 1; font-weight: 600; border-color: var(--accent-color, #ff9900); }
  .tb:disabled { opacity: .45; cursor: default; }
  .modal { position: fixed; inset: 0; z-index: 20; background: color-mix(in srgb, #000 60%, transparent);
           display: flex; align-items: flex-end; justify-content: center; }
  .modal[hidden] { display: none; }
  .sheet { width: min(640px, 100%); max-height: 90dvh; display: flex; flex-direction: column;
           background: var(--card-background-color, #111); border-radius: 16px 16px 0 0; overflow: hidden; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 8px 16px;
         border-bottom: 1px solid var(--divider-color, #444); font-size: 13px; }
  .close { font: inherit; cursor: pointer; border-radius: 12px; padding: 6px 14px; border: 1px solid var(--divider-color, #555);
           background: none; color: var(--primary-text-color); }
  .body { overflow: auto; padding-bottom: env(safe-area-inset-bottom, 0px); }
`;

// Guarded: the panel and a Lovelace resource can both load this module.
if (!customElements.get("va-room-card")) customElements.define("va-room-card", VaRoomCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "va-room-card",
  name: "VA rooms",
  description: "Pick a Vacuum Agent room and start it with its saved settings; edit them in VA's own card.",
});
