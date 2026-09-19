/**
 * Samsung TV Plus card — your saved channels, what is on, tap to tune; search
 * the whole lineup to add more.
 *
 * No integration, no backend, no API key, no subscription.
 *   lineup  : https://i.mjh.nz/SamsungTVPlus/.channels.json  (CORS is open, verified)
 *   control : remote.send_command — a stock Home Assistant service
 *   saved   : Home Assistant's own frontend storage — per user by default, or
 *             one list for the house (`saved_for: house`, which only an admin
 *             can change)
 *
 * Everything this card claims was measured against a real set on 2026-09-15; the
 * reasoning behind each rule is in ../../docs/samsung-tv-local-control.md.
 *
 * The logic lives in ./tvplus-core.js — no DOM, no Home Assistant — so the same
 * rules can sit behind a dashboard renderer later. THIS file is the Lovelace
 * adapter and is the disposable half.
 *
 * type: custom:samsung-tvplus-card
 * remote: remote.big_tv
 * channels:            # optional: the list to start from, until one is saved
 *   - Witness to Justice
 *   - CBS News 24/7
 */

import {
  loadLineup, airing, tuneCommand, tuneDuration, groupsOf, searchChannels,
  toggleSaved, moveSaved, savedKey, slotsFrom,
} from "./tvplus-core.js";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const RESULT_LIMIT = 40;
const mins = (sec) => {
  const m = Math.max(0, Math.round(sec / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

class SamsungTvPlusCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._channels = null;
    this._built = false;
    this._sending = null;
    this._mode = "list";          // list | edit | search
    this._query = "";
    this._group = null;
    this._stored = undefined;     // undefined = not read yet, null = nothing saved
    this._note = "";
    this._selected = null;        // the channel whose detail is open
    this._slotStart = null;       // which of its shows the detail is showing
  }

  setConfig(config) {
    if (!config.remote) throw new Error("samsung-tvplus-card: `remote` is required");
    if (config.channels != null && !Array.isArray(config.channels)) {
      throw new Error("samsung-tvplus-card: `channels` is a list of channel names");
    }
    this._config = { region: "us", title: "Samsung TV Plus", list: "default", saved_for: "user", ...config };
    this._built = false;
    // A different list or scope is a different subscription.
    this._dropSubscription();
    this._stored = undefined;
    this._subFailed = false;
    this._load();
    this._subscribe();
  }

  set hass(hass) {
    this._hass = hass;
    this._subscribe();
  }

  getCardSize() { return 2 + (this._saved().length || 3); }

  static getStubConfig() {
    return { remote: "", channels: ["CBS News 24/7", "Movie Hub"] };
  }

  connectedCallback() {
    this._subscribe();
    // Now/next moves on while the card sits there; a minute is finer than any listing.
    this._tick = setInterval(() => { if (this._mode !== "search") this._renderRows(); }, 60000);
  }

  disconnectedCallback() {
    clearInterval(this._tick);
    this._dropSubscription();
  }

  _dropSubscription() {
    const unsub = this._unsub;
    this._unsub = null;
    unsub?.then((f) => f?.()).catch(() => {});
  }

  /* The core owns fetching, caching and the name→number rule. */
  async _load() {
    try {
      const { index, stale } = await loadLineup({ region: this._config.region });
      this._channels = index;
      this._groups = groupsOf(index);
      this._render();
      if (stale) this._retry();
    } catch (e) {
      this._fail(e.message);
    }
  }

  _retry() {
    clearTimeout(this._retryT);
    this._retryT = setTimeout(() => this._load(), 60000);
  }

  /* ---------------- the saved list ----------------
     Stored by Home Assistant, not the browser, so it follows the user to every
     device. Subscribed rather than read once, so this card and the same list in
     the panel or on another device stay in step. */

  _house() { return this._config?.saved_for === "house"; }

  _subscribe() {
    if (this._unsub || this._subFailed || !this._hass?.connection || !this.isConnected || !this._config) return;
    const type = this._house() ? "frontend/subscribe_system_data" : "frontend/subscribe_user_data";
    this._unsub = this._hass.connection.subscribeMessage((ev) => {
      this._stored = ev?.value ?? null;
      this._render();
    }, { type, key: savedKey(this._config.list) });
    this._unsub.catch((e) => {
      this._unsub = null;
      this._subFailed = true;       // say so once; do not retry on every state change
      this._stored = null;
      this._note = `Saved channels could not be read (${e?.message || e?.code || e}) - showing the card's list`;
      this._render();
    });
  }

  /** What is saved, or the card's starting list until something has been saved. */
  _saved() {
    if (Array.isArray(this._stored)) return this._stored;
    return this._config?.channels || [];
  }

  async _save(list) {
    const prev = this._stored;
    this._stored = list;            // show it now; put it back if the save fails
    this._note = "";
    this._render();
    const type = this._house() ? "frontend/set_system_data" : "frontend/set_user_data";
    try {
      await this._hass.connection.sendMessagePromise({ type, key: savedKey(this._config.list), value: list });
    } catch (e) {
      this._stored = prev;
      const why = e?.message || e?.code || String(e);
      this._note = this._house() && /unauthori[sz]ed|admin/i.test(why)
        ? "Only an admin can change the house list" : `Not saved: ${why}`;
      this._render();
    }
  }

  /* ---------------- tuning ----------------
     digits then ENTER, exactly what the remote sends. The TV reports NOTHING back
     after a channel change — the local API is byte-identical before and after — so
     this can say "sent" and must never say "on". */
  _tune(name) {
    const ch = this._channels?.[name];
    if (!ch || !this._hass) return;
    // The remote's integration decides how the keys get spaced out - see tvplus-core.
    const opts = {
      platform: this._hass.entities?.[this._config.remote]?.platform ?? null,
      gapMs: this._config.key_gap_ms,
    };
    this._hass.callService("remote", "send_command", {
      entity_id: this._config.remote,
      command: tuneCommand(ch.n, opts),
    });
    this._sending = name;
    this._renderRows();
    clearTimeout(this._ackT);
    this._ackT = setTimeout(() => { this._sending = null; this._renderRows(); },
      Math.max(1500, tuneDuration(ch.n, opts) + 500));
  }

  _fail(msg) {
    this._built = false;
    this.shadowRoot.innerHTML =
      `<ha-card><div style="padding:16px;color:var(--error-color,#e05252)">
         Samsung TV Plus: ${esc(msg)}</div></ha-card>`;
  }

  /* ---------------- render ---------------- */

  _build() {
    this.shadowRoot.innerHTML = `<style>${SamsungTvPlusCard.styles}</style>
      <ha-card>
        <div class="hd"><span class="t"></span><span class="sub"></span>
          <button class="hb search-btn" type="button">Search</button>
          <button class="hb edit-btn" type="button">Edit list</button></div>
        <div class="searchbar" hidden>
          <input class="q" type="search" enterkeyhint="search" autocomplete="off"
                 placeholder="Channel, show, category or number" aria-label="Search the guide">
          <button class="hb close-btn" type="button" aria-label="Done searching, back to saved channels">Done</button>
        </div>
        <div class="cats" hidden role="group" aria-label="Categories"></div>
        <div class="note" hidden></div>
        <div class="rows"></div>
      </ha-card>`;
    const r = this.shadowRoot;
    r.querySelector(".search-btn").addEventListener("click", () => this._setMode("search"));
    r.querySelector(".close-btn").addEventListener("click", () => this._setMode("list"));
    r.querySelector(".edit-btn").addEventListener("click", () => this._setMode(this._mode === "edit" ? "list" : "edit"));
    r.querySelector(".q").addEventListener("input", (e) => { this._query = e.target.value; this._renderRows(); });
    r.querySelector(".q").addEventListener("keydown", (e) => { if (e.key === "Escape") this._setMode("list"); });
    // One delegated listener for every row button, so re-rendering rows never
    // leaves a handler behind.
    r.querySelector(".rows").addEventListener("click", (e) => this._onRowClick(e));
    r.querySelector(".cats").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-group]");
      if (!b) return;
      this._group = b.dataset.group === "" || b.dataset.group === this._group ? null : b.dataset.group;
      this._renderCats(); this._renderRows();
    });
    this._built = true;
  }

  _setMode(mode) {
    this._mode = mode;
    this._render();
    if (mode === "search") {
      const q = this.shadowRoot.querySelector(".q");
      q.focus({ preventScroll: true });
      q.select();
    }
  }

  _render() {
    if (!this._config) return;
    if (!this._built) this._build();
    const r = this.shadowRoot;
    const search = this._mode === "search";
    r.querySelector(".t").textContent = this._config.title;
    r.querySelector(".searchbar").hidden = !search;
    r.querySelector(".cats").hidden = !search;
    r.querySelector(".search-btn").hidden = search;
    const edit = r.querySelector(".edit-btn");
    edit.hidden = search;
    edit.textContent = this._mode === "edit" ? "Done" : "Edit list";
    edit.classList.toggle("on", this._mode === "edit");
    const note = r.querySelector(".note");
    note.hidden = !this._note;
    note.textContent = this._note;
    if (search) this._renderCats();
    this._renderRows();
  }

  _renderCats() {
    const cats = this.shadowRoot.querySelector(".cats");
    const groups = this._groups || [];
    cats.innerHTML = [`<button type="button" class="cat ${this._group ? "" : "on"}" data-group="">All</button>`,
      ...groups.map((g) => `<button type="button" class="cat ${this._group === g.name ? "on" : ""}"
        data-group="${esc(g.name)}">${esc(g.name)} <span>${g.count}</span></button>`)].join("");
  }

  _renderRows() {
    if (!this._built) return;
    const rows = this.shadowRoot.querySelector(".rows");
    const sub = this.shadowRoot.querySelector(".sub");
    if (!this._channels) { rows.innerHTML = `<div class="msg">loading lineup…</div>`; return; }
    if (this._mode === "search") { this._renderResults(rows, sub); return; }

    const saved = this._saved();
    const edit = this._mode === "edit";
    let missing = 0;
    if (!saved.length) {
      rows.innerHTML = `<div class="msg">Nothing saved yet. Use <b>Search</b> to find channels and save them here.</div>`;
      sub.textContent = "";
      return;
    }
    rows.innerHTML = saved.map((name, i) => {
      const ch = this._channels[name];
      if (!ch) missing++;
      if (!ch || edit) {
        const tools = edit ? `<span class="tools">
            <button type="button" class="ib" data-act="up" data-name="${esc(name)}" aria-label="Move ${esc(name)} up" ${i ? "" : "disabled"}>↑</button>
            <button type="button" class="ib" data-act="down" data-name="${esc(name)}" aria-label="Move ${esc(name)} down" ${i < saved.length - 1 ? "" : "disabled"}>↓</button>
            <button type="button" class="tb" data-act="save" data-name="${esc(name)}">Remove</button></span>` : "";
        // a renamed or dropped channel: say so, do not guess at a number
        return `<div class="row ${ch ? "" : "gone"}"><span class="no">${ch ? ch.n : "—"}</span><span class="mid">
          <span class="nm">${esc(name)}</span>
          <span class="pg">${ch ? "" : "not in the current lineup"}</span></span>${tools}</div>`;
      }
      return this._channelRow(name, ch, { saved: true });
    }).join("");
    sub.textContent = missing ? `${missing} not in lineup` : "";
    this._revealDetail();
  }

  _renderResults(rows, sub) {
    const { results, total } = searchChannels(this._channels, { query: this._query, group: this._group, limit: RESULT_LIMIT });
    const saved = new Set(this._saved());
    sub.textContent = "";
    if (!this._query.trim() && !this._group) {
      rows.innerHTML = `<div class="msg">Type a channel, a show, a category or a number - or pick a category.</div>`;
      return;
    }
    if (!results.length) { rows.innerHTML = `<div class="msg">Nothing matches.</div>`; return; }
    rows.innerHTML = results.map((c) => this._channelRow(c.name, this._channels[c.name],
      { saved: saved.has(c.name), inSearch: true })).join("")
      + (total > results.length
        ? `<div class="msg">${total - results.length} more - add a word or pick a category to narrow it.</div>` : "");
    this._revealDetail();
  }

  /** One channel: tap to select it; the selected one opens its detail underneath. */
  _channelRow(name, ch, { saved = false, inSearch = false } = {}) {
    const selected = this._selected === name;
    const { cur, next } = airing(ch.programs);
    const sending = this._sending === name;
    return `<button type="button" class="row ${selected ? "sel" : ""}" data-act="select" data-name="${esc(name)}"
        aria-expanded="${selected}">
      <span class="no">${ch.n}</span>
      <span class="mid"><span class="nm">${esc(name)}${inSearch && saved ? ` <span class="badge">saved</span>` : ""}</span>
        <span class="pg">${sending ? "sending…" : cur ? `${esc(cur.title)} · until ${fmt(cur.end)}` : "no listing"}</span>
        ${inSearch ? `<span class="grp">${esc(ch.group || "")}</span>` : ""}</span>
      ${inSearch ? "" : `<span class="nx">${next ? esc(`${fmt(next.start)} ${next.title}`) : ""}</span>`}
    </button>${selected ? this._detailHtml(name, ch, saved) : ""}`;
  }

  /** The show the detail is on: the one picked with the arrows, else the first. */
  _slotIndex(slots) {
    const i = slots.findIndex((x) => x.start === this._slotStart);
    return i < 0 ? 0 : i;
  }

  /**
   * The selected channel: step through its shows with the arrows, then tune.
   * Tuning changes the channel NOW whatever show is on screen here, and the card
   * says so rather than implying it can tune to a later show.
   */
  _detailHtml(name, ch, saved) {
    const slots = slotsFrom(ch.programs);
    const i = this._slotIndex(slots);
    const slot = slots[i] || null;
    const now = Date.now() / 1000;
    const firstLater = slots[0]?.onNow ? 1 : 0;
    const label = !slot ? "" : slot.onNow ? "On now" : i === firstLater ? "Next" : "Later";
    const rel = !slot ? "" : slot.onNow ? `ends in ${mins(slot.end - now)}` : `starts in ${mins(slot.start - now)}`;
    const sending = this._sending === name;
    const n = esc(name);
    return `<div class="detail" role="group" aria-label="${n}">
      ${slot ? `<div class="slot">
        <button type="button" class="ib step" data-act="prev" data-name="${n}" aria-label="Earlier show" ${i > 0 ? "" : "disabled"}>◀</button>
        <div class="slot-body" aria-live="polite">
          <span class="when">${label} · ${fmt(slot.start)}–${fmt(slot.end)} · <span class="rel">${rel}</span></span>
          <span class="what">${esc(slot.title)}</span>
          <span class="pos">${i + 1} of ${slots.length} listed</span>
        </div>
        <button type="button" class="ib step" data-act="next" data-name="${n}" aria-label="Later show" ${i < slots.length - 1 ? "" : "disabled"}>▶</button>
      </div>` : `<div class="msg">No listing for this channel.</div>`}
      <div class="acts">
        <button type="button" class="tb tune" data-act="tune" data-name="${n}">${sending ? "Sending…" : `Tune to ${ch.n}`}</button>
        <button type="button" class="tb ${saved ? "on" : ""}" data-act="save" data-name="${n}" aria-pressed="${saved}">${saved ? "Saved" : "Save"}</button>
      </div>
      ${slot && !slot.onNow ? `<div class="hint">Tuning changes the channel now; this show starts at ${fmt(slot.start)}.</div>` : ""}
    </div>`;
  }

  /** Keep an opened detail on screen - on a phone it can open below the fold. */
  _revealDetail() {
    if (!this._reveal) return;
    this._reveal = false;
    this.shadowRoot.querySelector(".detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  _onRowClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const name = b.dataset.name;
    const act = b.dataset.act;
    if (act === "select") {
      const open = this._selected !== name;
      this._selected = open ? name : null;
      this._slotStart = null;
      this._reveal = open;
      this._renderRows();
    } else if (act === "prev" || act === "next") {
      const slots = slotsFrom(this._channels?.[name]?.programs);
      const j = this._slotIndex(slots) + (act === "next" ? 1 : -1);
      if (slots[j]) { this._slotStart = slots[j].start; this._renderRows(); }
    } else if (act === "tune") this._tune(name);
    else if (act === "save") this._save(toggleSaved(this._saved(), name));
    else if (act === "up") this._save(moveSaved(this._saved(), name, -1));
    else if (act === "down") this._save(moveSaved(this._saved(), name, 1));
  }
}

SamsungTvPlusCard.styles = `
  ha-card { padding: 10px 0 6px; }
  * { box-sizing: border-box; }
  .hd { display:flex; align-items:center; gap:8px; padding:2px 12px 8px 16px; }
  .t { font-size:16px; font-weight:600; }
  .sub { margin-left:auto; font-size:11px; color:var(--warning-color,#f5a623); }
  .hb, .tb, .ib, .cat { font:inherit; cursor:pointer; border-radius:8px; color:var(--primary-text-color);
                        border:1px solid var(--divider-color,#555); background:var(--secondary-background-color,#1c2126); }
  .hb { padding:5px 12px; font-size:12.5px; }
  .hd .hb:first-of-type { margin-left:auto; }
  .sub:not(:empty) + .hb { margin-left:0; }
  .hb.on, .tb.on, .cat.on { border-color:var(--accent-color,#ff9900); color:var(--accent-color,#ff9900); }
  .hb:focus-visible, .tb:focus-visible, .ib:focus-visible, .cat:focus-visible, .row:focus-visible, .q:focus-visible
    { outline:2px solid var(--accent-color,#ff9900); outline-offset:1px; }
  .searchbar { display:flex; gap:8px; padding:0 12px 8px 16px; }
  .q { flex:1; min-width:0; font:inherit; font-size:15px; padding:8px 10px; border-radius:8px;
       border:1px solid var(--divider-color,#555); background:var(--card-background-color,#111);
       color:var(--primary-text-color); }
  .cats { display:flex; gap:6px; overflow-x:auto; padding:0 12px 8px 16px; scrollbar-width:thin; }
  .cat { flex:none; padding:4px 10px; font-size:12px; white-space:nowrap; }
  .cat span { opacity:.6; margin-left:2px; }
  .note { margin:0 16px 8px; font-size:12px; color:var(--warning-color,#f5a623); }
  .rows { display:flex; flex-direction:column; }
  .msg { padding:14px 16px; color:var(--secondary-text-color); font-size:13px; }
  .row { display:flex; align-items:center; gap:12px; width:100%; border:0;
         background:none; color:var(--primary-text-color); font:inherit;
         text-align:left; padding:9px 12px 9px 16px; }
  button.row { cursor:pointer; }
  button.row:hover { background:var(--secondary-background-color); }
  .no { flex:none; width:44px; font-variant-numeric:tabular-nums; font-weight:600;
        color:var(--accent-color, #ff9900); }
  .mid { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
  .nm { font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pg, .grp { font-size:12px; color:var(--secondary-text-color);
              overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .grp { font-size:11px; opacity:.75; }
  .nx { flex:none; max-width:34%; font-size:11.5px; color:var(--secondary-text-color);
        opacity:.75; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tools { flex:none; display:flex; gap:6px; }
  .tb { padding:6px 12px; font-size:12.5px; min-width:58px; }
  .ib { width:34px; padding:6px 0; font-size:14px; }
  .ib:disabled { opacity:.35; cursor:default; }
  .row.sel { background:var(--secondary-background-color); box-shadow:inset 3px 0 0 var(--accent-color,#ff9900); }
  .badge { font-size:10.5px; color:var(--accent-color,#ff9900); border:1px solid currentColor; border-radius:6px;
           padding:0 4px; margin-left:4px; vertical-align:1px; }
  .detail { display:flex; flex-direction:column; gap:10px; padding:8px 12px 12px 16px;
            background:var(--secondary-background-color); border-bottom:1px solid var(--divider-color,#444); }
  .slot { display:flex; align-items:center; gap:10px; }
  .slot-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; text-align:center; }
  .when { font-size:12px; color:var(--secondary-text-color); font-variant-numeric:tabular-nums; }
  .rel { opacity:.8; }
  .what { font-size:15px; font-weight:600; overflow-wrap:anywhere; }
  .pos { font-size:11px; color:var(--secondary-text-color); opacity:.7; }
  .ib.step { width:44px; height:44px; font-size:15px; flex:none; }
  .acts { display:flex; gap:8px; }
  .tb.tune { flex:1; padding:10px 14px; font-size:14px; font-weight:600; border-color:var(--accent-color,#ff9900); }
  .hint { font-size:11.5px; color:var(--secondary-text-color); }
  .row.gone { opacity:.55; }
  .row.gone .no { color:var(--secondary-text-color); }
  @media (max-width:460px){ .nx { display:none; } .tb { min-width:0; padding:6px 9px; } }
`;

// Guarded: the panel and a Lovelace resource can both load this module, and a
// second define would throw and take the whole module down with it.
if (!customElements.get("samsung-tvplus-card")) customElements.define("samsung-tvplus-card", SamsungTvPlusCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "samsung-tvplus-card",
  name: "Samsung TV Plus",
  description: "Saved TV Plus channels with what is on, search the lineup, tap to tune. No cloud account.",
});
