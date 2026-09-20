/**
 * <theme-kit-editor> — the reference view (Wave 2).
 *
 * A self-building editor web component: point it at a kit, and it renders one
 * control per token, wired to live preview and persistence. Its LAYOUT (stacked
 * groups) is its own opinion — swap it by writing your own view against
 * `kit.editorModel()`; the model has no layout opinion. Custom control types are
 * drawn via the widget registry (the "plugin for the plugins", `registerWidget`).
 *
 * Usage:
 *   import { defineThemeKitEditor } from "token-theme-kit/element";
 *   defineThemeKitEditor();                       // registers <theme-kit-editor>
 *   const ed = document.createElement("theme-kit-editor");
 *   ed.previewTarget = someCardElement;           // where var(--token) is applied
 *   ed.registerWidget("texture-picker", (c, {onChange, document}) => {...}); // meta-plugin
 *   ed.kit = kit;                                 // triggers load + render
 *
 * Focus-safe: a value change repaints preview + verdicts only, never the inputs,
 * so dragging a control never loses focus. A full rebuild happens only when the
 * token registry itself changes (a group added/removed).
 */
import { createWidgetRegistry } from "./widgets.js";
import { resetValues, groupKeys, isOverridden } from "./reset.js";
import { STYLE } from "./editor-style.js";

export { STYLE };


export class ThemeKitEditor extends HTMLElement {
  constructor() {
    super();
    this._widgets = createWidgetRegistry();
    this._values = {};
    this._kit = null;
    this._preview = null;
    this._previewTarget = null;
    this._unsub = null;
    this._verdictNodes = new Map();
    this._resetNodes = new Map();
    this._inited = false;
    this.attachShadow({ mode: "open" });
  }

  set kit(k) { this._kit = k; this._init(); }
  get kit() { return this._kit; }

  set previewTarget(el) { this._previewTarget = el; this._init(); }
  get previewTarget() { return this._previewTarget; }

  get values() { return { ...this._values }; }
  set values(v) { this._values = { ...(v || {}) }; this._preview?.apply(this._values); this._patchVerdicts(); }

  /** The meta-plugin: register a renderer for a custom control's input type. */
  registerWidget(input, renderer) { return this._widgets.register(input, renderer); }

  connectedCallback() { this._init(); }

  disconnectedCallback() {
    this._unsub?.();
    this._unsub = null;
    this._preview?.flush?.();
    this._inited = false;
  }

  async _init() {
    if (this._inited || !this._kit || !this.isConnected) return;
    this._inited = true;
    const stored = await this._kit.load();
    this._values = { ...stored };
    if (this._previewTarget) this._preview = this._kit.preview(this._previewTarget, this._values);
    // Rebuild fully when the token registry structure changes (a group added/removed).
    this._unsub = this._kit.subscribe(() => this._renderFull());
    this._renderFull();
  }

  _onChange(key, value) {
    this._values = { ...this._values, [key]: value };
    this._preview?.apply(this._values);          // live repaint — no CSS touched
    this._kit.save(this._values);                // persist via the adapter
    this._patchVerdicts();                       // refresh verdicts only (focus-safe)
    this.dispatchEvent(new CustomEvent("change", { detail: { key, values: this.values } }));
  }

  /**
   * The three reset tiers — token (one key), group (a fieldset's keys), all (null).
   *
   * Unlike `_onChange`, this DOES rebuild: a reset changes the inputs' own values,
   * and the inputs are exactly what the focus-safe patch path deliberately leaves
   * alone. A click has already ended the gesture, so there is no focus to lose.
   *
   * A reset that clears nothing writes nothing — see resetValues' `changed`.
   */
  _reset(keys, scope) {
    const { values, changed } = resetValues(this._values, keys);
    if (!changed) return 0;
    this._values = values;
    this._preview?.apply(this._values);
    this._kit.save(this._values);
    this._renderFull();
    this.dispatchEvent(
      new CustomEvent("reset", { detail: { scope, changed, values: this.values } })
    );
    return changed;
  }

  resetToken(key) { return this._reset([key], "token"); }
  resetGroup(groupId) { return this._reset(groupKeys(this._kit.editorModel(this._values), groupId), "group"); }
  resetAll() { return this._reset(null, "all"); }

  /**
   * The part a token's reset button wears. Both the full render and the patch
   * path read it from here: when only the render knew, a token edited in place
   * kept an unmarked reset until something else forced a rebuild, and the
   * editor quietly disagreed with itself about what was set.
   */
  _tokenResetPart(key) {
    return isOverridden(this._values, key) ? "reset reset-token is-set" : "reset reset-token";
  }

  _resetButton({ part, label, title, onClick }) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("part", part);
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }

  _renderFull() {
    const root = this.shadowRoot;
    root.textContent = "";
    this._verdictNodes.clear();
    this._resetNodes.clear();
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);

    const model = this._kit.editorModel(this._values);
    const ctx = { onChange: null, document };
    for (const group of model.groups) {
      const fs = document.createElement("fieldset");
      fs.setAttribute("part", "group");
      const lg = document.createElement("legend");
      lg.setAttribute("part", "group-label");
      lg.textContent = group.label;
      fs.appendChild(lg);
      lg.appendChild(
        this._resetButton({
          part: "reset reset-group",
          label: "reset",
          title: `Reset every token in ${group.label}`,
          onClick: () => this.resetGroup(group.id),
        })
      );
      for (const c of group.controls) {
        const wrap = document.createElement("div");
        wrap.className = "ctl";
        const row = document.createElement("label");
        row.className = "row";
        row.setAttribute("part", "row");
        const name = document.createElement("span");
        name.setAttribute("part", "label");
        name.textContent = c.label;
        const widget = this._widgets.get(c.input)(c, {
          onChange: (v) => this._onChange(c.key, v),
          document,
        });
        row.append(name, widget);
        wrap.appendChild(row);
        // Rendered for every token, like the eufy card's, rather than only for
        // overridden ones: a control that appears and disappears as you edit
        // reflows the row under the cursor. Clearing nothing is a no-op.
        const resetBtn = this._resetButton({
          part: this._tokenResetPart(c.key),
          label: "↺",
          title: `Reset ${c.label}`,
          onClick: () => this.resetToken(c.key),
        });
        this._resetNodes.set(c.key, resetBtn);
        wrap.appendChild(resetBtn);
        const verdicts = document.createElement("div");
        verdicts.className = "verdicts";
        this._verdictNodes.set(c.key, verdicts);
        this._fillVerdicts(verdicts, c.verdicts);
        wrap.appendChild(verdicts);
        fs.appendChild(wrap);
      }
      root.appendChild(fs);
    }

    // Last. Always rendered, never conditional: the one control that has to be
    // there is the one you reach for when everything else has gone wrong.
    root.appendChild(
      this._resetButton({
        part: "reset reset-all",
        label: "Reset all to defaults",
        title: "Clear every override and return every token to its declared default",
        onClick: () => this.resetAll(),
      })
    );
  }

  _patchVerdicts() {
    if (!this._kit) return;
    const model = this._kit.editorModel(this._values);
    for (const group of model.groups) {
      for (const c of group.controls) {
        const node = this._verdictNodes.get(c.key);
        if (node) this._fillVerdicts(node, c.verdicts);
        // An edit makes a token set, so its reset has to say so now - the full
        // render is exactly what this path avoids.
        this._resetNodes.get(c.key)?.setAttribute("part", this._tokenResetPart(c.key));
      }
    }
  }

  _fillVerdicts(container, verdicts) {
    container.textContent = "";
    for (const v of verdicts || []) {
      const d = document.createElement("div");
      d.className = `verdict ${v.level === "error" ? "error" : "warn"}`;
      d.setAttribute("part", "verdict");
      d.textContent = v.message;
      container.appendChild(d);
    }
  }
}

/** Define the custom element (idempotent). Returns the tag name. */
export function defineThemeKitEditor(tag = "theme-kit-editor") {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, ThemeKitEditor);
  }
  return tag;
}
