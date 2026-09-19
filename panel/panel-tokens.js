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
 * `default` is the LCARS frame as it was before these tokens existed. A token
 * with `follows` has no value of its own until one is chosen: it takes the
 * named token's (theme-core baseValues), and in CSS it falls back to that
 * token's variable, so an HA theme or a picked theme still reaches it.
 */

export const FRAMES = Object.freeze([
  { value: "lcars", label: "LCARS" },
  { value: "cockpit", label: "Cockpit" },
]);

/** Instrument-panel bevel: a lit top edge, a dark lip, and a deep drop shadow. */
const BEVEL = "inset 0 1px 0 rgba(232, 227, 220, 0.07), inset 0 -1px 0 rgba(0, 0, 0, 0.7), "
  + "0 1px 2px rgba(0, 0, 0, 0.62), 0 6px 18px rgba(0, 0, 0, 0.5)";

export const PANEL_GROUPS = [
  {
    id: "panel-shape", label: "Panel shape", tokens: [
      { key: "frame", type: "select", cssVar: "--db-frame-style", options: FRAMES, default: "lcars", label: "Frame" },
      { key: "tile-radius", type: "number", unit: "px", min: 0, max: 40, step: 1, cssVar: "--db-tile-radius",
        default: 14, byFrame: { cockpit: 4 }, label: "Tile corners, right" },
      { key: "tile-radius-start", type: "number", unit: "px", min: 0, max: 40, step: 1, cssVar: "--db-tile-radius-start",
        default: 0, byFrame: { cockpit: 4 }, label: "Tile corners, left" },
      { key: "tab-radius", type: "number", unit: "px", min: 0, max: 30, step: 1, cssVar: "--db-tab-radius",
        default: 0, byFrame: { cockpit: 3 }, label: "Tab corners" },
      { key: "control-radius", type: "number", unit: "px", min: 0, max: 20, step: 1, cssVar: "--db-control-radius",
        default: 20, byFrame: { cockpit: 3 }, label: "Button corners" },
      { key: "chamfer", type: "number", unit: "px", min: 0, max: 40, step: 1, cssVar: "--db-chamfer",
        default: 14, label: "Chamfer (cockpit frame)" },
    ],
  },
  {
    id: "panel-surfaces", label: "Panel surfaces", tokens: [
      { key: "tile-surface", type: "color", cssVar: "--db-tile-surface", follows: "background", label: "Tile surface" },
      { key: "tile-border", type: "color", cssVar: "--db-tile-border", follows: "ui-primary", label: "Tile border" },
      { key: "tab-active", type: "color", cssVar: "--db-tab-active", follows: "ui-accent", label: "Active tab" },
      { key: "tab-active-text", type: "color", cssVar: "--db-tab-active-text", follows: "ui-accent-text", label: "Active tab text" },
      { key: "tile-shadow", type: "raw", cssVar: "--db-tile-shadow", default: "none", byFrame: { cockpit: BEVEL },
        label: "Tile shadow and bevel" },
    ],
  },
];
