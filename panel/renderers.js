/**
 * The renderer registry - the CLOSED set of things a tile can hold.
 *
 * A tile names one of these by `kind` and carries its declaration in `config`.
 * Each renderer gives the panel three things:
 *
 *   label    - what the edit UI calls it
 *   summary  - the one line a phone status row shows: { text, state }, where
 *              state is on / off / unavailable / unknown / none (design rule 7)
 *   element  - the full control: either a custom element it loads (`load` +
 *              `tag`), or panel-native HTML (`html`)
 *
 * Summaries come from the cores, so a phone row and the full control can never
 * disagree about what they are looking at.
 */

import { describeEntity } from "../cards/builder-debug-card/capability-core.js";
import { applianceSummary } from "../cards/appliance-card/control-core.js";
import { tvControls, tvSummary } from "../cards/tv-card/tv-core.js";
import { readingOf, summary as readingSummary, robotGlance, relativeTime } from "../cards/readings-card/readings-core.js";
import { lightNode, treeSummary, rowState } from "../cards/light-tree-card/light-tree-core.js";
import { roomsFor, robotName, roomAcrossRobots, lastCleanedAcross } from "../cards/va-room-card/va-room-core.js";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function recordOf(hass, id) {
  const st = id ? hass?.states?.[id] : null;
  if (!st) return null;
  return describeEntity({ entityId: id, entry: hass.entities?.[id] || null, state: st,
    devices: hass.devices || {}, areas: hass.areas || {} });
}

const ABSENT = new Set(["unavailable", "unknown"]);

function applianceRow(hass, cfg) {
  const fan = recordOf(hass, cfg.fan);
  const light = recordOf(hass, cfg.light);
  const levels = hass?.states?.[cfg.last_level || "sensor.light_last_level"]?.attributes?.levels;
  const remembered = cfg.light ? levels?.[cfg.light] || null : null;
  const mode = cfg.speed || (cfg.notches ? "steps" : "auto");
  const text = applianceSummary({ fan, light, remembered, mode, steps: cfg.steps || cfg.notches || null });
  const parts = [fan, light].filter(Boolean);
  const declared = [cfg.fan, cfg.light].filter(Boolean).length;
  let state;
  if (parts.length < declared || (parts.length && parts.every((r) => r.state === "unavailable"))) state = "unavailable";
  else if (parts.some((r) => r.state === "on")) state = "on";
  else if (parts.some((r) => r.state === "unknown")) state = "unknown";
  else state = "off";
  return { text: parts.length < declared ? `${text} · missing entity` : text, state };
}

function tvRow(hass, cfg) {
  const rec = recordOf(hass, cfg.media_player);
  if (!rec) return { text: "missing entity", state: "unavailable" };
  const c = tvControls(rec);
  return { text: tvSummary(c), state: !c.available ? (rec.state === "unknown" ? "unknown" : "unavailable") : c.on ? "on" : "off" };
}

function glanceParts(hass, cfg) {
  const readings = (cfg.entities || []).map((id) => {
    const st = hass?.states?.[id];
    const r = readingOf(st, { entry: hass?.entities?.[id] || null });
    return { id, name: st?.attributes?.friendly_name || id, reading: r, line: readingSummary(r) };
  });
  const robots = (cfg.robots || []).map((n) => robotGlance(hass?.states || {}, n));
  return { readings, robots };
}

function glanceRow(hass, cfg) {
  const { readings, robots } = glanceParts(hass, cfg);
  const bits = readings.map((r) => r.line);
  if (robots.length) {
    const errors = robots.filter((r) => r.error);
    const running = robots.filter((r) => r.running);
    bits.push(errors.length ? `${errors.map((r) => r.name).join(", ")}: error`
      : running.length ? `${running.map((r) => r.name).join(", ")} running`
      : `${robots.filter((r) => r.available).length} of ${robots.length} robots idle`);
  }
  return { text: bits.join(" · ") || "—", state: "none" };
}

function glanceHtml(hass, cfg) {
  const { readings, robots } = glanceParts(hass, cfg);
  const row = (name, value, cls = "") =>
    `<div class="g-row ${cls}"><span class="g-name">${esc(name)}</span><span class="g-val">${esc(value)}</span></div>`;
  return `<div class="glance">
    ${readings.map((r) => row(r.name, r.line, ABSENT.has(r.reading.kind) ? r.reading.kind : "")).join("")}
    ${robots.map((r) => row(r.name,
      r.error ? `error: ${r.error}` : r.available ? String(r.state).replace(/_/g, " ") : "unavailable",
      r.error ? "err" : r.available ? (r.running ? "on" : "") : "unavailable")).join("")}
  </div>`;
}

export const RENDERERS = Object.freeze({
  appliance: {
    label: "Fan & light", size: { w: 4, h: 5 },
    noun: (cfg) => (cfg.fan && cfg.light ? "fan & light" : cfg.fan ? "fan" : "light"),
    load: () => import("../cards/appliance-card/appliance-card.js"), tag: "appliance-card",
    summary: applianceRow,
  },
  lights: {
    label: "Light group", size: { w: 5, h: 6 }, noun: () => "group",
    load: () => import("../cards/light-tree-card/light-tree-card.js"), tag: "light-tree-card",
    summary: (hass, cfg) => {
      const node = lightNode(cfg.entity, hass?.states || {});
      return { text: treeSummary(node), state: rowState(node) };
    },
  },
  "va-rooms": {
    label: "Robot rooms", size: { w: 4, h: 7 }, noun: () => "robot",
    load: () => import("../cards/va-room-card/va-room-card.js"), tag: "va-room-card",
    summary: (hass, cfg) => {
      const g = robotGlance(hass?.states || {}, String(cfg.vacuum || "").split(".")[1]);
      const picked = roomsFor(hass?.states || {}, cfg.vacuum).filter((r) => r.selected).map((r) => r.name);
      const status = !g.available ? "unavailable" : g.error ? `error: ${g.error}` : String(g.state).replace(/_/g, " ");
      return { text: `${robotName(hass?.panels, cfg.vacuum, hass?.states)}: ${status}${picked.length ? ` · ${picked.join(", ")} selected` : ""}`,
        state: !g.available ? "unavailable" : g.running ? "on" : "off" };
    },
  },
  "va-room": {
    label: "Room robots", size: { w: 4, h: 6 }, noun: () => "robots",
    load: () => import("../cards/va-room-card/va-room-card.js"), tag: "va-room-card",
    summary: (hass, cfg) => {
      const states = hass?.states || {};
      const entries = roomAcrossRobots(states, cfg.room, cfg.names);
      const busy = entries.filter((e) => e.room && robotGlance(states, e.vacuum.split(".")[1]).running);
      const last = lastCleanedAcross(entries);
      const who = (v) => robotName(hass?.panels, v, states);
      const text = busy.length ? `${busy.map((e) => who(e.vacuum)).join(", ")} running`
        : last ? `cleaned ${relativeTime(new Date(last.at))} by ${who(last.vacuum)}` : "not cleaned yet";
      return { text, state: busy.length ? "on" : "off" };
    },
  },
  tv: {
    label: "TV", size: { w: 6, h: 6 }, noun: () => "TV",
    load: () => import("../cards/tv-card/tv-card.js"), tag: "tv-card",
    summary: tvRow,
  },
  tvplus: {
    label: "TV Plus guide", size: { w: 6, h: 6 }, noun: () => "guide",
    load: () => import("../cards/samsung-tvplus-card/samsung-tvplus-card.js"), tag: "samsung-tvplus-card",
    // The saved list lives in HA's frontend storage, which a summary cannot read
    // synchronously - so the row says what the tile is, not a count it would guess.
    summary: () => ({ text: "saved channels · search the lineup", state: "none" }),
  },
  glance: {
    label: "Glance", size: { w: 6, h: 4 }, noun: () => "glance",
    html: glanceHtml,
    summary: glanceRow,
  },
});

export const rendererFor = (kind) => RENDERERS[kind] || null;
