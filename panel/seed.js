/**
 * The starting layout for this house - what a first visit shows, and what
 * "reset layout" goes back to. It is DATA, the same shape a saved layout has,
 * so the panel never special-cases it: a composer later is just something
 * that writes this.
 *
 * Sizes are in grid cells (12 across). Every tile names its renderer by `kind`
 * and hands it a declaration - no renderer knows these entity ids.
 */

const light = (id, title, entity, at) => ({
  id, kind: "appliance", title, ...at, config: { title, light: entity },
});

export const SEED = Object.freeze({
  v: 1,
  cols: 12,
  tabs: [
    {
      id: "house", title: "House",
      tiles: [
        { id: "bedroom-fan", kind: "appliance", title: "Bedroom fan", x: 0, y: 0, w: 6, h: 9,
          config: { title: "Bedroom fan", fan: "fan.ceiling_fan", light: "light.ceiling_fan_calibrated",
            presets: "input_text.ceiling_fan_presets" } },
        { id: "glance", kind: "glance", title: "Glance", x: 6, y: 0, w: 6, h: 4,
          config: { entities: ["weather.forecast_home"], robots: ["alfred", "ivy", "robin"] } },
        light("living-room", "Living room", "light.living_room", { x: 6, y: 4, w: 6, h: 5 }),
      ],
    },
    {
      id: "lights", title: "Lights",
      tiles: [
        light("kitchen", "Kitchen", "light.kitchen", { x: 0, y: 0, w: 4, h: 3 }),
        light("hallway", "Hallway", "light.hall_master", { x: 4, y: 0, w: 4, h: 5 }),
        light("bathroom", "Bathroom", "light.bathroom", { x: 8, y: 0, w: 4, h: 5 }),
        light("entryway", "Entryway", "light.entryway", { x: 0, y: 3, w: 4, h: 5 }),
        light("office", "Office", "light.office", { x: 4, y: 5, w: 4, h: 5 }),
        light("bryans-room", "Bryan's room", "light.bryan_s_room", { x: 8, y: 5, w: 4, h: 5 }),
        light("dining-room", "Dining room", "light.dinning_room", { x: 0, y: 8, w: 4, h: 5 }),
      ],
    },
    {
      id: "media", title: "Media",
      tiles: [
        { id: "big-tv", kind: "tv", title: "Big TV", x: 0, y: 0, w: 6, h: 6,
          config: { title: "Big TV", media_player: "media_player.big_tv_2", remote: "remote.big_tv" } },
        { id: "tvplus", kind: "tvplus", title: "TV Plus guide", x: 6, y: 0, w: 6, h: 6,
          config: { title: "TV Plus guide", remote: "remote.big_tv",
            channels: ["Witness to Justice", "CBS News 24/7", "Movie Hub", "BBC Earth"] } },
        { id: "monitor", kind: "tv", title: "Monitor", x: 0, y: 6, w: 6, h: 6,
          config: { title: "Monitor", media_player: "media_player.android_tv_2", remote: "remote.android_tv" } },
      ],
    },
  ],
  shelf: [],
});
