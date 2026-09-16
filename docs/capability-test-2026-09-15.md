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

### …and they disagree about whether it is even on

One television, read in a single pass while it was **on**:

| integration | entity | state | last changed |
|---|---|---|---|
| `samsungtv` | `media_player.big_tv_un55au8000fxza` | **on** | 00:27:07 |
| `samsungtv` | `remote.big_tv_un55au8000fxza` | **on** | 00:27:07 |
| `samsungtv_smart` | `media_player.big_tv_2` | **off** | 22:58:42 |
| `samsungtv_smart` | `remote.big_tv` | **unknown** | 22:58:47 |
| `dlna_dmr` | `media_player.big_tv_3` | **idle** | 00:27:08 |
| `smartthings` | `media_player.heidi_and_chris_room_big_tv` | **unavailable** | 00:22:15 |
| `samsungtv` | `media_player.big_tv` | **no state at all** | — |

Simultaneously on, off, unknown, idle, unavailable and nonexistent.

**Read the timestamps, not the states.** `samsungtv` updated seconds before the read.
`samsungtv_smart` last changed 90 minutes earlier and is pinned at `off` while the set is on — it
is not disagreeing, it has stopped updating. Chris had already said *"`remote.big_tv_un55au8000fxza`
works, nothing else seems to"*; this is that, measured.

**This is the strongest case for the designer found so far.** *"Put Big TV here"* is not a simple
request: there are six candidates and five produce a row that lies. HA's own picker lists all six
alphabetically with no hint which one tracks reality, which is why choosing correctly today is
folklore.

And the ranking needs no configuration — it is derivable from data already on the entity:

| signal | means |
|---|---|
| `last_changed` freshness vs its siblings | is this one still tracking? |
| `restored: True` | nothing is behind it; its capabilities are fiction |
| `assumed_state: True` | the state is inferred, not observed |
| count of decoded `supported_features` | how much can it actually do |
| absent from `/api/states` | registered, resolves in YAML, has no state |

A designer that says *"use `big_tv_un55au8000fxza` — it updated 3 seconds ago; the other five are
stale, assumed or dead"* is doing something nothing in Home Assistant does today. That is the
feature, and it fell out of the measurement rather than the design.

### App launching — the mechanism IS discoverable, the vocabulary is not

> **Corrected.** This section first read "app launching is not discoverable — and there is no
> generic mechanism." That was wrong, and wrong in the way worth recording: the check looked at
> `source_list`, `activity_list` and the service registry for something *named* "app", found
> nothing, and concluded no. The mechanism was `media_player.browse_media`, sitting in the service
> list the same check had already printed. A wrong "no" needs a mechanism before you believe it.

Measured with an Android TV live (it had earlier been offline):

```
media_player.android_tv_2   on
  app_id:        'com.tcl.tv'      <- what is RUNNING, readable
  app_name:      'com.tcl.tv'      <- a package id, not a label
  assumed_state: True
  supported_features: … PLAY_MEDIA, BROWSE_MEDIA

remote.android_tv           on
  current_activity: 'com.tcl.tv'
  activity_list:    0 entries      <- what is INSTALLED, empty
```

So, precisely:

| question | answer |
|---|---|
| can I read what is running? | **yes** — `app_id` / `current_activity` |
| can I launch a known app? | **yes** — `remote.turn_on` with an activity, or `play_media` |
| can I discover which apps exist? | **no** — `activity_list` is empty |
| will it give me a display name? | **no** — `app_name` equals `app_id` |

Samsung is the same shape from the other side: `source_list` is `['TV','HDMI']`, and
`samsungtv_smart` takes an app list the user writes into its configuration. Neither platform
enumerates apps; both will launch one you name.

**So app tiles need a declared map** — `{label, package, colour}` per platform
(`com.netflix.ninja`, `com.google.android.youtube.tv`, `com.plexapp.android`). Authored once,
shared by anyone with that platform. The fifth appearance of the runtime config dict.

### Probed live on Big TV: the flags are wrong in both directions

With permission, two calls against the one television Chris confirmed works.

**Control — it really does drive the hardware.** `media_player.volume_up` on the `samsungtv`
entity moved `volume_level` 0.21 → 0.22, the entity reported the new value back, and Chris
confirmed the volume indicator appeared on the screen. Command and observation both real; this is
not an assumed state.

**Apps — no, and the two failures disagree with the flags:**

| entity | declares `BROWSE_MEDIA`? | result |
|---|---|---|
| `media_player.big_tv_un55au8000fxza` (`samsungtv`) | no | **500 Internal Server Error** |
| `media_player.big_tv_2` (`samsungtv_smart`) | no | **succeeded** — returned HA's own media library |

The second returned `media-source://` — *AI generated images, Camera, Image, Image upload, My
media, Radio Browser, Text-to-speech*. Home Assistant's generic media registry, answering on the
TV's behalf. Seven children, zero apps, from a call that looks like it worked.

So Big TV has no apps by any route: `source_list` is `['TV','HDMI']`, which is inputs. The
app-tile renderer should not be offered here — constrained choice working correctly, answering no.

**But the flags failed in both directions at once.** One entity did not declare the feature and
threw; another did not declare it and answered with something irrelevant. Neither the presence nor
the absence of a bit predicted the behaviour.

> **This limits the whole model.** `supported_features` yields a *candidate* set, not a verified
> one, and nothing on the entity says which. So the designer cannot be purely declarative — it
> needs a **probe** affordance: offer the renderer, let the user try it once, record the result
> against that entity. Exactly what was done here by hand. A capability is a claim until something
> has called it.

### `assumed_state` is a sixth honesty level

`media_player.android_tv_2` carries `assumed_state: True` — the integration is *inferring*
on/off, not observing it. Given design rule 7's requirement that the row tell you what is real
without opening the entity, an assumed state is a **claim, not an observation**, and should not
look identical to a reported one.

### A caution about reading `restored: True`

> **Corrected.** This document first read three entities flipping to `restored: True` at an
> identical timestamp as "an integration going away rather than a device going offline." Wrong —
> the Android TV's wifi was off. A device that is unreachable at setup makes its config entry fail,
> the entities are never created, and HA restores them from the registry. An identical timestamp
> across several entities means *one setup attempt*, which is equally consistent with one dead
> device. The restored flag says the integration is not providing the entity. It does not say why.

---

### A restored entity reports capabilities it cannot deliver

Found by asking what one specific Android TV reported. It did not exist — but the three that do,
all report this:

```
media_player.android_tv     unavailable   restored: True   supported_features=131968
media_player.android_tv_2   unavailable   restored: True   supported_features=153529
remote.android_tv           unavailable   restored: True   supported_features=4
```

`restored: True` means **no integration is currently providing the entity**. HA recreates it from
the entity registry so the id keeps resolving, and there is nothing behind it. All three flipped
at the identical timestamp (`2026-09-13T22:58:44Z`), which is an integration going away rather
than a device going offline.

**They still report `supported_features`.** Those numbers are restored registry values, not live
capability. A designer that queries a restored entity gets a confident, detailed, fictional answer
about what it can do — which is *worse* than `unavailable`, because unavailable admits it knows
nothing and this does not.

So the capability query needs a guard before it trusts anything: **`restored: True` invalidates
every capability the entity reports.** Treat it as "unknown capabilities", never as the set it
claims. Same shape as design rule 7 — distinct causes of absence must not be merged — applied to
capabilities rather than to state.

It is also the requirement proving itself: three entities died two days before anyone noticed,
because nothing surfaced it. The row design in rule 7 would have put `3 DOWN` on a section bar
that evening.

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
