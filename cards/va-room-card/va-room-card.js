/**
 * VA room tile - start a Vacuum Agent room with its saved settings. Editing
 * those settings opens VA's OWN room card, because the rules behind them are
 * VA's (see ./va-room-core.js for the stop line).
 *
 * Two shapes over the same controls:
 *
 *   one ROBOT, its rooms              one ROOM, the robots that clean it
 *   type: custom:va-room-card         type: custom:va-room-card
 *   vacuum: vacuum.alfred             room: Office
 *                                     names:                 # only where a map differs
 *                                       vacuum.alfred: Home Office
 *
 * Tap a row to select it: the room's saved settings on that robot show in VA's
 * own words, with when it was last cleaned, Start and Edit settings. Start runs
 * the same sequence as VA's room card. Robots are named by their VA panel.
 */

import {
  roomsFor, savedSettings, startCalls, robotName, roomAcrossRobots, lastCleanedAcross,
} from "./va-room-core.js";
import { robotGlance, relativeTime, sentence } from "../readings-card/readings-core.js";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const keyOf = (e) => `${e.vacuum}|${e.room?.entity_id ?? ""}`;

class VaRoomCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selected = null;      // entry key
    this._busy = null;          // entry being started
    this._sent = null;          // entry whose start was sent, until its robot reports back
    this._note = "";
    this._sig = null;
    this._onKey = (e) => { if (e.key === "Escape") this._closeEditor(); };
  }

  setConfig(config) {
    const byRobot = String(config?.vacuum || "").startsWith("vacuum.");
    if (!byRobot && !config?.room) throw new Error("va-room-card: give a `vacuum` (its rooms) or a `room` (its robots)");
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

  _byRoom() { return !this._config.vacuum && Boolean(this._config.room); }

  /** The rows: {vacuum, room} pairs - one robot's rooms, or one room across robots. */
  _entries() {
    const states = this._hass.states;
    if (this._byRoom()) return roomAcrossRobots(states, this._config.room, this._config.names);
    const rooms = roomsFor(states, this._config.vacuum).map((room) => ({ vacuum: this._config.vacuum, room }));
    if (this._config.room_id == null) return rooms;
    return rooms.filter((e) => String(e.room.room_id) === String(this._config.room_id));
  }

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

  _glance(vacuum) { return robotGlance(this._hass.states, vacuum.split(".")[1]); }
  _status(g) { return !g.available ? "Unavailable" : g.error ? `Error: ${g.error}` : sentence(g.state); }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._built) this._build();
    const entries = this._entries();
    const byRoom = this._byRoom();
    const single = !byRoom && entries.length === 1 && this._config.room_id != null;
    if (single) this._selected = keyOf(entries[0]);
    for (const e of entries) {                            // a sent start clears once its robot reports back
      if (this._sent === keyOf(e) && this._glance(e.vacuum).running) this._sent = null;
    }
    const panels = this._hass.panels;
    let title; let right;
    if (byRoom) {
      title = this._config.title || this._config.room;
      const last = lastCleanedAcross(entries);
      right = last ? `Cleaned ${relativeTime(new Date(last.at))} by ${robotName(panels, last.vacuum, this._hass.states)}` : "Not cleaned yet";
    } else {
      const name = this._config.title || robotName(panels, this._config.vacuum, this._hass.states);
      title = single ? `${name} · ${entries[0].room.name}` : name;
      right = this._status(this._glance(this._config.vacuum));
    }
    const sig = JSON.stringify([title, right, entries.map((e) => [keyOf(e), e.room?.selected, e.room?.lastCleaned,
      e.room ? savedSettings(e.room.attrs) : null, this._status(this._glance(e.vacuum))]),
      this._selected, this._busy, this._sent, this._note]);
    if (sig === this._sig) return;
    this._sig = sig;

    const g = !byRoom ? this._glance(this._config.vacuum) : null;
    const stCls = !g ? "" : !g.available ? "unavailable" : g.error ? "error" : g.running ? "on" : "off";
    // By room the second line is long ("cleaned 6 d ago by Robin Dreame"), so it
    // sits under the title instead of squeezing beside it in a narrow tile.
    this.shadowRoot.querySelector(".content").innerHTML = `
      <div class="hd ${byRoom ? "stack" : ""}"><span class="t">${esc(title)}</span>
        <span class="st st-${stCls}">${esc(right)}</span></div>
      ${this._note ? `<div class="note">${esc(this._note)}</div>` : ""}
      ${entries.length ? `<div class="rows">${entries.map((e) => this._entryHtml(e, byRoom, single)).join("")}</div>`
        : `<div class="msg">${byRoom ? "No robot has rooms from Vacuum Agent." : "No rooms from Vacuum Agent for this robot."}</div>`}`;
  }

  _entryHtml(e, byRoom, single) {
    const g = this._glance(e.vacuum);
    const robot = robotName(this._hass.panels, e.vacuum, this._hass.states);
    if (!e.room) {
      // This robot's map has no room by that name: say so, and how to fix it.
      return `<div class="row off"><span class="nm">${esc(robot)}</span>
        <span class="lc">no "${esc(e.asked)}" on its map</span></div>`;
    }
    const key = keyOf(e);
    const open = this._selected === key;
    const when = e.room.lastCleaned ? `Cleaned ${relativeTime(new Date(e.room.lastCleaned))}` : "Not cleaned yet";
    const label = byRoom ? robot : e.room.name;
    const aside = byRoom ? this._status(g) : when;
    const renamed = byRoom && e.room.name !== this._config.room ? ` <span class="alias">"${esc(e.room.name)}"</span>` : "";
    const head = single ? "" : `<button type="button" class="row ${open ? "sel" : ""}" data-act="select"
        data-key="${esc(key)}" aria-expanded="${open}">
        <span class="nm">${esc(label)}${renamed}${e.room.selected ? ` <span class="badge">Selected</span>` : ""}</span>
        <span class="lc">${esc(aside)}</span></button>`;
    if (!open) return head;
    const settings = savedSettings(e.room.attrs);
    const busy = this._busy === key;
    const canStart = g.available && e.room.map_id && !busy;
    const verb = byRoom ? `Send ${robot}` : `Start ${e.room.name}`;
    return `${head}<div class="detail">
      ${byRoom || single ? `<div class="lc">${esc(when)}</div>` : ""}
      <div class="chips" aria-label="Saved settings">${settings.length
        ? settings.map((s) => `<span class="chip">${esc(s)}</span>`).join("")
        : `<span class="hint">No saved settings for this room.</span>`}</div>
      <div class="acts">
        <button type="button" class="tb start" data-act="start" data-key="${esc(key)}" ${canStart ? "" : "disabled"}>
          ${busy ? "Starting…" : esc(verb)}</button>
        <button type="button" class="tb" data-act="edit" data-key="${esc(key)}">Edit settings</button>
      </div>
      ${this._sent === key ? `<div class="hint">Sent. ${esc(robot)}'s state changes when it picks it up.</div>`
        : g.running ? `<div class="hint">${esc(robot)} is busy - this redirects it.</div>` : ""}
    </div>`;
  }

  _entry(key) { return this._entries().find((e) => keyOf(e) === key) || null; }

  async _onClick(ev) {
    const b = ev.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const key = b.dataset.key;
    if (b.dataset.act === "select") {
      this._selected = this._selected === key ? null : key;
      this._note = "";
      this._render();
    } else if (b.dataset.act === "start") {
      await this._start(key);
    } else if (b.dataset.act === "edit") {
      this._openEditor(key);
    }
  }

  async _start(key) {
    const e = this._entry(key);
    if (!e?.room) return;
    const calls = startCalls(roomsFor(this._hass.states, e.vacuum), e.room, e.vacuum);
    if (!calls.length) return;
    this._busy = key; this._note = ""; this._render();
    try {
      for (const c of calls) await this._hass.callService(c.domain, c.service, c.data);
      this._sent = key;
    } catch (err) {
      this._note = `Not started: ${err?.message || err}`;
    } finally {
      this._busy = null;
      this._sig = null; this._render();
    }
  }

  /* Editing belongs to Vacuum Agent: open its own room card over the tile. */
  _openEditor(key) {
    const e = this._entry(key);
    if (!e?.room) return;
    if (!customElements.get("eufy-room-card")) {
      this._note = "Vacuum Agent's room card is not loaded on this page.";
      this._sig = null; this._render();
      return;
    }
    const el = document.createElement("eufy-room-card");
    el.setConfig({ type: "custom:eufy-room-card", vacuum_entity_id: e.vacuum, room_id: e.room.room_id });
    el.hass = this._hass;
    this._editor = el;
    const modal = this.shadowRoot.querySelector(".modal");
    modal.querySelector(".mt").textContent =
      `${e.room.name} on ${robotName(this._hass.panels, e.vacuum, this._hass.states)} - Vacuum Agent`;
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
  .st { margin-left: auto; font-size: 11px; letter-spacing: .04em; color: var(--secondary-text-color); text-align: right; }
  .hd.stack { flex-direction: column; align-items: flex-start; gap: 2px; }
  .hd.stack .st { margin-left: 0; text-align: left; }
  .st-on { color: var(--success-color, #66bb6a); }
  .st-error { color: var(--error-color, #ff5252); }
  .st-unavailable { text-decoration: line-through; }
  .note { margin: 0 14px 8px; font-size: 12px; color: var(--warning-color, #f5a623); }
  .msg, .hint { font-size: 12px; color: var(--secondary-text-color); }
  .msg { padding: 8px 14px; }
  .rows { display: flex; flex-direction: column; }
  .row { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: none; font: inherit;
         color: var(--primary-text-color); text-align: left; padding: 9px 14px; }
  button.row { cursor: pointer; }
  button.row:hover { background: var(--secondary-background-color, #1c2126); }
  .row.off { opacity: .55; }
  .row.sel { background: var(--secondary-background-color, #1c2126); box-shadow: inset 3px 0 0 var(--accent-color, #ff9900); }
  .row:focus-visible, .tb:focus-visible, .close:focus-visible { outline: 2px solid var(--accent-color, #ff9900); outline-offset: 1px; }
  .nm { flex: 1; min-width: 0; font-size: 14px; overflow-wrap: anywhere; }
  .alias { font-size: 11.5px; color: var(--secondary-text-color); }
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
  description: "A robot's rooms, or a room's robots: start with the saved settings; edit them in VA's own card.",
});
