/**
 * Light group setup - which lights could go in a group, and the calls that
 * make Home Assistant build it. No DOM.
 *
 * The groups are Home Assistant's own light-group HELPERS, the same kind as the
 * eight this house already has, made through HA's own group flow (measured on
 * 2026.9.2: a menu step, then "light", then name / entities / hide_members /
 * all; editing members is the options flow, which offers the current values).
 * So a group built here works everywhere a helper does - automations, voice -
 * and the light tree reads it like any other.
 *
 * The part worth deciding in a UI is the CANDIDATES: every light, with the
 * members ticked, where it lives, what else it is already in, and whether it
 * can dim - so adding the on/off kitchen to a dimmable group is a visible
 * choice, not a surprise. A group can never contain itself, directly or
 * through another group; those candidates are offered as disabled, with why.
 */

const ids = (st) => (Array.isArray(st?.attributes?.entity_id) ? st.attributes.entity_id : []);

/** Home Assistant's light groups (helpers), with their members. */
export function lightGroupsIn(states = {}, entities = {}) {
  return Object.values(entities)
    .filter((e) => e?.platform === "group" && String(e.entity_id).startsWith("light."))
    .map((e) => {
      const st = states[e.entity_id];
      return { id: e.entity_id, name: st?.attributes?.friendly_name || e.entity_id, members: ids(st) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Does `candidate` contain `group` - itself, or anywhere beneath it? */
export function wouldLoop(group, candidate, states = {}, seen = new Set()) {
  if (!group) return false;
  if (candidate === group) return true;
  if (seen.has(candidate)) return false;
  seen.add(candidate);
  return ids(states[candidate]).some((m) => wouldLoop(group, m, states, seen));
}

function areaOf(id, entities, devices, areas) {
  const e = entities[id];
  const areaId = e?.area_id || devices?.[e?.device_id]?.area_id || null;
  return areaId ? (areas?.[areaId]?.name || areaId) : null;
}

/**
 * Every light that could be a member, for one group (or a new one: group null).
 * Members first in their current order, then by area, then by name.
 */
export function candidates({ states = {}, entities = {}, devices = {}, areas = {} } = {}, { group = null, members = [] } = {}) {
  const groups = lightGroupsIn(states, entities);
  const rows = Object.keys(states).filter((id) => id.startsWith("light.") && id !== group).map((id) => {
    const st = states[id];
    const modes = st?.attributes?.supported_color_modes || [];
    return {
      id,
      name: st?.attributes?.friendly_name || id,
      area: areaOf(id, entities, devices, areas),
      isGroup: ids(st).length > 0,
      size: ids(st).length,
      dimmable: modes.some((m) => m !== "onoff"),
      inGroups: groups.filter((g) => g.id !== group && g.members.includes(id)).map((g) => g.name),
      member: members.includes(id),
      loop: wouldLoop(group, id, states),
    };
  });
  const order = (r) => (r.member ? members.indexOf(r.id) : Infinity);
  return rows.sort((a, b) => order(a) - order(b) || String(a.area ?? "~").localeCompare(String(b.area ?? "~"))
    || a.name.localeCompare(b.name));
}

/** Which groups contain this one - they lose a member if it is deleted. */
export function containedBy(group, states = {}, entities = {}) {
  return lightGroupsIn(states, entities).filter((g) => g.members.includes(group)).map((g) => g.name);
}

/* ---------------------------------------------------------------- the calls
 * `api(method, path, body)` is Home Assistant's REST (hass.callApi in a card),
 * so the sequence tests without one.
 */

/** Create a light group helper. Resolves to the new config entry. */
export async function createLightGroup(api, { name, entities }) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("a group needs a name");
  if (!entities?.length) throw new Error("a group needs at least one light");
  const menu = await api("POST", "config/config_entries/flow", { handler: "group", show_advanced_options: false });
  try {
    const form = await api("POST", `config/config_entries/flow/${menu.flow_id}`, { next_step_id: "light" });
    if (form?.type !== "form" || form.step_id !== "light") throw new Error(`unexpected step ${form?.step_id}`);
    const done = await api("POST", `config/config_entries/flow/${menu.flow_id}`,
      { name: clean, entities, hide_members: false, all: false });
    if (done?.type !== "create_entry") throw new Error(done?.errors ? JSON.stringify(done.errors) : `not created (${done?.type})`);
    return done.result;
  } catch (e) {
    await api("DELETE", `config/config_entries/flow/${menu.flow_id}`).catch(() => {});
    throw e;
  }
}

/** Replace a group's members, keeping its other settings exactly as they are. */
export async function setLightGroupMembers(api, entryId, entities) {
  if (!entities?.length) throw new Error("a group needs at least one light - delete it instead");
  const form = await api("POST", "config/config_entries/options/flow", { handler: entryId, show_advanced_options: false });
  try {
    if (form?.type !== "form") throw new Error(`unexpected ${form?.type}`);
    const kept = Object.fromEntries((form.data_schema || [])
      .filter((f) => f.name !== "entities")
      .map((f) => [f.name, f.description?.suggested_value ?? f.default ?? false]));
    const done = await api("POST", `config/config_entries/options/flow/${form.flow_id}`, { ...kept, entities });
    if (done?.type !== "create_entry") throw new Error(done?.errors ? JSON.stringify(done.errors) : `not saved (${done?.type})`);
    return done;
  } catch (e) {
    await api("DELETE", `config/config_entries/options/flow/${form.flow_id}`).catch(() => {});
    throw e;
  }
}

export function deleteGroupEntry(api, entryId) {
  return api("DELETE", `config/config_entries/entry/${entryId}`);
}
