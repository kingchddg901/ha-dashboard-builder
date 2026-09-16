/**
 * Samsung TV Plus card — pick a few channels, see what is on, tap to tune.
 *
 * No integration, no backend, no API key, no subscription.
 *   lineup  : https://i.mjh.nz/SamsungTVPlus/.channels.json  (CORS is open, verified)
 *   control : remote.send_command — a stock Home Assistant service
 *
 * Everything this card claims was measured against a real set on 2026-09-15; the
 * reasoning behind each rule is in ../../docs/samsung-tv-local-control.md.
 *
 * type: custom:samsung-tvplus-card
 * remote: remote.big_tv_un55au8000fxza
 * channels:
 *   - Witness to Justice
 *   - CBS News 24/7
 *   - Movie Hub
 */

const LINEUP = "https://i.mjh.nz/SamsungTVPlus/.channels.json";
const CACHE  = "stvp-lineup-v1";
const MAXAGE = 6 * 3600 * 1000;   // the file regenerates daily; 6h is plenty

class SamsungTvPlusCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._channels = null;
    this._built = false;
    this._sending = null;
  }

  setConfig(config) {
    if (!config.remote) throw new Error("samsung-tvplus-card: `remote` is required");
    if (!Array.isArray(config.channels) || !config.channels.length) {
      throw new Error("samsung-tvplus-card: `channels` must list at least one channel name");
    }
    this._config = { region: "us", title: "Samsung TV Plus", ...config };
    this._built = false;
    this._load();
  }

  set hass(hass) { this._hass = hass; }
  getCardSize() { return 1 + (this._config?.channels?.length || 3); }

  static getStubConfig() {
    return { remote: "", channels: ["CBS News 24/7", "Movie Hub"] };
  }

  /* ---------------- lineup ----------------
     Channels are keyed by NAME, never by number. Samsung renumbers — the entire
     Kids block moved recently, so a favourite saved as 3695 = Pokémon now tunes
     Kidoodle.TV. The number is resolved at press time and is a cache, not the
     saved thing, so a renumber heals on the next refresh. */
  async _load() {
    const cached = this._readCache();
    if (cached) { this._channels = cached; this._render(); }
    if (cached && Date.now() - cached.__at < MAXAGE) return;
    try {
      const res  = await fetch(LINEUP, { cache: "no-cache" });
      const json = await res.json();
      const list = json.regions?.[this._config.region]?.channels;
      if (!list) throw new Error("region '" + this._config.region + "' not in the lineup");
      const byName = {};
      for (const c of Object.values(list)) {
        byName[c.name] = { n: c.chno, g: c.group, p: c.programs || [] };
      }
      byName.__at = Date.now();
      this._channels = byName;
      this._writeCache(byName);
      this._render();
    } catch (e) {
      if (!cached) this._fail(e.message);
    }
  }

  // localStorage is a per-viewer convenience only; every access is guarded
  _readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE)) || null; } catch (e) { return null; }
  }
  _writeCache(v) {
    try { localStorage.setItem(CACHE, JSON.stringify(v)); } catch (e) { /* private window, full quota */ }
  }

  /* ---------------- tuning ----------------
     digits then ENTER, exactly what the remote sends. The TV reports NOTHING back
     after a channel change — the local API is byte-identical before and after — so
     this can say "sent" and must never say "on". */
  _tune(name) {
    const ch = this._channels?.[name];
    if (!ch || !this._hass) return;
    const cmds = String(ch.n).split("").map((d) => "KEY_" + d).concat("KEY_ENTER");
    this._hass.callService("remote", "send_command", {
      entity_id: this._config.remote,
      command: cmds,
      delay_secs: 0.4,
    });
    this._sending = name;
    this._render();
    clearTimeout(this._ackT);
    this._ackT = setTimeout(() => { this._sending = null; this._render(); }, 1500);
  }

  _airing(ch) {
    const now = Date.now() / 1000;
    let cur = null, next = null;
    for (let i = 0; i < ch.p.length; i++) {
      const [ts, title] = ch.p[i];
      const end = ch.p[i + 1] ? ch.p[i + 1][0] : ts + 3600;
      if (ts <= now && now < end) cur = { title, end };
      else if (ts > now && !next) next = { title, ts };
    }
    return { cur, next };
  }

  _fail(msg) {
    this.shadowRoot.innerHTML =
      `<ha-card><div style="padding:16px;color:var(--error-color,#e05252)">
         Samsung TV Plus: ${msg}</div></ha-card>`;
  }

  _render() {
    if (!this._built) {
      this.shadowRoot.innerHTML = `<style>${SamsungTvPlusCard.styles}</style>
        <ha-card><div class="hd"><span class="t"></span><span class="sub"></span></div>
        <div class="rows"></div></ha-card>`;
      this._built = true;
    }
    const root = this.shadowRoot;
    root.querySelector(".t").textContent = this._config.title;
    const rows = root.querySelector(".rows");
    rows.textContent = "";

    if (!this._channels) {
      rows.innerHTML = `<div class="msg">loading lineup…</div>`;
      return;
    }

    const fmt = (t) =>
      new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    let missing = 0;

    for (const name of this._config.channels) {
      const ch = this._channels[name];
      const row = document.createElement("button");
      row.className = "row";
      row.type = "button";

      if (!ch) {
        // a renamed or dropped channel: say so, do not guess at a number
        missing++;
        row.classList.add("gone");
        row.innerHTML = `<span class="no">—</span><span class="mid">
          <span class="nm">${name}</span>
          <span class="pg">not in the current lineup</span></span>`;
        rows.appendChild(row);
        continue;
      }

      const { cur, next } = this._airing(ch);
      const sending = this._sending === name;
      row.innerHTML = `
        <span class="no">${ch.n}</span>
        <span class="mid">
          <span class="nm">${name}</span>
          <span class="pg">${
            sending ? "sent" :
            cur ? `${cur.title} · until ${fmt(cur.end)}` : "no listing"
          }</span>
        </span>
        <span class="nx">${next ? fmt(next.ts) + " " + next.title : ""}</span>`;
      if (sending) row.classList.add("sent");
      row.addEventListener("click", () => this._tune(name));
      rows.appendChild(row);
    }

    root.querySelector(".sub").textContent =
      missing ? `${missing} not in lineup` : "";
  }
}

SamsungTvPlusCard.styles = `
  ha-card { padding: 10px 0 6px; }
  .hd { display:flex; align-items:baseline; gap:10px; padding:2px 16px 8px; }
  .t { font-size:16px; font-weight:600; }
  .sub { margin-left:auto; font-size:11px; color:var(--warning-color,#f5a623); }
  .rows { display:flex; flex-direction:column; }
  .msg { padding:14px 16px; color:var(--secondary-text-color); font-size:13px; }
  .row { display:flex; align-items:center; gap:12px; width:100%; border:0;
         background:none; color:var(--primary-text-color); font:inherit;
         text-align:left; padding:9px 16px; cursor:pointer; }
  .row:hover { background:var(--secondary-background-color); }
  .no { flex:none; width:44px; font-variant-numeric:tabular-nums; font-weight:600;
        color:var(--accent-color, #ff9900); }
  .mid { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
  .nm { font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pg { font-size:12px; color:var(--secondary-text-color);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .nx { flex:none; max-width:34%; font-size:11.5px; color:var(--secondary-text-color);
        opacity:.75; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row.sent .pg { color:var(--accent-color, #ff9900); }
  .row.gone { opacity:.55; cursor:default; }
  .row.gone .no { color:var(--secondary-text-color); }
  @media (max-width:460px){ .nx { display:none; } }
`;

customElements.define("samsung-tvplus-card", SamsungTvPlusCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "samsung-tvplus-card",
  name: "Samsung TV Plus",
  description: "Pick a few TV Plus channels, see what is on, tap to tune. No cloud account.",
});
