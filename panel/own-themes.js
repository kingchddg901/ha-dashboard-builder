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
});
