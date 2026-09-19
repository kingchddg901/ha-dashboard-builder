/**
 * Fallbacks for the LCARS token vocabulary, one per token in
 * ../tokens/lcars/core-tokens.json (mined from the installed LCARS themes by
 * tools/mine-lcars-theme.py). A test holds this list to that file.
 *
 * Every colour the panel paints is `var(--lcars-..., <fallback>)`: when the
 * active HA theme is an LCARS theme it defines these variables and wins;
 * otherwise the panel still renders as LCARS Transporter. The HA theme is a
 * layer on top of the defaults, not a requirement.
 */

export const TOKENS = Object.freeze({
  "--lcars-ui-primary": "#2c374b",
  "--lcars-ui-primary-text": "#ffffff",
  "--lcars-ui-secondary": "#6e748c",
  "--lcars-ui-secondary-text": "#000000",
  "--lcars-ui-tertiary": "#fa6851",
  "--lcars-ui-tertiary-text": "#000000",
  "--lcars-ui-quaternary": "#2c374b",
  "--lcars-ui-quaternary-text": "#ffffff",
  "--lcars-ui-accent-color": "#ff7700",
  "--lcars-ui-accent-text": "#000000",
  "--lcars-background-color": "#000000",
  "--lcars-background-text": "#ffffff",
  "--lcars-card-top-color": "#51596c",
  "--lcars-card-top-text": "#ffffff",
  "--lcars-card-mid-color": "#51596c",
  "--lcars-card-mid-text": "#ffffff",
  "--lcars-card-button-color": "#2a7092",
  "--lcars-card-button-text": "#ffffff",
  "--lcars-card-bottom-color": "#2c374b",
  "--lcars-card-bottom-text": "#ffffff",
  "--lcars-settings-card-color": "#69768d",
  "--success-color": "#33cc99",
  "--warning-color": "#360000",
  "--error-color": "#ffaa00",
  "--lcars-vertical-border": "35",
  "--lcars-horizontal-border": "10",
  "--lcars-outer-radius": "34",
  "--lcars-inner-radius": "20",
  "--lcars-font": "Tungsten",
  "--lcars-fallback-font": "Antonio",
});

/**
 * `var(--x, fallback)`. The LCARS themes define the shape tokens WITH units
 * (`lcars-outer-radius: 34px`); the mined file keeps the bare number, so the
 * fallback puts the unit back.
 */
export function tokenVar(cssVar) {
  if (!(cssVar in TOKENS)) throw new Error(`unknown token ${cssVar}`);
  const v = TOKENS[cssVar];
  return `var(${cssVar}, ${/^\d+$/.test(v) ? `${v}px` : v})`;
}
