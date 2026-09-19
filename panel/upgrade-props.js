/**
 * Properties set on the panel before its class was defined.
 *
 * Home Assistant loads a custom panel with a <script type="module"> tag and
 * creates the element when that tag's `load` event fires. For a module with
 * top-level await - ./loader.js awaits current.json, then the tree - `load`
 * fires BEFORE the awaits finish. So on a slow (uncached) load HA creates
 * <dashboard-builder-panel> while it is still undefined, and sets `hass`,
 * `panel`, `narrow` and `route` on it as plain data properties. When the class
 * is defined and the element upgrades, those own properties shadow the class's
 * setters: `set hass` never runs, nothing renders, and the page is HA's black
 * background. A cached reload wins the race, a hard refresh loses it.
 *
 * The fix is the standard one for custom elements: on connect, take each such
 * own property off the instance and assign it again, through the setter. No DOM.
 */

/** The panel's properties in replay order: `hass` last, since it starts the load. */
export const PANEL_PROPS = Object.freeze(["panel", "narrow", "route", "hass"]);

/** Replay values stored on `el` itself before its class's accessors existed. */
export function upgradeProperties(el, names = PANEL_PROPS) {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(el, name)) continue;
    const value = el[name];
    delete el[name];
    el[name] = value;
  }
}
