/**
 * Light tree card - a group and its parts, as one nested control.
 *
 * Every row is a light: tap it to switch it, drag across it to set its
 * brightness (design rule 9 - a row with a useful shallow action does it).
 * A group's row acts on everything beneath it; › opens it to show the parts.
 * A part that can only switch shows a bare on/off, beside dimmable siblings,
 * so the parent's over-claim explains itself where it applies.
 *
 * The rules live in ./light-tree-core.js with the tests; this is the
 * disposable half.
 *
 * type: custom:light-tree-card
 * entity: light.main_house
 * title: Whole house           # optional
 * open: [light.main_house]     # optional: which groups start open (default: the top one)
 */

import {
  lightNode, promise, rowState, visibleRows, toggleCall, levelCall, levelAt, litCount, gestureResult,
} from "./light-tree-core.js";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DRAG_START_PX = 6;        // movement below this is a tap

class LightTreeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._open = null;
    this._drag = null;
    this._sig = null;
  }

  setConfig(config) {
    if (!config?.entity || !String(config.entity).startsWith("light.")) {
      throw new Error("light-tree-card: `entity` must be a light");
    }
    this._config = { ...config };
    this._open = new Set(Array.isArray(config.open) ? config.open : [config.entity]);
    this._sig = null;
    if (this._hass) this._render();
  }

  set hass(hass) { this._hass = hass; this._render(); }
  getCardSize() { return 4; }
  static getStubConfig() { return { entity: "" }; }

  _call({ domain, service, data }) { this._hass.callService(domain, service, data); }

  _render() {
    // Never repaint while a finger is down: replacing the row would drop the
    // pointer capture, and the release would be lost.
    if (!this._hass || !this._config || this._drag) return;
    const root = lightNode(this._config.entity, this._hass.states);
    const rows = visibleRows(root, this._open);
    const sig = JSON.stringify([rows.map((r) => [r.node.id, r.node.state, r.node.level, r.node.rgb, r.open, r.depth]),
      this._config.title]);
    if (sig === this._sig) return;
    this._sig = sig;

    const { lit, total } = litCount(root);
    const title = this._config.title || root.name;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="hd"><span class="t">${esc(title)}</span>
          ${root.members.length ? `<span class="sum">${lit} of ${total} lit</span>` : ""}</div>
        <div class="tree" role="tree">${rows.map((r) => this._rowHtml(r)).join("")}</div>
      </ha-card>`;
    this._wire();
  }

  _rowHtml({ node, depth, open }) {
    const st = rowState(node);
    const inert = st === "unavailable";
    const kids = node.members.length;
    const p = kids ? promise(node) : null;
    const canDim = kids ? p.dimmable > 0 : node.dimmable;
    const value = node.missing ? "not in HA" : st === "unavailable" ? "unavailable" : st === "unknown" ? "?"
      : st === "off" ? "off" : canDim && node.level != null ? `${node.level}%` : "on";
    const sub = kids
      ? `${litCount(node).lit} of ${litCount(node).total} lit${p.onOffOnly.length ? ` · ${p.onOffOnly.length} on/off only` : ""}`
      : !node.dimmable && !node.missing ? "on/off only" : "";
    const lvl = st === "on" ? (canDim && node.level != null ? node.level : 100) : 0;
    const lit = node.rgb ? `rgb(${node.rgb.join(",")})` : "var(--accent-color, #ff9900)";
    return `<div class="row st-${st} ${canDim ? "dim" : "flat"}" role="treeitem" style="--depth:${depth}"
        ${kids ? `aria-expanded="${open}"` : ""}>
      ${kids ? `<button type="button" class="disc" data-open="${esc(node.id)}"
          aria-label="${open ? "Hide" : "Show"} the lights in ${esc(node.name)}">${open ? "⌄" : "›"}</button>`
        : `<span class="disc-space"></span>`}
      <div class="bar" data-id="${esc(node.id)}" ${inert ? `aria-disabled="true"` : `tabindex="0"`}
           role="${canDim ? "slider" : "switch"}"
           ${canDim ? `aria-valuemin="0" aria-valuemax="100" aria-valuenow="${lvl}"` : `aria-checked="${st === "on"}"`}
           aria-label="${esc(node.name)}" style="--lvl:${lvl}%; --lit:${lit}">
        <span class="fill"></span>
        <span class="mark" aria-hidden="true"></span>
        <span class="nm">${esc(node.name)}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</span>
        <span class="val">${esc(value)}</span>
      </div>
    </div>`;
  }

  _wire() {
    const r = this.shadowRoot;
    r.querySelectorAll(".disc").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.open;
      if (this._open.has(id)) this._open.delete(id); else this._open.add(id);
      this._sig = null; this._render();
    }));
    r.querySelectorAll(".bar:not([aria-disabled])").forEach((bar) => {
      bar.addEventListener("pointerdown", (e) => this._down(e, bar));
      bar.addEventListener("keydown", (e) => this._key(e, bar));
    });
  }

  _node(id) { return lightNode(id, this._hass.states); }

  /* A tap switches; a sideways drag sets the level, painted live under the finger
     and sent once on release, so a drag is one command and not fifty. */
  _down(e, bar) {
    const node = this._node(bar.dataset.id);
    const canDim = node.members.length ? promise(node).dimmable > 0 : node.dimmable;
    this._drag = { id: node.id, x: e.clientX, moving: false, canDim, level: null };
    try { bar.setPointerCapture(e.pointerId); } catch { /* pointer already gone - the handlers still run */ }
    const move = (ev) => {
      const d = this._drag;
      if (!d) return;
      if (!d.moving && Math.abs(ev.clientX - d.x) < DRAG_START_PX) return;
      d.moving = true;                      // past the threshold it is no longer a tap
      if (!d.canDim) return;
      const rect = bar.getBoundingClientRect();
      d.level = levelAt(ev.clientX, rect.left, rect.width);
      bar.style.setProperty("--lvl", `${d.level}%`);
      bar.querySelector(".val").textContent = d.level ? `${d.level}%` : "off";
      bar.classList.add("dragging");
    };
    const end = (commit) => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", cancel);
      const d = this._drag;
      this._drag = null;
      if (commit && d) {
        const what = gestureResult({ moved: d.moving, canDim: d.canDim, level: d.level });
        if (what === "level") this._call(levelCall(node, d.level));
        else if (what === "toggle") this._call(toggleCall(node));
      }
      this._sig = null; this._render();
    };
    const up = () => end(true);
    const cancel = () => end(false);
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", cancel);
  }

  _key(e, bar) {
    const node = this._node(bar.dataset.id);
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._call(toggleCall(node)); return; }
    const canDim = node.members.length ? promise(node).dimmable > 0 : node.dimmable;
    if (!canDim || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const cur = node.state === "on" ? (node.level ?? 100) : 0;
    this._call(levelCall(node, cur + (e.key === "ArrowRight" ? 10 : -10)));
  }
}

const STYLE = `
  :host { display: block; }
  ha-card { padding: 10px 0 8px; display: block; }
  .hd { display: flex; align-items: baseline; gap: 8px; padding: 0 14px 8px; }
  .t { font-size: 14px; font-weight: 600; }
  .sum { margin-left: auto; font-size: 11.5px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .tree { display: flex; flex-direction: column; gap: 4px; padding: 0 10px; }
  .row { display: flex; align-items: center; gap: 4px; padding-left: calc(var(--depth) * 16px); }
  .disc, .disc-space { flex: none; width: 28px; height: 40px; }
  .disc { border: 0; background: none; color: var(--primary-text-color); font-size: 18px; cursor: pointer; border-radius: 8px; }
  .disc:hover { background: var(--secondary-background-color, #1c2126); }
  .bar { position: relative; flex: 1; min-width: 0; height: 40px; display: flex; align-items: center; gap: 10px;
         padding: 0 12px; border-radius: 10px; overflow: hidden; cursor: pointer; user-select: none;
         touch-action: pan-y; background: var(--secondary-background-color, #1c2126); }
  .bar:focus-visible, .disc:focus-visible { outline: 2px solid var(--accent-color, #ff9900); outline-offset: 1px; }
  .fill { position: absolute; inset: 0 auto 0 0; width: var(--lvl); background: var(--lit); opacity: .28;
          transition: width .15s ease; pointer-events: none; }
  .bar.dragging .fill { transition: none; opacity: .4; }
  .row.flat .fill { opacity: .18; }
  .mark { position: relative; flex: none; width: 12px; height: 12px; border-radius: 50%;
          border: 2px solid var(--primary-text-color); opacity: .55; }
  .st-on .mark { background: var(--lit); border-color: var(--lit); opacity: 1; }
  .nm { position: relative; flex: 1; min-width: 0; font-size: 14px; display: flex; flex-direction: column;
        overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .sub { font-size: 11px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; }
  .val { position: relative; flex: none; font-size: 13px; font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; }
  .st-off .val { color: var(--secondary-text-color); }
  .st-unavailable .bar { cursor: default; opacity: .55; }
  .st-unavailable .mark { border-style: dashed; }
  .st-unavailable .nm { text-decoration: line-through; }
  .st-unknown .mark { border-style: dotted; opacity: 1; }
`;

// Guarded: the panel and a Lovelace resource can both load this module.
if (!customElements.get("light-tree-card")) customElements.define("light-tree-card", LightTreeCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "light-tree-card",
  name: "Light tree",
  description: "A light group and its parts as one nested control: tap to switch, drag across to dim.",
});
