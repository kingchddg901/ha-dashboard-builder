/**
 * Discovery - what Home Assistant has that could be a tile, and is not one yet.
 * No DOM.
 *
 * Before this, every tile came from the hand-written starting layout: when
 * Bryan's TV arrived it reached the dashboard because someone added it to the
 * seed. Here the same declarations are WRITTEN from what HA reports, so a new
 * device shows up as a candidate on its own (SCOPE §2.7: a composer is just
 * something that writes the tile data).
 *
 * The rules, each from what this house's registry actually looks like:
 *
 *   TV       a device with a remote AND a media player of the same integration.
 *            A Cast player beside them (Bryan's TV, the Android TV) is not the
 *            TV's controller and is not paired.
 *   fan      a device with a fan, with that device's light if it has one.
 *   lights   a light group becomes one tree tile, and a bulb in the SAME area
 *            as its group is part of it, not a candidate of its own. A bulb in
 *            another area (the kitchen, inside Main house) stays a candidate in
 *            its own area.
 *   robot    a vacuum Vacuum Agent manages (it has VA room switches).
 *
 * Candidates are grouped by HA area - an area's things are the natural tab.
 * Anything a tile already names, on any tab or the shelf, is not offered.
 */

const domainOf = (id) => String(id).split(".")[0];
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

/** Every entity id a layout's tiles name - the "already on the dashboard" set. */
export function placedEntities(dash) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === "string" && /^[a-z_]+\.[a-z0-9_]+$/.test(v)) out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const t of [...(dash?.tabs || []).flatMap((x) => x.tiles), ...(dash?.shelf || [])]) walk(t.config);
  return out;
}

function areaOf(id, entities, devices) {
  const e = entities[id];
  return e?.area_id || devices?.[e?.device_id]?.area_id || null;
}

/**
 * Candidate tiles for everything HA has, placed or not:
 * `[{ id, kind, title, area, config, primary: [entity ids] }]`.
 */
export function discover({ states = {}, entities = {}, devices = {}, areas = {}, panels = {} } = {}) {
  const out = [];
  const visible = (id) => states[id] && !entities[id]?.hidden;
  const byDevice = new Map();
  for (const e of Object.values(entities)) {
    if (!e?.device_id || !visible(e.entity_id)) continue;
    if (!byDevice.has(e.device_id)) byDevice.set(e.device_id, []);
    byDevice.get(e.device_id).push(e);
  }
  const deviceName = (d) => devices?.[d]?.name_by_user || devices?.[d]?.name || null;

  // TVs: a remote and a media player from the same integration, on one device.
  for (const [dev, list] of byDevice) {
    for (const r of list.filter((e) => domainOf(e.entity_id) === "remote")) {
      const mp = list.find((e) => domainOf(e.entity_id) === "media_player" && e.platform === r.platform);
      if (!mp) continue;
      const title = deviceName(dev) || states[mp.entity_id]?.attributes?.friendly_name || mp.entity_id;
      out.push({ id: `ha-${slug(mp.entity_id)}`, kind: "tv", title, area: areaOf(mp.entity_id, entities, devices),
        config: { title, media_player: mp.entity_id, remote: r.entity_id }, primary: [mp.entity_id, r.entity_id] });
    }
  }

  // Fans, with their device's light.
  const claimed = new Set();
  for (const [dev, list] of byDevice) {
    for (const f of list.filter((e) => domainOf(e.entity_id) === "fan")) {
      const light = list.find((e) => domainOf(e.entity_id) === "light" && !/night/i.test(e.entity_id));
      const title = deviceName(dev) || states[f.entity_id]?.attributes?.friendly_name || f.entity_id;
      const config = light ? { title, fan: f.entity_id, light: light.entity_id } : { title, fan: f.entity_id };
      if (light) claimed.add(light.entity_id);
      out.push({ id: `ha-${slug(f.entity_id)}`, kind: "appliance", title, area: areaOf(f.entity_id, entities, devices),
        config, primary: [f.entity_id, ...(light ? [light.entity_id] : [])] });
    }
  }

  // Lights: groups as trees; a bulb folds into a group in its own area.
  const lights = Object.keys(states).filter((id) => domainOf(id) === "light" && visible(id));
  const members = (id) => (Array.isArray(states[id]?.attributes?.entity_id) ? states[id].attributes.entity_id : []);
  const folded = new Set();
  for (const g of lights.filter((id) => members(id).length)) {
    const ga = areaOf(g, entities, devices);
    for (const m of members(g)) if (areaOf(m, entities, devices) === ga) folded.add(m);
  }
  for (const id of lights) {
    if (claimed.has(id) || folded.has(id)) continue;
    const name = states[id]?.attributes?.friendly_name || id;
    const isGroup = members(id).length > 0;
    out.push({ id: `ha-${slug(id)}`, kind: isGroup ? "lights" : "appliance", title: name,
      area: areaOf(id, entities, devices), config: isGroup ? { entity: id, title: name } : { title: name, light: id },
      primary: [id] });
  }

  // Robots Vacuum Agent manages.
  const robots = new Set(Object.values(states).map((s) => s?.attributes?.room_id != null ? s.attributes.vacuum_entity_id : null)
    .filter(Boolean));
  for (const v of [...robots].sort()) {
    const panel = Object.values(panels || {}).find((p) => p?.config?.vacuum_entity_id === v);
    const title = panel?.title || states[v]?.attributes?.friendly_name || v;
    out.push({ id: `ha-${slug(v)}`, kind: "va-rooms", title, area: areaOf(v, entities, devices),
      config: { vacuum: v }, primary: [v] });
  }

  return out.map((c) => ({ ...c, areaName: c.area ? (areas?.[c.area]?.name || c.area) : null }));
}

/**
 * Fold the starting layout's hand-made tiles into the discovered ones. Where a
 * starting tile names the same thing as a candidate (the fan with its corrected
 * light and preset helper, a TV), the starting tile stands in for the candidate
 * - under the candidate's AREA, so an area's tab gets it. What is left of the
 * starting tiles is what discovery cannot find (clock, glance, room tiles).
 */
export function withStartingTiles(groups, starting = []) {
  const names = (t) => placedEntities({ tabs: [{ tiles: [t] }], shelf: [] });
  const used = new Set();
  const mapped = groups.map((g) => ({ ...g, candidates: g.candidates.map((c) => {
    const own = starting.find((t) => !used.has(t.id) && c.primary.some((e) => names(t).has(e)));
    if (!own) return c;
    used.add(own.id);
    return { ...c, id: own.id, kind: own.kind, title: own.title, config: own.config, w: own.w, h: own.h, standIn: true };
  }) }));
  // A starting tile can cover more than the candidate it replaced - the fan tile
  // names both the fan and its corrected light - so any other candidate for the
  // same things drops out rather than being offered twice.
  const covered = new Set(starting.filter((t) => used.has(t.id)).flatMap((t) => [...names(t)]));
  const found = mapped.map((g) => ({ ...g,
    candidates: g.candidates.filter((c) => c.standIn || !c.primary.some((e) => covered.has(e))) }))
    .filter((g) => g.candidates.length);
  return { found, fresh: starting.filter((t) => !used.has(t.id)) };
}

/**
 * What to offer: candidates nothing on the dashboard already names, grouped by
 * area (areas by name, "no area" last), in a stable order within each.
 */
export function unplacedByArea(candidatesList, dash, { exclude = new Set() } = {}) {
  const placed = placedEntities(dash);
  const ids = new Set([...(dash?.tabs || []).flatMap((t) => t.tiles.map((x) => x.id)), ...(dash?.shelf || []).map((x) => x.id)]);
  const left = candidatesList.filter((c) => !ids.has(c.id) && !c.primary.some((e) => placed.has(e) || exclude.has(e)));
  const groups = new Map();
  for (const c of left) {
    const k = c.areaName || "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  return [...groups].sort(([a], [b]) => (a === "") - (b === "") || a.localeCompare(b))
    .map(([area, list]) => ({ area: area || null, candidates: list.sort((x, y) => x.kind.localeCompare(y.kind) || x.title.localeCompare(y.title)) }));
}
