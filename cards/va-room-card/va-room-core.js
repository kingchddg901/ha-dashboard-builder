/**
 * Vacuum Agent rooms, for the dashboard - the SHALLOW half only. No DOM.
 *
 * The stop line (docs/SCOPE.md): VA is an application, so the dashboard does
 * not rebuild it. What a room tile does here is the shallow action - pick a
 * room and start it with the settings VA already holds for it. Everything deep
 * (which settings apply when mopping, water ranges, brand rules) stays in VA:
 * the tile shows the saved settings in VA's OWN labels and hands editing to
 * VA's own room card.
 *
 * Everything read here is what VA publishes on each room's selection switch:
 * vacuum_entity_id, room_id, room_name, map_id, the saved fields, and each
 * field's `{value, label}` options. The start sequence is the one VA's room
 * card runs: clear the robot's other selected rooms, select this one, then
 * eufy_vacuum.start_selected_rooms for its map.
 */

/** Every room VA manages for one robot, by name. */
export function roomsFor(states = {}, vacuum) {
  const out = [];
  for (const [id, st] of Object.entries(states)) {
    const a = st?.attributes;
    if (!id.startsWith("switch.") || a?.vacuum_entity_id !== vacuum || a?.room_id == null) continue;
    out.push({
      entity_id: id,
      room_id: a.room_id,
      map_id: a.map_id != null ? String(a.map_id) : null,
      name: a.room_name || a.friendly_name || `Room ${a.room_id}`,
      selected: st.state === "on",
      enabled: a.enabled !== false,
      lastCleaned: a.last_cleaned_at || null,
      attrs: a,
    });
  }
  return out.sort((x, y) => String(x.name).localeCompare(String(y.name)));
}

/** VA's own label for a saved value, or the value itself if VA gives none. */
export function optionLabel(options, value) {
  if (value == null || value === "") return null;
  const hit = Array.isArray(options) ? options.find((o) => String(o?.value) === String(value)) : null;
  return hit?.label ?? String(value);
}

/**
 * The saved settings, as VA words them - read only. Each field appears only if
 * VA holds a value for it; nothing is inferred (no "mop mode hides suction"),
 * because that rule is VA's to apply, in VA's editor.
 */
export function savedSettings(a = {}) {
  const out = [];
  const add = (label) => { if (label) out.push(label); };
  add(optionLabel(a.clean_mode_options, a.clean_mode));
  const fan = optionLabel(a.fan_speed_options, a.fan_speed);
  if (fan) add(`${fan} suction`);
  const water = a.water_level_range ? (a.water_level != null ? String(a.water_level) : null)
    : optionLabel(a.water_level_options, a.water_level);
  if (water) add(`water ${water}`);
  add(optionLabel(a.clean_intensity_options, a.clean_intensity));
  if (Number.isFinite(a.clean_passes)) add(a.clean_passes === 1 ? "1 pass" : `${a.clean_passes} passes`);
  if (a.supports_edge_mopping && a.edge_mopping === true) add("edge mopping");
  return out;
}

/**
 * The calls that start one room, in order - what VA's room card does, minus
 * saving (this tile does not edit). Rooms already selected for this robot are
 * cleared first, so only this room runs.
 */
export function startCalls(rooms, room, vacuum) {
  if (!room?.map_id) return [];
  const calls = rooms.filter((r) => r.selected && r.entity_id !== room.entity_id)
    .map((r) => ({ domain: "switch", service: "turn_off", data: { entity_id: r.entity_id } }));
  if (!room.selected) calls.push({ domain: "switch", service: "turn_on", data: { entity_id: room.entity_id } });
  calls.push({ domain: "eufy_vacuum", service: "start_selected_rooms", data: { vacuum_entity_id: vacuum, map_id: room.map_id } });
  return calls;
}

/* ---------------------------------------------------------------- one room
 *
 * A room of the HOUSE is shared by every robot that maps it, and each robot's
 * map names it its own way - here "Kitchen" is "KITCHEN" on Ivy, "Living Room"
 * is "LIVINGROOM", "Bryan's Room" is "Bryan". So a room is matched by what
 * identifies it once case, accents, punctuation, possessives and the word
 * "room" are set aside. Names that share nothing ("Office" is "Home Office" on
 * Alfred) are DECLARED on the tile, never guessed.
 */

/** A room name reduced to what identifies it. */
export function roomKey(name) {
  const words = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['\u2019]s\b/g, "").split(/[^a-z0-9]+/).filter((w) => w && w !== "room" && w !== "the");
  return words.join("").replace(/room$/, "");
}

/** Every robot VA manages rooms for. */
export function robotsWithRooms(states = {}) {
  const set = new Set();
  for (const [id, st] of Object.entries(states)) {
    const a = st?.attributes;
    if (id.startsWith("switch.") && a?.vacuum_entity_id && a.room_id != null) set.add(a.vacuum_entity_id);
  }
  return [...set].sort();
}

/**
 * One house room across the robots: for each robot, its room of that name (or
 * the name declared for it in `names`), or null when its map has none.
 */
export function roomAcrossRobots(states = {}, room, names = {}) {
  return robotsWithRooms(states).map((vacuum) => {
    const asked = names?.[vacuum] ?? room;
    const key = roomKey(asked);
    const hit = key ? roomsFor(states, vacuum).find((r) => roomKey(r.name) === key) : null;
    return { vacuum, asked, room: hit || null };
  });
}

/** When the room was last cleaned by any robot, and by which. */
export function lastCleanedAcross(entries) {
  let best = null;
  for (const e of entries) {
    const t = e.room?.lastCleaned ? Date.parse(e.room.lastCleaned) : NaN;
    if (Number.isFinite(t) && (!best || t > best.at)) best = { at: t, vacuum: e.vacuum };
  }
  return best;
}

/**
 * The robot's name as the house knows it: the title of VA's sidebar panel for
 * it (VA registers one per robot, with the robot in the panel's config), else
 * the vacuum entity's own name.
 */
export function robotName(panels = {}, vacuum, states = {}) {
  const p = Object.values(panels || {}).find((x) => x?.config?.vacuum_entity_id === vacuum && x?.title);
  return p?.title || states?.[vacuum]?.attributes?.friendly_name || vacuum;
}
