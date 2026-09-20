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
 * speed: auto                              # auto | linear | steps
 * steps: 6                                 # with speed: steps (notches: 6 still works)
 * presets: input_text.ceiling_fan_presets  # eight slots in a helper (the fan's)
 *
 * Every light with a white or a colour gets eight preset slots. Without
 * `presets` they are the light's own, kept in Home Assistant's frontend storage;
 * `presets: living_room` shares a named set between cards, `presets: false`
 * turns them off. See presetStorage in ./control-core.js.
 */

import { describeEntity } from "../builder-debug-card/capability-core.js";
import {
  speedControl, switchControl, levelControl, kelvinControl, appearanceControl, layoutFor, axisFor,
  mixToCommand, setSaturation, colorToMix, RGB_WHITE_TRAP_SATURATION,
  PRESET_SLOTS, encodeSlots, decodeSlots, slotCommand, slotFromLight, presetStorage,
} from "./control-core.js";

/** Rough kelvin -> sRGB, for a swatch only. Not the calibration; that lives in HA. */
const KELVIN_STOPS = [[2000, [255, 141, 41]], [2700, [255, 175, 109]], [3400, [255, 199, 150]],
  [4200, [255, 218, 187]], [5000, [255, 231, 211]], [6500, [255, 244, 234]]];
function kelvinSwatch(k) {
  if (k == null) return "transparent";
  const st = KELVIN_STOPS;
  if (k <= st[0][0]) return `rgb(${st[0][1].join(",")})`;
  if (k >= st[st.length - 1][0]) return `rgb(${st[st.length - 1][1].join(",")})`;
  for (let i = 1; i < st.length; i++) {
    if (k <= st[i][0]) {
      const t = (k - st[i - 1][0]) / (st[i][0] - st[i - 1][0]);
      const c = st[i - 1][1].map((v, j) => Math.round(v + (st[i][1][j] - v) * t));
      return `rgb(${c.join(",")})`;
    }
  }
  return "transparent";
}
const swatchOf = (a) => a.mode === "color" && a.hs
  ? `hsl(${a.hs[0]}, ${a.hs[1]}%, 55%)`
  : kelvinSwatch(a.kelvin);

const esc = (v) => String(v).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * Who decided how many speeds there are, in words - except `percentage_step`,
 * which stays spelled exactly as Home Assistant spells it. It is the name of
 * the attribute the integration reported, so it is an identifier a reader can
 * go and look up; prettifying it to "Percentage step" would send them hunting
 * for something that does not exist. The other two are our own words, not HA's,
 * so they are written as words.
 */
const SPEED_SOURCE = Object.freeze({
  declared: "you set this",
  percentage_step: "from percentage_step",
  none: "no step reported",
});

class ApplianceCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = null;
    this._width = null;
    // The window's height, not the card's: a card grows and the page scrolls, so
    // its own height is its output, not its constraint. See control-core.js.
    this._height = typeof window !== "undefined" ? window.innerHeight : null;
    this._onResize = () => {
      const h = window.innerHeight;
      if (h !== this._height) { this._height = h; this._sig = null; this._render(); }
    };
  }

  setConfig(config) {
    if (!config.fan && !config.light && !config.switch) {
      throw new Error("appliance-card: needs a `fan`, a `light`, a `switch`, or several");
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
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this._onResize);
      window.addEventListener("orientationchange", this._onResize);
      this._onResize();
    }
  }

  disconnectedCallback() {
    this._dropPresetSub();
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this._onResize);
      window.removeEventListener("orientationchange", this._onResize);
    }
  }

  getCardSize() { return 6; }

  static getStubConfig() { return { fan: "", light: "" }; }

  /** The older `notches: n` means steps mode with n steps. */
  _speedOpts() {
    const c = this._config;
    const mode = c.speed || (c.notches ? "steps" : "auto");
    return { mode, steps: c.steps || c.notches || null };
  }

  /* HA builds the visual editor from this schema - the speed setting is a real
     choice in the card editor rather than a line of YAML. */
  static getConfigForm() {
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        { name: "fan", selector: { entity: { filter: { domain: "fan" } } } },
        { name: "light", selector: { entity: { filter: { domain: "light" } } } },
        {
          type: "grid", name: "", schema: [
            { name: "speed", selector: { select: { mode: "dropdown", options: [
              { value: "auto", label: "Auto - believe the integration" },
              { value: "linear", label: "Linear - a slider" },
              { value: "steps", label: "Steps - notches" },
            ] } } },
            { name: "steps", selector: { number: { min: 2, max: 12, mode: "box" } } },
          ],
        },
        { name: "last_level", selector: { entity: { filter: { domain: "sensor" } } } },
        { name: "presets", selector: { entity: { filter: { domain: "input_text" } } } },
      ],
      computeLabel: (s) => ({ speed: "Fan speed control", steps: "Number of steps",
        last_level: "Remembered-level sensor", presets: "Preset store" }[s.name]),
      computeHelper: (s) => (s.name === "steps"
        ? "Only used with Steps. Leave empty to use the count the integration implies." : undefined),
    };
  }

  /* ---------------- where the preset slots live ---------------- */

  /** Follow a stored slot set, once per key; a helper needs no subscription. */
  _ensurePresetSub(store) {
    const key = store?.kind === "store" ? store.key : null;
    if (key === this._presetKey) return;
    this._dropPresetSub();
    this._presetKey = key;
    this._presetsText = null;
    if (!key || !this._hass?.connection || !this.isConnected) { this._presetKey = null; return; }
    this._presetUnsub = this._hass.connection.subscribeMessage((ev) => {
      this._presetsText = typeof ev?.value === "string" ? ev.value : null;
      this._sig = null; this._render();
    }, { type: "frontend/subscribe_user_data", key });
    this._presetUnsub.catch(() => { this._presetUnsub = null; this._saveNote = "saved colours could not be read"; });
  }

  _dropPresetSub() {
    const unsub = this._presetUnsub;
    this._presetUnsub = null;
    this._presetKey = null;
    unsub?.then((f) => f?.()).catch(() => {});
  }

  _writePresets(store, text) {
    if (store.kind === "entity") {
      this._call("input_text", "set_value", { entity_id: store.entity_id, value: text });
      return;
    }
    this._hass.connection.sendMessagePromise({ type: "frontend/set_user_data", key: store.key, value: text })
      .catch((e) => { this._saveNote = `not saved: ${e?.message || e}`; this._sig = null; this._render(); });
  }

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
    const sw = this._record(this._config.switch);
    const layout = layoutFor(this._width);
    const axis = axisFor(layout, this._height);
    const speed = fan ? speedControl(fan, this._speedOpts()) : null;
    const power = switchControl(sw);
    const level = light ? levelControl(light, { remembered: this._remembered(this._config.light) }) : null;
    const kelvin = light ? kelvinControl(light) : null;
    const appear = light ? appearanceControl(light, { remembered: this._remembered(this._config.light) }) : null;

    // Never repaint under a finger or a keyboard. Typing matters most: on a phone
    // the soft keyboard shrinks the window, the resize handler re-renders, and
    // rebuilding the DOM destroys the very input the keyboard opened for.
    if (this._dragging || this._editing) return;

    // White or colour: the fixture is only ever in one, so the card shows one.
    // It follows the light until the user picks, then stays where they put it.
    const colourCapable = Boolean(light?.capabilities?.supported_color_modes?.some(
      (m) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(m)));
    const mode = !colourCapable ? "white"
      : this._mode || (light?.raw?.color_mode === "hs" ? "colour" : "white");

    // The faders hold INTENT - what was asked for - and never the outcome.
    // An earlier version re-seeded them from the light after every release, to
    // show the gamut, and it made the desk impossible to steer: ask for yellow,
    // the fixture reports the nearest yellow it can make, the faders jump there,
    // and every correction is overwritten the same way. So the desk is seeded
    // when it opens, and again only when the light changes for a reason that is
    // not our own command - the app, voice, another dashboard. Our own echo is
    // recognised by time: tuya_local shows an optimistic value for 5 s and the
    // real one after the next poll, so 7 s covers both. What the fixture
    // actually made is shown beside the faders instead of written into them.
    const mixKey = JSON.stringify([light?.raw?.hs_color, light?.raw?.brightness, light?.state]);
    if (light && this._mixKey !== mixKey) {
      this._mixKey = mixKey;
      const echo = Date.now() < (this._echoUntil || 0);
      if (!this._mix || !echo) {
        const mem = this._remembered(this._config.light);
        const src = light.state === "on" ? light
          : { raw: { hs_color: mem?.hs ?? null, brightness: mem?.b ?? null } };
        this._mix = colorToMix(src);
      }
    }

    const store = light ? presetStorage(this._config, light) : null;
    this._ensurePresetSub(store);
    const presetsText = store?.kind === "entity" ? this._hass.states?.[store.entity_id]?.state
      : store?.kind === "store" ? this._presetsText : null;
    const sig = JSON.stringify([layout, axis, fan?.state, light?.state, sw?.state, speed, power, level, kelvin, appear,
      mode, mixKey, presetsText, this._saving]);
    if (sig === this._sig) return;
    this._sig = sig;

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card class="${esc(layout)} ${esc(axis)}">
        <div class="hd">${esc(this._config.title)}${this._config.debug
          ? `<span class="lay">${esc(layout)} · ${esc(axis)}</span>` : ""}</div>
        ${power ? this._switchBlock(power) : ""}
        ${fan ? this._fanBlock(fan, speed) : ""}
        ${light ? this._lightBlock(light, level, kelvin, appear, mode, colourCapable) : ""}
        ${light && mode === "colour" ? this._deskBlock(light) : ""}
        ${store ? this._presetsBlock(decodeSlots(presetsText)) : ""}
      </ha-card>`;
    this._wire(fan, speed, light, level, kelvin, power);
    if (light) this._wireDesk(mode);
    if (store) this._wirePresets(light, mode, decodeSlots(presetsText), store);
  }

  /**
   * On, off, and nothing else. The sub-line names the entity rather than
   * repeating the state: on a tile the title is the appliance ("Dishwasher
   * plug"), and what a reader wants next is which socket that is.
   */
  _switchBlock(power) {
    return `
      <div class="block switch ${power.on ? "on" : "off"}${power.available ? "" : " gone"}">
        <div class="side">
          <button class="power switch-power" aria-label="${esc(power.noun)} power"${power.available ? "" : " disabled"}>&#9211;</button>
          <div class="txt">
            <div class="name">${esc(power.noun)} ${esc(power.reads)}</div>
            <div class="sub">${esc(this._config.switch)}</div>
          </div>
        </div>
      </div>`;
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
        ? `Speed ${speed.index || "—"} of ${speed.count}${on ? "" : " · resumes here"}`
        : `${speed.current ?? "—"}%`}
              <span class="src">${esc(SPEED_SOURCE[speed.source] || speed.source)}</span>
            </div>
            ${dir ? `<button class="dir">${dir === "reverse" ? "↑ pull warm air up" : "↓ push cool air down"}</button>` : ""}
          </div>
        </div>
        ${notches}
      </div>`;
  }

  _lightBlock(light, level, kelvin, appear, mode, colourCapable) {
    const on = light.state === "on";
    const shown = level.pct ?? level.restore ?? 0;
    const bar = level.supported
      ? `<div class="track bar" role="group" aria-label="Brightness">
           <div class="fill ${level.state}" style="--v:${shown}%"></div>
           <div class="thumb" style="--v:${shown}%"><span class="readout">${shown}%</span></div>
           <input class="range" type="range" min="1" max="100" value="${shown}" aria-label="Brightness">
         </div>`
      : "";            // an on/off light says so in its text; there is no level to draw
    return `
      <div class="block light ${on ? "on" : "off"}">
        <div class="side">
          <button class="power light-power" aria-label="Light power">☀</button>
          <div class="txt">
            <div class="name">Light ${on ? "on" : "off"}</div>
            <div class="sub">
              ${level.supported ? `<span class="dot" style="background:${swatchOf(appear)}"></span>` : ""}
              ${!level.supported ? "Switches on and off only"
        : level.state !== "off-unknown"
        ? `<button class="typed" title="Tap to type a level">${level.state === "lit"
          ? `${level.pct}%` : `Off · returns to ${level.restore}%`}</button>`
        : level.state === "off-unknown" ? "Off · level unknown" : `${level.pct}%`}${appear.from === "remembered"
        ? appear.mode === "temp" ? ` at ${Math.round(appear.kelvin)} K`
          : ` at hue ${Math.round(appear.hs[0])}°`
        : ""}</div>
            ${colourCapable ? `<div class="modes" role="group" aria-label="Light mode">
              <button class="mode-white ${mode === "white" ? "on" : ""}">White</button>
              <button class="mode-colour ${mode === "colour" ? "on" : ""}">Colour</button>
            </div>` : ""}
            ${kelvin && mode === "white" ? `<div class="kel">
              <span class="klabel">Colour</span>
              <input class="ktemp ${appear.mode === "unknown" ? "idle" : ""}" type="range"
                     min="${kelvin.min}" max="${kelvin.max}" step="10"
                     value="${appear.kelvin ?? Math.round((kelvin.min + kelvin.max) / 2)}"
                     aria-label="Colour temperature">
              <span class="sub"><span class="kvalue">${appear.mode === "unknown" ? "—"
        : `${Math.round(appear.kelvin ?? 0)} K`}</span>
                <span class="src">${appear.from === "remembered" ? "Remembered"
          : appear.mode === "unknown" ? "Unknown" : `${kelvin.min}–${kelvin.max} measured`}</span></span>
            </div>` : ""}
          </div>
        </div>
        ${mode === "white" ? bar : ""}
      </div>`;
  }

  /* The desk: three channel faders, a saturation handle over them, and a master.
     Faders are rows in every layout for now - thumb-sized, and immune to the
     vertical-range quirks some WebViews still have. */
  _deskBlock(light) {
    const m = this._mix;
    const hs = light?.state === "on" ? light?.raw?.hs_color : null;
    const got = Array.isArray(hs) ? `hsl(${hs[0]}, ${hs[1]}%, 55%)` : "transparent";
    const gotText = Array.isArray(hs)
      ? `hue ${Math.round(hs[0])}° · sat ${Math.round(hs[1])}%` : "—";
    const fader = (key, label, value) => `
      <label class="fader f-${key}"><span class="fl">${label}</span>
        <input class="fr" data-ch="${key}" type="range" min="0" max="100" value="${value}"
               aria-label="${label}">
        <span class="fv">${value}</span></label>`;
    return `
      <div class="desk">
        <div class="deskhead">
          <span class="pair"><span class="bigswatch" title="asked"></span><span class="cap">asked</span></span>
          <span class="pair"><span class="gotswatch" style="background:${got}" title="the fixture reports"></span><span class="cap">got</span></span>
          <span class="sums"><span class="desksum"></span><span class="gotsum">fixture: ${gotText}</span></span>
        </div>
        ${fader("r", "R", m.r)}
        ${fader("g", "G", m.g)}
        ${fader("b", "B", m.b)}
        ${fader("s", "SAT", Math.round(m.saturation * 100))}
        ${fader("p", "POWER", m.power)}
        <div class="trap" hidden>Near white - the white emitters give about twelve times the
          light <button class="to-white">Use white</button></div>
      </div>`;
  }

  /* Eight shared slots. Tap a filled one to apply it; tap "save", then a slot, to
     store the light as it is now. Save is a separate, explicit step so a stray
     tap can never overwrite a colour somebody spent a while tuning. */
  _presetsBlock(slots) {
    const saving = Boolean(this._saving);
    const cell = (slot, i) => {
      if (!slot) {
        return `<button class="slot empty ${saving ? "armed" : ""}" data-i="${i}"
                  aria-label="Empty slot ${i + 1}">${saving ? "+" : ""}</button>`;
      }
      const bg = slot.mode === "temp" ? kelvinSwatch(slot.k) : `rgb(${slot.rgb.join(",")})`;
      const what = slot.mode === "temp" ? `${slot.k} K` : "colour";
      return `<button class="slot ${saving ? "armed" : ""}" data-i="${i}" style="--sw:${bg}"
                title="${what} · ${slot.b}%" aria-label="Slot ${i + 1}: ${what}, ${slot.b} percent">
                <span class="lvl">${slot.b}</span></button>`;
    };
    return `
      <div class="presets ${saving ? "saving" : ""}">
        <div class="slots">${slots.map(cell).join("")}</div>
        <div class="phead">
          ${saving
        ? `<span class="hint">Tap a slot to save the light as it is now</span>
             <button class="psave cancel">Cancel</button>`
        : `<span class="hint">${slots.some(Boolean) ? "Tap to apply" : "No saved colours yet"}</span>
             <button class="psave">Save</button>`}
        </div>
        ${this._saveNote ? `<div class="pnote">${esc(this._saveNote)}</div>` : ""}
      </div>`;
  }

  _wirePresets(light, mode, slots, store) {
    const r = this.shadowRoot;
    const lightId = this._config.light;

    r.querySelector(".psave")?.addEventListener("click", () => {
      this._saving = !this._saving;
      this._saveNote = null;
      this._sig = null; this._render();
    });

    r.querySelectorAll(".slot").forEach((btn) => btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      if (this._saving) {
        const slot = slotFromLight(light, { mix: mode === "colour" ? this._mix : null });
        this._saving = false;
        if (!slot) {
          this._saveNote = "turn the light on to save it";
        } else {
          const next = slots.slice();
          next[i] = slot;
          this._writePresets(store, encodeSlots(next));
          this._saveNote = null;
        }
        this._sig = null; this._render();
        return;
      }
      const slot = slots[i];
      const data = slotCommand(slot);
      if (!data) return;
      // Match the card to what is about to happen, and treat the light's reply as
      // our own echo so the desk does not snap back to the reported colour.
      this._mode = slot.mode === "temp" ? "white" : "colour";
      if (slot.mode === "colour") {
        const [r8, g8, b8] = slot.rgb;
        this._mix = { r: Math.round(r8 / 2.55), g: Math.round(g8 / 2.55), b: Math.round(b8 / 2.55),
          saturation: 0, power: slot.b };
      }
      this._echoUntil = Date.now() + 7000;
      this._call("light", "turn_on", { entity_id: lightId, ...data });
      this._sig = null; this._render();
    }));
  }

  _wireDesk(mode) {
    const r = this.shadowRoot;
    const lightId = this._config.light;
    r.querySelector(".mode-white")?.addEventListener("click", () => {
      this._mode = "white"; this._sig = null; this._render();
    });
    r.querySelector(".mode-colour")?.addEventListener("click", () => {
      this._mode = "colour"; this._mix = null; this._mixKey = null;
      this._sig = null; this._render();
    });
    if (mode !== "colour" || !this._mix) return;

    const paint = () => {
      const m = this._mix;
      const cmd = mixToCommand(m, { power: m.power });
      const sw = r.querySelector(".bigswatch");
      if (sw) sw.style.background = cmd.off ? "transparent" : `rgb(${cmd.rgb_color.join(",")})`;
      const sum = r.querySelector(".desksum");
      if (sum) {
        sum.textContent = cmd.off ? "off"
          : `${cmd.brightness_pct}% · sat ${Math.round(cmd.saturation * 100)}%`
            + (cmd.hue == null ? " · white" : ` · hue ${Math.round(cmd.hue)}°`);
      }
      const vals = { r: m.r, g: m.g, b: m.b, p: m.power,
        s: cmd.off ? 0 : Math.round(cmd.saturation * 100) };
      r.querySelectorAll(".fr").forEach((inp) => {
        const v = vals[inp.dataset.ch];
        if (v == null) return;
        if (document.activeElement !== inp && r.activeElement !== inp) inp.value = v;
        inp.parentElement.querySelector(".fv").textContent = v;
      });
      const trap = r.querySelector(".trap");
      if (trap) trap.hidden = cmd.off || cmd.saturation >= RGB_WHITE_TRAP_SATURATION;
    };

    const send = () => {
      const m = this._mix;
      const cmd = mixToCommand(m, { power: m.power });
      this._echoUntil = Date.now() + 7000;
      if (cmd.off) this._call("light", "turn_off", { entity_id: lightId });
      else this._call("light", "turn_on",
        { entity_id: lightId, rgb_color: cmd.rgb_color, brightness_pct: cmd.brightness_pct });
    };

    const release = () => {
      if (!this._dragging) return;
      this._dragging = false; this._sig = null; this._render();
    };

    r.querySelectorAll(".fr").forEach((inp) => {
      inp.addEventListener("pointerdown", () => { this._dragging = true; });
      inp.addEventListener("input", (e) => {
        this._dragging = true;
        const v = Number(e.target.value);
        const ch = e.target.dataset.ch;
        if (ch === "s") this._mix = { ...setSaturation(this._mix, v / 100), power: this._mix.power };
        else if (ch === "p") this._mix = { ...this._mix, power: v };
        else this._mix = { ...this._mix, [ch]: v };
        paint();
      });
      inp.addEventListener("change", () => { this._dragging = false; send(); });
      inp.addEventListener("pointercancel", release);
      inp.addEventListener("blur", release);
    });

    r.querySelector(".to-white")?.addEventListener("click", () => {
      this._mode = "white"; this._sig = null; this._render();
    });
    paint();
  }

  _wire(fan, speed, light, level, kelvin, power) {
    const r = this.shadowRoot;
    if (power?.available) {
      r.querySelector(".switch-power")?.addEventListener("click", () =>
        this._call("switch", power.service, { entity_id: this._config.switch }));
    }
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
    // Live feedback during the drag, one service call on release. Re-renders are
    // suppressed while dragging so an incoming state update cannot yank the thumb
    // out from under a finger.
    const range = r.querySelector(".range");
    if (range) {
      const paint = (v) => {
        r.querySelector(".fill").style.setProperty("--v", `${v}%`);
        const t = r.querySelector(".thumb");
        t.style.setProperty("--v", `${v}%`);
        t.querySelector(".readout").textContent = `${v}%`;
        const typed = r.querySelector(".typed");
        if (typed) typed.textContent = `${v}%`;
      };
      range.addEventListener("pointerdown", () => { this._dragging = true; });
      // A drag that ends without a `change` - cancelled by a scroll gesture, or the
      // finger lifting off the element - must still release the guard, or the card
      // stops following HA for good.
      const release = () => {
        if (!this._dragging) return;
        this._dragging = false;
        this._sig = null;
        this._render();
      };
      range.addEventListener("pointercancel", release);
      range.addEventListener("blur", release);
      range.addEventListener("input", (e) => { this._dragging = true; paint(Number(e.target.value)); });
      range.addEventListener("change", (e) => {
        this._dragging = false;
        this._call("light", "turn_on", { entity_id: lightId, brightness_pct: Number(e.target.value) });
      });
    }

    // Tap the percentage to type one. A number is faster than a drag for "make it 20".
    r.querySelector(".typed")?.addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const startPct = level.pct ?? level.restore ?? 50;
      const input = document.createElement("input");
      input.type = "number";
      input.inputMode = "numeric";          // a number pad, not a full keyboard
      input.enterKeyHint = "done";
      input.min = "1"; input.max = "100";
      input.className = "typein";
      input.value = String(startPct);
      this._editing = true;
      btn.replaceWith(input);
      input.focus();
      input.select?.();

      // One commit, however it ends. Enter, blur and the element being torn down
      // can all arrive for the same edit, and only the first one counts. Nothing
      // is sent when the value did not change, so dismissing the keyboard is not
      // a service call.
      let done = false;
      const finish = (send) => {
        if (done) return;
        done = true;
        this._editing = false;
        const v = Math.round(Number(input.value));
        if (send && Number.isFinite(v)) {
          const pct = Math.max(1, Math.min(100, v));
          if (pct !== startPct) {
            this._call("light", "turn_on", { entity_id: lightId, brightness_pct: pct });
          }
        }
        this._sig = null;
        this._render();
      };
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
        if (ev.key === "Escape") finish(false);
      });
      input.addEventListener("blur", () => finish(true));
    });

    const ktemp = r.querySelector(".ktemp");
    if (ktemp) {
      const kOut = r.querySelector(".kvalue");
      ktemp.addEventListener("input", (e) => {
        this._dragging = true;
        if (kOut) kOut.textContent = `${e.target.value} K`;
      });
      const kRelease = () => {
        if (!this._dragging) return;
        this._dragging = false;
        this._sig = null;
        this._render();
      };
      ktemp.addEventListener("pointercancel", kRelease);
      ktemp.addEventListener("blur", kRelease);
      ktemp.addEventListener("change", (e) => {
        this._dragging = false;
        this._call("light", "turn_on", { entity_id: lightId, color_temp_kelvin: Number(e.target.value) });
      });
    }
  }
}

const STYLE = `
  .presets { padding: 8px 0 4px; border-top: 1px solid var(--divider-color, #333); }
  .slots { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
  .slot { position: relative; aspect-ratio: 1; min-height: 34px; border-radius: 8px; cursor: pointer;
          border: 1px solid rgba(255,255,255,.18); background: var(--sw, transparent); padding: 0; }
  .slot.empty { border-style: dashed; border-color: var(--divider-color, #555); background: none;
                color: var(--secondary-text-color); font-size: 16px; }
  .slot.armed { outline: 2px solid var(--accent-color, #ff9900); outline-offset: 1px; }
  .slot .lvl { position: absolute; right: 3px; bottom: 2px; font-size: 9px; font-weight: 600;
               color: rgba(0,0,0,.62); font-variant-numeric: tabular-nums; }
  .phead { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
  .phead .hint { flex: 1; font-size: 11px; color: var(--secondary-text-color); }
  .psave { font: inherit; font-size: 11px; padding: 3px 12px; border-radius: 4px; cursor: pointer;
           border: 1px solid var(--accent-color, #ff9900); background: none;
           color: var(--primary-text-color); }
  .psave.cancel { border-color: var(--divider-color, #555); color: var(--secondary-text-color); }
  .pnote { font-size: 11px; color: var(--warning-color, #ffa726); margin-top: 4px; }
  .modes { display: flex; gap: 4px; margin-top: 7px; }
  .modes button { font: inherit; font-size: 11px; padding: 2px 9px; border-radius: 4px; cursor: pointer;
                  border: 1px solid var(--divider-color, #555); background: none;
                  color: var(--secondary-text-color); }
  .modes button.on { border-color: var(--accent-color, #ff9900); color: var(--primary-text-color); }
  .desk { display: grid; gap: 4px; padding: 2px 0 12px; }
  .deskhead { display: flex; align-items: center; gap: 9px; margin-bottom: 3px; }
  .bigswatch, .gotswatch { width: 30px; height: 30px; border-radius: 7px; flex: none; display: block;
               box-shadow: inset 0 0 0 1px rgba(255,255,255,.22); }
  .pair { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .cap { font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase;
         color: var(--secondary-text-color); }
  .sums { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .gotsum { font-size: 10.5px; color: var(--secondary-text-color); opacity: .75;
            font-variant-numeric: tabular-nums; }
  .desksum { font-size: 11.5px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .fader { display: grid; grid-template-columns: 50px 1fr 32px; align-items: center; gap: 8px; }
  .fl { font-size: 10.5px; letter-spacing: .06em; color: var(--secondary-text-color); }
  .fv { font-size: 11.5px; text-align: right; font-variant-numeric: tabular-nums; }
  .fr { width: 100%; min-height: 30px; margin: 0; touch-action: none; }
  .f-r .fr { accent-color: #e53935; }
  .f-g .fr { accent-color: #43a047; }
  .f-b .fr { accent-color: #1e88e5; }
  .f-s .fr { accent-color: var(--secondary-text-color, #9b9b9b); }
  .f-p .fr { accent-color: var(--accent-color, #ff9900); }
  .trap { font-size: 11px; color: var(--warning-color, #ffa726); display: flex; gap: 8px;
          align-items: center; flex-wrap: wrap; }
  .trap[hidden] { display: none; }
  .trap button { font: inherit; font-size: 11px; cursor: pointer; padding: 1px 8px; border-radius: 4px;
                 border: 1px solid currentColor; background: none; color: inherit; }
  :host { display: block; }
  ha-card { padding: 10px 12px 12px; display: block; }
  .hd { font-size: 14px; font-weight: 600; display: flex; align-items: baseline; gap: 8px;
        padding-bottom: 8px; border-bottom: 1px solid var(--divider-color, #444); }
  .lay { margin-left: auto; font-size: 10.5px; font-weight: 400; letter-spacing: .04em;
         text-transform: uppercase; color: var(--secondary-text-color); }

  .block { display: flex; gap: 12px; padding: 12px 0; align-items: stretch;
           border-bottom: 1px solid var(--divider-color, #333); }
  .block:last-child { border-bottom: 0; }
  .block.off { opacity: .62; }
  /* A switch has one line of control and no track under it, so it does not need
     the breathing room a fan's or a light's block does. Measured: at the block
     padding those need, a plug tile overflowed its two rows by 8px and grew a
     scrollbar. */
  .block.switch { padding: 6px 0; }
  .block.switch.gone .power { cursor: not-allowed; }
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
  .bar .range { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer;
                touch-action: none; }
  .thumb { position: absolute; left: 0; right: 0; bottom: calc(var(--v) - 2px); height: 4px;
           background: var(--accent-color, #ff9900); pointer-events: none; }
  .readout { position: absolute; right: 4px; bottom: 5px; font-size: 11px; font-weight: 600;
             color: var(--accent-color, #ff9900); font-variant-numeric: tabular-nums;
             text-shadow: 0 1px 3px rgba(0,0,0,.8); }
  ha-card.horizontal .thumb { left: calc(var(--v) - 2px); right: auto; top: 0; bottom: 0;
                              width: 4px; height: auto; }
  ha-card.horizontal .readout { right: auto; left: 7px; bottom: 50%; transform: translateY(50%); }
  .typed { font: inherit; font-size: 11.5px; color: var(--secondary-text-color); cursor: pointer;
           background: none; border: 0; border-bottom: 1px dotted var(--secondary-text-color);
           padding: 0 1px; }
  .typein { font: inherit; font-size: 12px; width: 62px; padding: 1px 4px;
            color: var(--primary-text-color); background: var(--secondary-background-color, #1c2126);
            border: 1px solid var(--accent-color, #ff9900); border-radius: 3px; }
  .none { display: grid; place-items: center; font-size: 10.5px; text-align: center;
          color: var(--secondary-text-color); border: 1px dashed var(--divider-color, #555);
          border-radius: 6px; padding: 4px; }
  .kel { margin-top: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%;
         margin-right: 5px; vertical-align: baseline;
         box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }
  .ktemp.idle { opacity: .4; }
  .klabel { font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase;
            color: var(--secondary-text-color); }
  .ktemp { width: 100%; max-width: 220px; accent-color: var(--accent-color, #ff9900); }

  /* Horizontal when the card is wide OR the window is short. The class is set in
     JS, which owns the decision - a parallel container query would be a second
     source of truth and the two disagreed once already. */
  ha-card.horizontal .block { align-items: center; }
  ha-card.horizontal .track { width: auto; flex: 1 1 auto; flex-direction: row; min-height: 0; }
  ha-card.horizontal .seg { min-height: 34px; }
  ha-card.horizontal .bar { min-height: 34px; }
  ha-card.horizontal .fill { top: 0; right: auto; width: var(--v); height: auto; }
  ha-card.horizontal .side { flex: 1 1 46%; min-width: 0; }
  ha-card.horizontal .track { flex: 1 1 46%; min-width: 150px; }
`;

// Guarded: the panel and a Lovelace resource can both load this module, and a
// second define would throw and take the whole module down with it.
if (!customElements.get("appliance-card")) customElements.define("appliance-card", ApplianceCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "appliance-card",
  name: "Appliance (level 2)",
  description: "Controls built from measured capability: notched speeds, real kelvin, honest off-states.",
});
