/**
 * Starting themes written for this panel, beside the 24 mined LCARS ones in
 * ./themes.js. Each is token -> value over the same tokens (./token-groups.js
 * and ./panel-tokens.js); a token it leaves out keeps its base. A test holds
 * every key to a declared token and every theme to its own contrast checks.
 */

export const OWN_THEMES = Object.freeze({
  /**
   * After Vacuum Agent's Black One - Poe Dameron's T-70: matte warm black,
   * burnt-oxide markings, mustard for caution. The colours are Black One's
   * (VA gallery/themes/black-one-58.json), made opaque where VA layers them at
   * low alpha, since a colour control cannot show alpha. The cockpit frame
   * brings the shape.
   */
  "Black One": Object.freeze({
    frame: "cockpit",
    background: "#0a0a09", "background-text": "#e8e3dc",
    "ui-primary": "#1c1a18", "ui-primary-text": "#e8e3dc",
    "ui-secondary": "#1c1a18", "ui-secondary-text": "#e8e3dc",
    "ui-tertiary": "#d7b23c", "ui-tertiary-text": "#120703",
    "ui-quaternary": "#2a2724", "ui-quaternary-text": "#e8e3dc",
    "ui-accent": "#c9541e", "ui-accent-text": "#120703",
    "card-top": "#1c1a18", "card-top-text": "#e4884f",
    "card-mid": "#1c1a18", "card-mid-text": "#e8e3dc",
    "card-button": "#2a2724", "card-button-text": "#e8e3dc",
    "card-bottom": "#1c1a18", "card-bottom-text": "#e8e3dc",
    "settings-card": "#2a2724",
    success: "#7fa06b", warning: "#d7b23c", error: "#d8434e",
    "tile-surface": "#141312", "tile-border": "#2e2b28",
    "tab-active": "#381c0e", "tab-active-text": "#f0b48c",
    font: "Bahnschrift", "fallback-font": "DIN Alternate",
  }),

  /** Drafting blue, white line work, pencil yellow for markup (the tools). */
  "Blueprint": Object.freeze({
    frame: "blueprint",
    background: "#0d3b6f", "background-text": "#e6f1ff",
    "ui-primary": "#9cc8f5", "ui-primary-text": "#0d3b6f",
    "ui-secondary": "#0d3b6f", "ui-secondary-text": "#e6f1ff",
    "ui-tertiary": "#ffd479", "ui-tertiary-text": "#0d3b6f",
    "ui-quaternary": "#0d3b6f", "ui-quaternary-text": "#e6f1ff",
    "ui-accent": "#e6f1ff", "ui-accent-text": "#0d3b6f",
    "card-top": "#0d3b6f", "card-top-text": "#e6f1ff", "card-mid": "#0d3b6f", "card-mid-text": "#e6f1ff",
    "card-button": "#0d3b6f", "card-button-text": "#e6f1ff", "card-bottom": "#0d3b6f", "card-bottom-text": "#e6f1ff",
    "settings-card": "#0d3b6f",
    success: "#7dffb0", warning: "#ffd479", error: "#ff9a8f",
    "tile-surface": "#0d3b6f", "tile-border": "#cfe6ff", "tab-active": "#e6f1ff", "tab-active-text": "#0d3b6f",
    font: "Consolas, Menlo", "fallback-font": "monospace",
  }),

  /**
   * A ship's computer on a phosphor screen: everything in one green. Errors
   * break the one-hue rule on purpose - a failure has to be told apart from
   * success at a glance, not only by a mark.
   */
  "Terminal": Object.freeze({
    frame: "terminal",
    background: "#030a03", "background-text": "#3dff6e",
    "ui-primary": "#1f8a3c", "ui-primary-text": "#030a03",
    "ui-secondary": "#030a03", "ui-secondary-text": "#3dff6e",
    "ui-tertiary": "#3dff6e", "ui-tertiary-text": "#030a03",
    "ui-quaternary": "#0b2410", "ui-quaternary-text": "#3dff6e",
    "ui-accent": "#3dff6e", "ui-accent-text": "#030a03",
    "card-top": "#030a03", "card-top-text": "#3dff6e", "card-mid": "#030a03", "card-mid-text": "#3dff6e",
    "card-button": "#030a03", "card-button-text": "#3dff6e", "card-bottom": "#030a03", "card-bottom-text": "#3dff6e",
    "settings-card": "#0b2410",
    success: "#3dff6e", warning: "#d9ff66", error: "#ff5c5c",
    "tile-surface": "#030a03", "tile-border": "#1f8a3c", "tab-active": "#3dff6e", "tab-active-text": "#030a03",
    font: "Consolas, Menlo", "fallback-font": "monospace",
  }),

  /** Dieter Rams: warm greys, white panels, one orange for what is on. The first light theme. */
  "Braun": Object.freeze({
    frame: "braun",
    background: "#e9e7e1", "background-text": "#2a2a28",
    "ui-primary": "#cfccc3", "ui-primary-text": "#2a2a28",
    "ui-secondary": "#d6d3cb", "ui-secondary-text": "#2a2a28",
    "ui-tertiary": "#2a2a28", "ui-tertiary-text": "#f3f1ea",
    "ui-quaternary": "#d6d3cb", "ui-quaternary-text": "#2a2a28",
    "ui-accent": "#f05a28", "ui-accent-text": "#1a1a18",
    "card-top": "#e9e7e1", "card-top-text": "#2a2a28", "card-mid": "#e9e7e1", "card-mid-text": "#2a2a28",
    "card-button": "#f3f1ea", "card-button-text": "#2a2a28", "card-bottom": "#d6d3cb", "card-bottom-text": "#2a2a28",
    "settings-card": "#d6d3cb",
    success: "#2f7d32", warning: "#9a6700", error: "#c62828",
    "tile-surface": "#fbfaf6", "tile-border": "#d0cdc4", "tab-active": "#f3f1ea", "tab-active-text": "#2a2a28",
    font: "Helvetica Neue, Arial", "fallback-font": "Roboto",
  }),

  /** A holographic overlay: one cyan glow, amber for the tools. */
  "HUD": Object.freeze({
    frame: "hud",
    background: "#020b14", "background-text": "#8fe9ff",
    "ui-primary": "#4fd8ff", "ui-primary-text": "#020b14",
    "ui-secondary": "#020b14", "ui-secondary-text": "#8fe9ff",
    "ui-tertiary": "#ffc44f", "ui-tertiary-text": "#020b14",
    "ui-quaternary": "#07233a", "ui-quaternary-text": "#8fe9ff",
    "ui-accent": "#4fd8ff", "ui-accent-text": "#020b14",
    "card-top": "#020b14", "card-top-text": "#4fd8ff", "card-mid": "#07233a", "card-mid-text": "#8fe9ff",
    "card-button": "#07233a", "card-button-text": "#8fe9ff", "card-bottom": "#07233a", "card-bottom-text": "#8fe9ff",
    "settings-card": "#07233a",
    success: "#4fffb0", warning: "#ffc44f", error: "#ff5c7a",
    "tile-surface": "#041421", "tile-border": "#4fd8ff", "tab-active": "#0f3a52", "tab-active-text": "#ffffff",
    font: "Bahnschrift, Segoe UI", "fallback-font": "Roboto",
  }),

  /** Calm and everyday: frosted panels on dusk blue, periwinkle and rose in the backdrop. */
  "Glass": Object.freeze({
    frame: "glass",
    background: "#1f2335", "background-text": "#f4f5fb",
    "ui-primary": "#3a4060", "ui-primary-text": "#f4f5fb",
    "ui-secondary": "#1f2335", "ui-secondary-text": "#f4f5fb",
    "ui-tertiary": "#d98a93", "ui-tertiary-text": "#1f2335",
    "ui-quaternary": "#2c3150", "ui-quaternary-text": "#f4f5fb",
    "ui-accent": "#8fa4ff", "ui-accent-text": "#1f2335",
    "card-top": "#2c3150", "card-top-text": "#f4f5fb", "card-mid": "#2c3150", "card-mid-text": "#f4f5fb",
    "card-button": "#2c3150", "card-button-text": "#f4f5fb", "card-bottom": "#2c3150", "card-bottom-text": "#f4f5fb",
    "settings-card": "#2c3150",
    success: "#7ee0a8", warning: "#ffd479", error: "#ff8a8a",
    "tile-surface": "#3a4060", "tile-border": "#6b7396", "tab-active": "#4a5378", "tab-active-text": "#ffffff",
    font: "Segoe UI Variable, Segoe UI", "fallback-font": "Roboto",
  }),

  /** E-ink paper: black ink on warm white, ink colours for status. The second light theme. */
  "Field notes": Object.freeze({
    frame: "fieldnotes",
    background: "#f7f5ef", "background-text": "#1c1c1a",
    "ui-primary": "#1c1c1a", "ui-primary-text": "#f7f5ef",
    "ui-secondary": "#f7f5ef", "ui-secondary-text": "#1c1c1a",
    "ui-tertiary": "#1c1c1a", "ui-tertiary-text": "#f7f5ef",
    "ui-quaternary": "#e8e5dc", "ui-quaternary-text": "#1c1c1a",
    "ui-accent": "#1c1c1a", "ui-accent-text": "#f7f5ef",
    "card-top": "#f7f5ef", "card-top-text": "#1c1c1a", "card-mid": "#efece4", "card-mid-text": "#1c1c1a",
    "card-button": "#f7f5ef", "card-button-text": "#1c1c1a", "card-bottom": "#efece4", "card-bottom-text": "#1c1c1a",
    "settings-card": "#efece4",
    success: "#2e6b2e", warning: "#8a6d00", error: "#a3261f",
    "tile-surface": "#f7f5ef", "tile-border": "#1c1c1a", "tab-active": "#e8e5dc", "tab-active-text": "#1c1c1a",
    font: "Georgia", "fallback-font": "Noto Serif",
  }),
});
