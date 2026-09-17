/**
 * Level 1 of the dashboard builder — what does Home Assistant say this entity is?
 *
 * No DOM, no Lovelace. Everything here turns registry entries and a state object
 * into one flat record per entity, so the same answer can feed a debug table
 * today and a renderer that picks controls later.
 *
 * The rules come from measuring a live install — ../../docs/ha-hint-audit.md.
 * Three of them shape this file:
 *
 *   - `supported_features` is per-domain and its bits are HA's, so the table
 *     below is copied from HA's source (tag 2026.9.2) rather than guessed. Bits
 *     that are NOT in the table are reported as `bit N`, never dropped: an
 *     unknown bit means the table is stale, and silence would hide that.
 *   - 0 features is a real answer, not a missing one. `remote.big_tv` reports 0.
 *     `features.none` says so, so a caller can tell "nothing to offer" from
 *     "nobody asked".
 *   - `device_class` and every option list are OPEN vocabularies. `vacuum.robin`
 *     reports `device_class: dreame_vacuum` in a domain where HA defines none.
 *     Unknown values pass through with `known: false`; nothing is filtered out.
 */

/** From homeassistant/components/<domain>/const.py, class <Domain>EntityFeature. */
export const FEATURE_FLAGS = {
  light: { 4: "EFFECT", 8: "FLASH", 32: "TRANSITION" },
  fan: { 1: "SET_SPEED", 2: "OSCILLATE", 4: "DIRECTION", 8: "PRESET_MODE", 16: "TURN_OFF", 32: "TURN_ON" },
  media_player: {
    1: "PAUSE", 2: "SEEK", 4: "VOLUME_SET", 8: "VOLUME_MUTE", 16: "PREVIOUS_TRACK", 32: "NEXT_TRACK",
    128: "TURN_ON", 256: "TURN_OFF", 512: "PLAY_MEDIA", 1024: "VOLUME_STEP", 2048: "SELECT_SOURCE",
    4096: "STOP", 8192: "CLEAR_PLAYLIST", 16384: "PLAY", 32768: "SHUFFLE_SET", 65536: "SELECT_SOUND_MODE",
    131072: "BROWSE_MEDIA", 262144: "REPEAT_SET", 524288: "GROUPING", 1048576: "MEDIA_ANNOUNCE",
    2097152: "MEDIA_ENQUEUE", 4194304: "SEARCH_MEDIA",
  },
  cover: {
    1: "OPEN", 2: "CLOSE", 4: "SET_POSITION", 8: "STOP", 16: "OPEN_TILT", 32: "CLOSE_TILT",
    64: "STOP_TILT", 128: "SET_TILT_POSITION", 256: "SPEED",
  },
  remote: { 1: "LEARN_COMMAND", 2: "DELETE_COMMAND", 4: "ACTIVITY" },
  vacuum: {
    1: "TURN_ON", 2: "TURN_OFF", 4: "PAUSE", 8: "STOP", 16: "RETURN_HOME", 32: "FAN_SPEED",
    128: "STATUS", 256: "SEND_COMMAND", 512: "LOCATE", 1024: "CLEAN_SPOT", 2048: "MAP",
    4096: "STATE", 8192: "START", 16384: "CLEAN_AREA",
  },
  climate: {
    1: "TARGET_TEMPERATURE", 2: "TARGET_TEMPERATURE_RANGE", 4: "TARGET_HUMIDITY", 8: "FAN_MODE",
    16: "PRESET_MODE", 32: "SWING_MODE", 128: "TURN_OFF", 256: "TURN_ON", 512: "SWING_HORIZONTAL_MODE",
  },
  humidifier: { 1: "MODES" },
  water_heater: { 1: "TARGET_TEMPERATURE", 2: "OPERATION_MODE", 4: "AWAY_MODE", 8: "ON_OFF" },
  lock: { 1: "OPEN" },
  valve: { 1: "OPEN", 2: "CLOSE", 4: "SET_POSITION", 8: "STOP" },
  lawn_mower: { 1: "START_MOWING", 2: "PAUSE", 4: "DOCK" },
  camera: { 1: "ON_OFF", 2: "STREAM" },
  alarm_control_panel: {
    1: "ARM_HOME", 2: "ARM_AWAY", 4: "ARM_NIGHT", 8: "TRIGGER", 16: "ARM_CUSTOM_BYPASS", 32: "ARM_VACATION",
  },
  // Domains whose whole control surface is the state machine: no feature bits exist.
  text: {}, number: {}, select: {}, button: {}, switch: {}, scene: {}, input_boolean: {},
};

/**
 * Device classes, ONLY for domains checked against HA's source in this session.
 * A domain that is absent is "not checked" (known: null) — which is different
 * from "checked and this value is not in the set" (known: false).
 */
export const DEVICE_CLASSES = {
  light: [],            // light defines none
  vacuum: [],           // vacuum defines none — so dreame_vacuum is entirely custom
  media_player: ["tv", "speaker", "receiver"],
};

/** Per-domain attributes that describe what the thing can do, rather than what it is doing. */
export const CAPABILITY_ATTRS = {
  light: ["supported_color_modes", "min_color_temp_kelvin", "max_color_temp_kelvin", "min_mireds",
    "max_mireds", "effect_list"],
  fan: ["preset_modes", "percentage_step", "direction", "oscillating"],
  media_player: ["source_list", "sound_mode_list"],
  climate: ["hvac_modes", "preset_modes", "fan_modes", "swing_modes", "min_temp", "max_temp",
    "target_temp_step"],
  vacuum: ["fan_speed_list"],
  cover: ["current_position", "current_tilt_position"],
  select: ["options"],
  number: ["min", "max", "step", "mode"],
  text: ["min", "max", "pattern", "mode"],
};

export const domainOf = (entityId) => String(entityId).split(".")[0];

/**
 * Decode a `supported_features` bitmask for one domain.
 *
 * Unknown bits come back as `bit N` in `unknown`, and `none` separates a real 0
 * from a domain nobody has tabulated.
 */
export function decodeFeatures(domain, bits) {
  const table = FEATURE_FLAGS[domain];
  const value = Number.isFinite(bits) ? Number(bits) : 0;
  const names = [];
  const unknown = [];
  for (let bit = 1; bit <= value && bit > 0; bit *= 2) {
    if (!(value & bit)) continue;
    if (table && table[bit]) names.push(table[bit]);
    else unknown.push(`bit ${bit}`);
  }
  return {
    bits: value,
    names,
    unknown,
    none: value === 0,
    tabulated: Boolean(table),
  };
}

/**
 * Where is it? Entity-level area wins, then the device's.
 *
 * `via` is the point of this function: 33% of visible primary entities resolve at
 * all, and a renderer that groups by device alone misses every template entity
 * and helper, which carry no device.
 */
export function resolveArea(entry, devices = {}, areas = {}) {
  const deviceId = entry?.device_id || null;
  const device = deviceId ? devices[deviceId] : null;
  const id = entry?.area_id || device?.area_id || null;
  return {
    id,
    name: id ? (areas[id]?.name ?? null) : null,
    floor_id: id ? (areas[id]?.floor_id ?? null) : null,
    via: entry?.area_id ? "entity" : device?.area_id ? "device" : null,
  };
}

function classifyDeviceClass(domain, value) {
  if (value == null) return null;
  const set = DEVICE_CLASSES[domain];
  return { value, known: set ? set.includes(value) : null };
}

/** Pull the capability-shaped attributes out, leaving live values behind. */
function capabilityAttrs(domain, attrs = {}) {
  const out = {};
  for (const key of CAPABILITY_ATTRS[domain] || []) {
    if (attrs[key] !== undefined) out[key] = attrs[key];
  }
  return out;
}

/**
 * One entity, everything HA will tell us about it.
 *
 * `entry` is an entity-registry entry (hass.entities[id] shape is enough),
 * `state` a state object, `devices`/`areas` the registry maps. Any of them may be
 * missing — a helper created in YAML has no registry entry at all — and the
 * record still comes back, with the gaps visible rather than thrown.
 */
export function describeEntity({ entityId, entry = null, state = null, devices = {}, areas = {}, groups = {} }) {
  const id = entityId || entry?.entity_id || state?.entity_id;
  const domain = domainOf(id);
  const attrs = state?.attributes || {};
  const deviceId = entry?.device_id || null;
  const device = deviceId ? devices[deviceId] : null;

  return {
    entity_id: id,
    // Three different names, because they disagree and the disagreement matters.
    friendly_name: attrs.friendly_name ?? null,
    registry_name: entry?.name ?? null,
    domain,
    platform: entry?.platform ?? null,
    entity_category: entry?.entity_category ?? null,
    primary: !entry?.entity_category,
    hidden: Boolean(entry?.hidden ?? entry?.hidden_by),
    in_registry: Boolean(entry),
    state: state ? state.state : null,
    available: state ? !["unavailable", "unknown"].includes(state.state) : null,
    area: resolveArea(entry, devices, areas),
    device: device
      ? {
        id: deviceId,
        name: device.name_by_user || device.name || null,
        manufacturer: device.manufacturer ?? null,
        model: device.model ?? null,
        area_id: device.area_id ?? null,
      }
      : null,
    features: decodeFeatures(domain, attrs.supported_features),
    device_class: classifyDeviceClass(domain, attrs.device_class ?? entry?.device_class ?? null),
    capabilities: capabilityAttrs(domain, attrs),
    // Grouped control is a CAPABILITY - one control for several lights - not a
    // statement about where anything is. Both edges are reported and neither is
    // resolved: whether the group or its members become the control is policy,
    // and a dashboard may override it either way.
    group: { members: groupMembers(state), memberOf: groups[id] || [] },
    raw: attrs,
  };
}

/**
 * The members a group publishes, from its own state.
 *
 * A group light lists its members in the `entity_id` attribute, so group
 * composition is one of the few structural facts HA hands over for free - unlike
 * a template light, which publishes nothing about what it wraps.
 */
export function groupMembers(state) {
  const m = state?.attributes?.entity_id;
  return Array.isArray(m) ? m.slice() : [];
}

/**
 * The reverse edge: member entity id -> the groups that contain it.
 *
 * Built once over all states; groups nest, so a group can appear on both sides.
 */
export function groupIndex(states = {}) {
  const out = {};
  for (const [id, st] of Object.entries(states)) {
    for (const m of groupMembers(st)) (out[m] = out[m] || []).push(id);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

/**
 * Sibling entities on the same device, split by whether HA calls them primary.
 *
 * `entity_category` is the best filter available and it is a CLAIM: tuya_local
 * marks 2 of the fan's 21 entities primary, the Dreame integration marks 115 of
 * 218. Both counts come back so a caller can see which kind of device it has.
 */
export function deviceSiblings(deviceId, entities = {}) {
  const all = Object.values(entities).filter((e) => e.device_id && e.device_id === deviceId);
  const primary = all.filter((e) => !e.entity_category && !(e.hidden ?? e.hidden_by));
  return { total: all.length, primary: primary.map((e) => e.entity_id), primaryCount: primary.length };
}

/** Pick what to describe: explicit list, else every entity in `domains`. */
export function selectEntities({ states = {}, entities = {}, devices = {}, areas = {}, domains = ["light"], area = null, include = null }) {
  let ids = include && include.length ? include.slice() : Object.keys(states).filter((id) => domains.includes(domainOf(id)));
  if (area) {
    ids = ids.filter((id) => resolveArea(entities[id], devices, areas).id === area);
  }
  const groups = groupIndex(states);
  return ids.sort().map((id) => describeEntity({
    entityId: id, entry: entities[id] || null, state: states[id] || null, devices, areas, groups,
  }));
}
