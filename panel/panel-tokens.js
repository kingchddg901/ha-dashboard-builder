/**
 * The panel's own theme tokens - what the mined LCARS vocabulary cannot say:
 * surfaces, edges, corners, and which FRAME draws the panel. Written by hand,
 * in token-theme-kit's group shape, so the theme tab builds a control for each
 * one the same way it does for ./token-groups.js.
 *
 * `frame` is the master token. It picks how the panel draws its structure
 * (LCARS elbows, or cockpit consoles), and a token with `byFrame` takes that
 * frame's value as its default - so switching the frame alone reshapes the
 * panel, and each value can still be set by hand on top.
 *
 * Every token is named for what it IS, never for the frame that first used it:
 * a frame decides which tokens it draws with, and the next frame to cut a corner
 * reuses `chamfer` rather than growing its own. A test holds keys and labels to
 * that.
 *
 * `default` is the LCARS frame as it was before these tokens existed. A token
 * with `follows` has no value of its own until one is chosen: it takes the
 * named token's (theme-core baseValues), and in CSS it falls back to that
 * token's variable, so an HA theme or a picked theme still reaches it.
 */

/**
 * The frames, and the tokens each one does NOT draw with - so the theme tab can
 * say so on the control rather than offer a setting that changes nothing. Every
 * other token, a frame uses. MEASURED, not reasoned: each token was set to a
 * loud value in each frame, in every state (desk, Edit, an open sheet, phone,
 * phone Edit), and a token is skipped only if nothing on screen changed. The
 * greeble and light tokens drive generated art only the cockpit draws.
 */
export const FRAMES = Object.freeze([
  { value: "lcars", label: "LCARS", skips: ["chamfer", "greeble-density", "light-angle", "light-intensity"] },
  { value: "cockpit", label: "Cockpit", skips: ["outer-radius", "inner-radius", "tile-radius", "tile-radius-start", "tile-shadow"] },
  { value: "blueprint", label: "Blueprint", skips: ["ui-secondary-text", "ui-tertiary-text", "card-top", "card-top-text",
    "outer-radius", "inner-radius", "chamfer", "greeble-density", "light-angle", "light-intensity"] },
  { value: "terminal", label: "Terminal", skips: ["ui-secondary-text", "ui-tertiary-text", "card-top", "card-top-text",
    "outer-radius", "inner-radius", "chamfer", "greeble-density", "light-angle", "light-intensity"] },
  { value: "braun", label: "Braun", skips: ["outer-radius", "inner-radius", "chamfer", "greeble-density", "light-angle", "light-intensity"] },
  { value: "hud", label: "HUD", skips: ["ui-secondary-text", "ui-tertiary-text", "card-top", "card-top-text",
    "outer-radius", "inner-radius", "greeble-density", "light-angle", "light-intensity"] },
  { value: "glass", label: "Glass", skips: ["ui-secondary-text", "ui-tertiary-text", "card-top", "card-top-text",
    "outer-radius", "inner-radius", "chamfer", "greeble-density", "light-angle", "light-intensity"] },
  { value: "fieldnotes", label: "Field notes", skips: ["ui-secondary-text", "ui-tertiary-text", "card-top", "card-top-text",
    "outer-radius", "inner-radius", "tile-radius", "tile-radius-start", "chamfer", "tab-active", "tile-shadow", "greeble-density", "light-angle", "light-intensity"] },
]);

/**
 * Mined LCARS tokens this panel draws with in NO frame (yet). HA's LCARS theme
 * uses them for its own cards; they stay declared so a frame can pick them up.
 */
export const NOT_DRAWN = Object.freeze([
  "ui-primary-text", "ui-quaternary", "ui-quaternary-text", "card-mid", "card-mid-text",
  "card-bottom", "card-bottom-text", "settings-card", "horizontal-border", "vertical-border",
]);

export const PANEL_GROUPS = [
  {
    id: "panel-shape", label: "Panel shape", tokens: [
      { key: "frame", type: "select", cssVar: "--db-frame-style", options: FRAMES, default: "lcars", label: "Frame" },
      { key: "tile-radius", type: "number", unit: "px", min: 0, max: 40, step: 1, cssVar: "--db-tile-radius",
        default: 14, byFrame: { blueprint: 0, terminal: 0, braun: 6, hud: 0, glass: 16 }, label: "Tile corners, right" },
      { key: "tile-radius-start", type: "number", unit: "px", min: 0, max: 40, step: 1, cssVar: "--db-tile-radius-start",
        default: 0, byFrame: { braun: 6, glass: 16 }, label: "Tile corners, left" },
      { key: "tab-radius", type: "number", unit: "px", min: 0, max: 30, step: 1, cssVar: "--db-tab-radius",
        default: 0, byFrame: { cockpit: 3, braun: 4, glass: 12 }, label: "Tab corners" },
      { key: "control-radius", type: "number", unit: "px", min: 0, max: 20, step: 1, cssVar: "--db-control-radius",
        default: 20, byFrame: { cockpit: 3, blueprint: 0, terminal: 0, braun: 4, hud: 0, glass: 12, fieldnotes: 0 }, label: "Button corners" },
      /* The round keys inside the cards - a light's power, a TV's. A radius
         past half the key reads as a circle, which is what LCARS wants and what
         every frame got before this token existed; a cockpit wants a square
         key cap instead. Drawn by the cards, not by the panel, which is why it
         is the one shape token the panel's own probe cannot see. */
      { key: "key-radius", type: "number", unit: "px", min: 0, max: 50, step: 1, cssVar: "--db-key-radius",
        default: 50, byFrame: { cockpit: 3, blueprint: 0, terminal: 0, braun: 8, hud: 0, glass: 16, fieldnotes: 2 },
        label: "Round button corners" },
      { key: "chamfer", type: "number", unit: "px", min: 0, max: 40, step: 1, cssVar: "--db-chamfer",
        default: 14, byFrame: { hud: 10 }, label: "Chamfer" },
    ],
  },
  {
    id: "panel-surfaces", label: "Panel surfaces", tokens: [
      { key: "tile-surface", type: "color", cssVar: "--db-tile-surface", follows: "background", label: "Tile surface" },
      { key: "tile-border", type: "color", cssVar: "--db-tile-border", follows: "ui-primary", label: "Tile border" },
      { key: "tab-active", type: "color", cssVar: "--db-tab-active", follows: "ui-accent", label: "Active tab" },
      { key: "tab-active-text", type: "color", cssVar: "--db-tab-active-text", follows: "ui-accent-text", label: "Active tab text" },
      { key: "tile-shadow", type: "raw", cssVar: "--db-tile-shadow", default: "none",
        byFrame: { braun: "0 1px 2px rgba(0, 0, 0, 0.08)", glass: "0 10px 30px rgba(0, 0, 0, 0.25)" }, label: "Tile shadow and bevel" },
      { key: "greeble-density", type: "number", input: "range", unit: "%", min: 0, max: 100, step: 5,
        cssVar: "--db-greeble-density", default: 0, byFrame: { cockpit: 60 }, label: "Greeble density" },
    ],
  },
  {
    /*
     * What happened to this surface. The history is ORDERED events (see
     * material-art.js) - the theme picks a named one, and a storyboard editor
     * could later feed the same generator an arbitrary list without changing
     * a token. Coverage and severity are separate because "three deep blooms"
     * and "a light speckle everywhere" are different plates.
     */
    id: "panel-wear",
    label: "Wear",
    tokens: [
      { key: "wear-history", type: "select", cssVar: "--db-wear-history", default: "none",
        options: [
          { value: "none", label: "Factory fresh" },
          { value: "hangar-queen", label: "Hangar queen" },
          { value: "engine-room", label: "Engine room" },
          { value: "battle-scarred", label: "Battle scarred" },
        ], label: "History" },
      { key: "wear-density", type: "number", min: 0, max: 1, step: 0.05, cssVar: "--db-wear-density",
        default: 0.4, label: "How much corroded" },
      { key: "wear-progress", type: "number", min: 0, max: 1, step: 0.05, cssVar: "--db-wear-progress",
        default: 0.4, label: "How far it got" },
      { key: "wear-rust", type: "color", cssVar: "--db-wear-rust", default: "#8a4622", label: "Corrosion" },
      { key: "wear-soot", type: "color", cssVar: "--db-wear-soot", default: "#120e0c", label: "Soot" },
      { key: "wear-heat", type: "color", cssVar: "--db-wear-heat", default: "#4a3a52", label: "Heat stain" },
    ],
  },
  {
    /* One light for everything a frame draws as lit - greebles, plate bevels,
       key bevels - so nothing is lit from two directions at once. */
    id: "panel-light", label: "Light", tokens: [
      { key: "light-angle", type: "number", input: "range", unit: "deg", min: 0, max: 355, step: 5,
        cssVar: "--db-light-angle", default: 0, label: "Light angle" },
      { key: "light-intensity", type: "number", input: "range", unit: "%", min: 0, max: 100, step: 5,
        cssVar: "--db-light-intensity", default: 60, label: "Light intensity" },
    ],
  },
];
