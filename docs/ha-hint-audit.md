# What Home Assistant already knows — a hint audit

Measured on the live install 2026-09-17 (HA 2026.9.2): **1,410 entities, 104 devices,
16 areas, 1 floor, 0 labels**. One question: how much of "call an entity, work out what it
can do, build a control" can HA answer by itself, before this project declares anything?

Read-only throughout — the entity, device and area registries and `search/related` over the
WebSocket API, states over REST, `floors()`/`labels()` via the template API, and the
`*EntityFeature` flag values read from HA's own source at tag 2026.9.2 rather than from
memory. Every number below was re-read from the capture or the live box, not recalled.

## The short answer

HA answers **what a thing is and what it can do**, and answers it well. It answers **where it
is** for a third of what matters. It never answers **how much it matters**. For one whole
class of device it answers nothing at all. And two of its "vocabularies" are open, not closed.

## Tractability

| | count |
|---|---|
| entities | 1,410 |
| `primary` (no `entity_category`) | 602 |
| `config` | 317 |
| `diagnostic` | 491 |
| disabled / hidden | 435 / 1 |
| **visible primary entities** | **479** |

`entity_category` is the most valuable single hint — it sets aside 808 entities before any
rule of ours runs, and the user's own disabled set removes more. It is also
**integration-dependent**, which is the catch:

| device | platform | entities | visible primary |
|---|---|---|---|
| Local Ceiling fan | `tuya_local` | 21 | **2** — `light.ceiling_fan`, `fan.ceiling_fan` |
| Big TV | `samsungtv_smart` | 2 | 2 |
| Grill | `prime_polaris` | 28 | **27** |
| Robin | `dreame_vacuum` | 218 | **115** |

Excellent where an integration uses the field, useless where it doesn't. **Prominence cannot
come from HA** for a device like Robin or the Grill.

**Where things are is mostly unknown.** Of the 479 visible primary entities, area resolves for
**159 (33%)** — 158 inherited from the device, 1 set on the entity. The other 320 have no area
by either route. Across all 1,410: 439 via device, 1 via entity, 970 nothing.

Primary visible entities by domain: sensor 181, select 75, number 69, switch 41, button 34,
light 28, text 8, media_player 5, binary_sensor 5, input_boolean 4, automation 4, vacuum 3,
remote 3, event 2.

## Case by case

### The compound fan — HA answers the composition, and the control's shape

`fan.ceiling_fan` and `light.ceiling_fan` are **two entities on one device**, and the device
carries the area (`bedroom`). "These are one appliance" is free for this fixture. The recorded
ruling that compound appliances aren't discoverable still holds in general — it is true of a
fixture whose light is paired separately — but it is **false for this one**, and the registry
shows which case you are in. What the ruling leaves undecided is what to do when the device
grouping and the appliance disagree, which is the next case.

The capability read is genuinely good: `supported_features` 61 → SET_SPEED, DIRECTION,
PRESET_MODE, TURN_OFF, TURN_ON; `preset_modes` `["normal", "nature", "sleep"]`; and
`percentage_step` **16.667**, which says **six discrete speeds, not a continuous slider**.
That matches the hardware (DP 105, range 1–6) without being told.

**Two gaps, both instructive:**

* `light.ceiling_fan_calibrated` (platform `template`) has **no device**. Group by device and
  you get the uncorrected light and silently miss the calibrated one. Its area had to be set by
  hand and is now the *only* entity-level area in the house. Anything the user creates —
  helpers, template entities, exactly the things that carry intent — is born outside the hint
  graph.
* The fan's device record has `manufacturer: "Tuya"` and **`model: None`**. HA cannot tell you
  what the product is, which is the same blind spot the DP map notes upstream: nothing in HA or
  the profile names the thing on the box.

### The TV remote — HA answers nothing

`remote.big_tv`: **`supported_features` is 0.** No option lists, no `device_class`. The device
is known (`Samsung Electronics`, model string `UN55AU8000FXZA (big tv)` — note the model field
carries a human annotation, so it is a label, not a clean identifier), the area is known, and
**nothing describes what the remote can do**. Its commands live in the integration's services.

This confirms by measurement what was predicted: no bitmask yields a button matrix, so **for a
remote the intent list *is* the layout**, and it has to be declared. This is the case that
proves whether declarations carry layout, because there is no fallback to fall back to.

`media_player.big_tv_2`, on the same device, is the opposite: `supported_features` 24509 → 12
features, `device_class: tv`. But `source_list` is `["TV", "HDMI"]` — two entries — so "what
can I watch" is not answerable from HA either.

### The grill — an open vocabulary and a frozen typo

`climate.grill` (`prime_polaris`, model `Pellet Grill`) is a pellet grill modelled as a
thermostat: `supported_features` 17 → TARGET_TEMPERATURE, PRESET_MODE; `hvac_modes`
`["off", "heat"]`; 28 entities, 27 of them primary.

Its `preset_modes` are `["Starting", "Cooking", "Off", "Shutting Down", "Error"]` — those are
**lifecycle states wearing the costume of settings**. An option list is a list of strings the
vendor chose; it is not a semantic set, and a renderer that turns every `preset_modes` entry
into a button offers the user "Error".

The area is `gtill`, and — the first pass got this wrong — **the display name is `gtill` too**.
Both halves carry the typo, so this is not the usual id-frozen/name-fixed split: renaming the
area fixes the label and leaves the id misspelled forever. Ids are for identity, names are for
display, and neither is trustworthy enough to *parse*.

### The vacuum — outside scope, but it breaks a vocabulary

`vacuum.robin`: `supported_features` 31676 → 11 features, `fan_speed_list` and a dozen more
option lists, 218 entities of which 115 are primary, and **no area at all** by either route.

`vacuum` is one of the domains where HA defines **no device classes whatsoever**. This entity
reports **`device_class: dreame_vacuum`**. So `device_class` is an **open vocabulary** — an
integration can put anything there, and a renderer keyed on it must treat an unknown value as
"no information", never as a match failure worth reporting.

The recorded decision already treats VA as an app-owned renderer rather than something
assembled from generic controls, so this device is **excluded** from the builder's scope. It is
listed here for the two facts it contributes — the open `device_class`, and the 115-primary
prominence problem — not as a target.

## The unused native surface

**There are 0 labels on this install.** HA's label registry is a first-class, per-entity,
per-device, per-area tagging surface that already exists, is editable in the UI, and comes back
in every registry listing. Much of the declaration below — prominence especially — could live
in labels instead of a file in this repo, which would keep it editable from HA and outlive this
project. The trade is that labels are flat strings with no schema and no nesting, so
composition and layout slots would not fit. Chris's call, not mine — flagging it as the option
it is.

## The declaration, as the gaps define it

Every field exists because the audit found HA cannot supply it. Nothing HA *does* supply
belongs here — no feature lists, no option lists, no device models, no area that a device
already carries.

```
appliance:
  id, label                     # the object as a person thinks of it
  members: [entity_id, …]       # ONLY when not already one device
  canonical: {light: …}         # which of several similar entities to drive (calibrated vs raw)
  area: area_id                 # ONLY when neither entity nor device carries one
prominence:
  hero: entity_id               # what gets the big control
  secondary: [entity_id, …]
  buried: [entity_id, …]        # for integrations that mark 115 of 218 entities primary
control_hints:
  spatial: {…}                  # a remote's key matrix — the layout IS the capability
  notches: n                    # when percentage_step does not already say it
  options: {entity_id: {show: [...], hide: [...]}}   # "Error" is not a preset a user picks
  labels: {entity_id: text}     # opaque entities (the fan's text DPs)
layout:
  slots: {portrait: …, landscape: …, desktop: …}
```

## What this means for the build

1. **Lean on HA for what a thing is and can do.** Domain, `supported_features` decoded against
   HA's own flag values, and the domain's option lists cover it; `percentage_step` even settles
   slider-versus-notches. This is the part that works.
2. **Treat `device_class` and every option list as open vocabularies.** Match on known values,
   fall through to generic on anything else, and never let an unrecognised string read as a
   defect. `dreame_vacuum` is the proof; "Error" as a preset is the second.
3. **Use `entity_category` to hide plumbing, but treat "primary" as a claim, not a verdict.**
   A per-integration prominence override is required, not optional.
4. **Do not make area-driven discovery the only path.** It reaches a third of the visible
   primary entities. Either areas get assigned to what matters, or there is an unplaced bucket.
5. **Assign an area to every helper at creation**, or it is invisible to the graph — and do not
   group by device alone, or user-created entities disappear.
6. **Ids for identity, names for display, parse neither.** `bedroom` displays as "Heidi and
   chris Room"; `gtill` is misspelled in both fields; a model string carries "(big tv)".
7. **Build against the remote first.** It is the only case with zero capability information, so
   it is the one that tests whether the declaration carries real weight.

## Regenerating this

WebSocket: `config/entity_registry/list`, `config/device_registry/list`,
`config/area_registry/list`, `config/floor_registry/list`, `config/label_registry/list`,
`search/related` (`item_type` entity|device|area, `item_id`). REST: `/api/states`,
`/api/template` for `floors()`/`labels()`. Feature flags:
`homeassistant/components/<domain>/const.py` at the matching HA tag, class
`<Domain>EntityFeature(IntFlag)` — read them, do not remember them.
