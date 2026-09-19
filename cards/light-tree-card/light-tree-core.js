/**
 * Light groups as the tree they are - one control that acts on everything
 * beneath it, over parts that are themselves controls. No DOM, no Lovelace.
 *
 * The rules come from ../../docs/placement-conventions.md:
 *
 *   - One recursive shape. A fixture over its bulbs and a zone over its rooms
 *     differ only in depth, so one renderer serves both.
 *   - A group's own report OVER-states what its members can do: HA takes the
 *     union of their colour modes, so Main house claims colour while Kitchen,
 *     inside it, is on/off only. The union is what a parent OFFERS; what every
 *     member can do is what it GUARANTEES; and the difference is made visible
 *     where it applies - the Kitchen row is a bare toggle beside dimmable
 *     siblings - rather than hidden.
 *   - Off, unavailable and unknown are different (design rule 7), and a member
 *     the group names but HA does not have is shown as missing, never dropped.
 */

export const MAX_DEPTH = 6;          // deeper than any real house; stops a loop in a bad config

const pct = (b) => (Number.isFinite(b) ? Math.max(1, Math.round((b / 255) * 100)) : null);

/** One light and, if it is a group, its members - recursively. */
export function lightNode(id, states = {}, seen = new Set(), depth = 0) {
  const st = states[id];
  if (!st) return { id, name: id, state: "missing", missing: true, group: false, dimmable: false, tunable: false, level: null, rgb: null, members: [] };
  const a = st.attributes || {};
  const named = Array.isArray(a.entity_id) ? a.entity_id.filter((m) => String(m).startsWith("light.")) : [];
  const stop = seen.has(id) || depth >= MAX_DEPTH;
  const next = new Set(seen).add(id);
  const modes = Array.isArray(a.supported_color_modes) ? a.supported_color_modes : [];
  const on = st.state === "on";
  return {
    id,
    name: a.friendly_name || id,
    state: st.state,
    missing: false,
    group: named.length > 0,
    dimmable: modes.some((m) => m !== "onoff"),
    // A white temperature or a colour to set - more than a row's drag can do,
    // so the row offers the full control behind "..." (design rule 9).
    tunable: modes.some((m) => m !== "onoff" && m !== "brightness"),
    level: on ? pct(a.brightness) : null,
    rgb: on && Array.isArray(a.rgb_color) ? a.rgb_color.slice(0, 3) : null,
    members: stop ? [] : named.map((m) => lightNode(m, states, next, depth + 1)),
  };
}

/** The bulbs at the bottom of a tree - what actually lights. */
export function leaves(node) {
  if (!node) return [];
  return node.members.length ? node.members.flatMap(leaves) : [node];
}

/**
 * What a parent can promise, from its members rather than its own report.
 * `onOffOnly` names the members that will ignore a brightness, so the parent
 * row can say so instead of offering "20%" and turning the kitchen on at full.
 */
export function promise(node) {
  const ls = leaves(node).filter((l) => !l.missing);
  const flat = ls.filter((l) => !l.dimmable);
  return { total: ls.length, dimmable: ls.length - flat.length, onOffOnly: flat.map((l) => l.name) };
}

/** How many bulbs are lit - the count the group's own on/off hides. */
export function litCount(node) {
  const ls = leaves(node);
  const known = ls.filter((l) => !l.missing && !["unavailable", "unknown"].includes(l.state));
  return { lit: known.filter((l) => l.state === "on").length, total: ls.length, missing: ls.length - known.length };
}

/** Design rule 7's four states, plus missing (named by a group, absent from HA). */
export function rowState(node) {
  if (node.missing) return "unavailable";
  if (node.state === "unavailable") return "unavailable";
  if (node.state === "unknown") return "unknown";
  return node.state === "on" ? "on" : "off";
}

/** The rows to draw: the tree walked depth-first, descending only into open groups. */
export function visibleRows(node, open = new Set(), depth = 0, out = []) {
  if (!node) return out;
  const isOpen = node.members.length > 0 && open.has(node.id);
  out.push({ node, depth, open: isOpen });
  if (isOpen) for (const m of node.members) visibleRows(m, open, depth + 1, out);
  return out;
}

/** Tap: toggle. A group that is on (any member lit) turns everything beneath it off. */
export function toggleCall(node) {
  return { domain: "light", service: node.state === "on" ? "turn_off" : "turn_on", data: { entity_id: node.id } };
}

/** Drag: a brightness, or off at zero. Only offered where something beneath can dim. */
export function levelCall(node, level) {
  const p = Math.round(Number(level));
  if (!(p > 0)) return { domain: "light", service: "turn_off", data: { entity_id: node.id } };
  return { domain: "light", service: "turn_on", data: { entity_id: node.id, brightness_pct: Math.min(100, p) } };
}

/**
 * What a finished gesture on a row means. A press that did not travel is a tap
 * and toggles. A press that travelled is a drag: it sets a level where the row
 * can dim, and does NOTHING where it cannot - a swipe across the kitchen must
 * not switch the kitchen off.
 */
export function gestureResult({ moved = false, canDim = false, level = null } = {}) {
  if (!moved) return "toggle";
  return canDim && level != null ? "level" : "none";
}

/** A pointer position across a row -> a level, 0 at the left edge to 100 at the right. */
export function levelAt(x, left, width) {
  if (!(width > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round(((x - left) / width) * 100)));
}

/** One line for a phone status row. */
export function treeSummary(node) {
  if (!node) return "—";
  if (node.missing) return "not in Home Assistant";
  const s = rowState(node);
  if (s === "unavailable" || s === "unknown") return s;
  if (!node.members.length) return s === "on" ? (node.level != null ? `${node.level}%` : "on") : "off";
  const { lit, total, missing } = litCount(node);
  return `${lit} of ${total} lit${missing ? ` · ${missing} not answering` : ""}`;
}
