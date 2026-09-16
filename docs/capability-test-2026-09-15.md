# Can we query an entity for what it can do?

Measured 2026-09-15 against the live box — 1031 entities, `/api/states` and `/api/services`,
read-only. This is the test the SCOPE called Spike B, run against real data rather than on paper.

**Result: partly, and the part that fails changes the model.**

---

## Where it works

### Lights — clean, and the exception is the proof

29 lights, three capability sets, all reported by `supported_color_modes`:

| count | `supported_color_modes` |
|---|---|
| 25 | `color_temp, hs, xy` |
| 3 | `color_temp, hs` |
| **1** | **`onoff`** |

That single `onoff` light is the whole test. A designer can know — with no configuration, from the
entity alone — that it must not be offered a brightness slider or a colour picker. Constrained
choice, derived. The renderer set for a light is a function of the entity.

### Fans — capabilities live in the service registry, and that is fine

`fan.set_percentage`, `set_direction`, `set_preset_mode`, `oscillate`, `increase_speed`,
`decrease_speed`. Everything the compound fan needs, discoverable.

**So capabilities come from two queryable places**, not one: state attributes *and* the service
registry. A model that reads only attributes misses half.

---

## Where it fails

### One device is up to six entities, with different capabilities on each

Big TV:

```
media_player.big_tv_3                 unavailable   sf=0
media_player.big_tv_un55au8000fxza    off           sf=24509
media_player.big_tv                   unavailable   sf=23997
media_player.big_tv_2                 off           sf=90045
remote.big_tv_un55au8000fxza          off           sf=0
remote.big_tv                         unknown       sf=0
```

Four `media_player` entities, four different `supported_features`, two of them dead. Across the
house: **14 `media_player` + 6 `remote` entities for about 5 physical TVs.**

"Query the entity for what it can do" has no single answer here, because there is no single
entity. Worse, two of them report `sf=0` while unavailable — a designer that offers all fourteen
is *worse* than hand-written YAML, because at least the YAML was written by someone who knew which
one worked.

This is the compound-appliance problem from the other side: not *several entities that are one
device*, but *several entities that are one device and disagree about what it can do*.

### App launching is not discoverable — and there is no generic mechanism

The first thing asked for was launching a TV app with one click. It cannot be derived:

- `source_list` on every live TV is `['TV', 'HDMI']` — **inputs, not apps**
- all six `remote.*` entities have an empty `activity_list` and no attributes at all
- across **81 service domains** there is no app-launch service. `samsungtv_smart` exposes exactly
  `select_picture_mode` and `set_art_mode`

The only route is `remote.send_command` with a device-specific payload — a string you must already
know, which HA cannot enumerate for you.

**This is a "not yet" with a named mechanism, not a "no".** The command exists; it is the
*vocabulary* that is missing.

---

## What this changes

Capabilities come from **three** places and only two are queryable:

| source | queryable | example |
|---|---|---|
| state attributes | **yes** | `supported_color_modes` on a light |
| service registry | **yes** | `fan.set_preset_mode` |
| device command vocabularies | **no** | the string that launches Netflix on a 2021 Samsung |

So the designer's model cannot be *query and offer*. It has to be:

> **Query what you can. Declare what you can't. Make the declared part reusable.**

A TV app list authored once for a model is shareable with everyone who owns that model — which is
a per-model config dict registered at runtime. That is `ha-adapter-pattern` again, the **fourth**
independent appearance of that shape in this project. At this point it is not a coincidence, it is
the architecture.

### Two rules this adds

1. **Entity picking is part of the designer, not a prerequisite for it.** When a device resolves
   to several entities, the designer has to help choose — rank by `supported_features`, drop the
   `sf=0` and permanently-unavailable ones, and show what each can actually do. Offering the raw
   list is a non-answer.
2. **A declared vocabulary needs the same treatment as a queried one.** Closed set, enumerated in
   the editor, previewed, invalid values unrepresentable — design rule 2 applies whether the set
   came from HA or from a config file.

### What it does not change

The build order. Panel → tokens → theme tab → one real control still stands, and the light case
proves the capability idea works where it is needed first. The TV is the hard case and it is the
*fourth* torture test for a reason.
