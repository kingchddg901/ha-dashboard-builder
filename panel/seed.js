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
        // One tile per robot: pick a room, start it; settings stay in Vacuum Agent.
        { id: "alfred-rooms", kind: "va-rooms", title: "Alfred", x: 0, y: 9, w: 4, h: 7, config: { vacuum: "vacuum.alfred" } },
        { id: "ivy-rooms", kind: "va-rooms", title: "Ivy", x: 4, y: 9, w: 4, h: 7, config: { vacuum: "vacuum.ivy" } },
        { id: "robin-rooms", kind: "va-rooms", title: "Robin", x: 8, y: 9, w: 4, h: 7, config: { vacuum: "vacuum.robin" } },
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
        // Groups as one nested control: the group acts on everything beneath it,
        // and opens to its parts (docs/placement-conventions.md).
        { id: "house-lights", kind: "lights", title: "Whole house", x: 0, y: 13, w: 6, h: 9,
          config: { entity: "light.main_house", title: "Whole house" } },
        { id: "hallway-tree", kind: "lights", title: "Hallway", x: 6, y: 13, w: 6, h: 6,
          config: { entity: "light.hall_master", title: "Hallway" } },
        { id: "bathroom-tree", kind: "lights", title: "Bathroom", x: 6, y: 19, w: 6, h: 5,
          config: { entity: "light.bathroom", title: "Bathroom" } },
      ],
    },
    {
      // One tile per room of the house: call whichever robot to clean it. A robot
      // whose map names the room differently is declared, never guessed.
      id: "rooms", title: "Rooms",
      tiles: [
        ["kitchen", "Kitchen"], ["living-room", "Living Room"], ["heidi-chris", "Heidi & Chris", { "vacuum.alfred": "Master bedroom" }],
        ["bryans-room", "Bryan's Room"], ["office", "Office", { "vacuum.alfred": "Home Office" }], ["bathroom", "Bathroom"],
        ["dining-room", "Dining Room"], ["entryway", "Entryway"], ["hallway", "Hallway"], ["cat-room", "Cat Room"],
      ].map(([id, room, names], i) => ({
        id: `room-${id}`, kind: "va-room", title: room, x: (i % 3) * 4, y: Math.floor(i / 3) * 6, w: 4, h: 6,
        config: names ? { room, names } : { room },
      })),
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
        { id: "living-room-tv", kind: "tv", title: "Living Room TV", x: 6, y: 6, w: 6, h: 6,
          config: { title: "Living Room TV", media_player: "media_player.living_room_tv", remote: "remote.living_room_tv" } },
      ],
    },
  ],
  shelf: [],
});
