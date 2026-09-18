# Placement conventions

Home Assistant gives you two levels of placement — a floor holds areas, an area holds devices
and entities — and nothing below that. The area record has `floor_id`, `labels`, `aliases` and
an icon; it has **no parent field**, so there are no sub-areas.

This is how to get a third level anyway, using only things the HA UI already creates. It is a
convention, not a setting: follow it and a dashboard can read your hierarchy, ignore it and
everything still works, flat.

## The convention

**An area that holds a group control, whose members live in other areas, is a parent of those
areas.**

That is the whole rule. To use it:

1. Make an area for the zone — *Hallway*.
2. Make the child areas normally — *Hall front*, *Hall center*, *Hall back* — and put the real
   lights in them.
3. Make a group over the child controls, and put **that group** in the zone's area.

The zone area now has one entity in it: the control for the whole zone. The rooms keep their
own devices. Nothing else changes.

## Worked example

The house this was derived from runs three levels:

| area | holds | whose members resolve to |
|---|---|---|
| `public_areas` | `light.main_house` | entryway, hallway, kitchen, living room, office, dining room |
| `hallway` | `light.hall_master` | hall_front, hall_center, hall_back |
| `hall_front` | `light.hall_front_2` **and** its two bulbs | hall_front |

Read top to bottom that is `public_areas > hallway > hall_front > light.hallfront1` — a path
four levels deep, in a system that stores two.

## Why it can be detected rather than declared

Both halves are readable. A group publishes its members in its `entity_id` attribute, and each
member's area resolves from the registry (its own, or its device's). So one predicate separates
the two kinds of group:

* Members resolve to the group's **own area** → the group is a thing in that place rather than
  the place itself. It is either *one fixture* (`light.hall_back` is a single lamp holding two
  bulbs — `Hall back1` and `Hall back2` are separate devices because HA has no concept of a
  fixture, so the group is the only record that they are one object) or *a mental grouping*
  (`light.bathroom` is three separate lamps the household thinks of as one). Those two need
  different handling and **no rule can tell them apart** — see below.
* Members resolve to **other** areas → the group's area is a **parent** of those areas — a
  *place*, not an object. That is `hallway` and `public_areas`. Here both levels are real
  controls and **neither should be buried**: the house this came from uses the zone when it
  wants the whole hall lit and a single child when it does not, which is the entire reason the
  child areas were split out.

Nothing is named specially, no label or prefix is required, and a user who happens to build that
shape without reading this gets the hierarchy anyway — because the shape genuinely means what
the rule says it means.

## The one question worth asking: fixture, or mental grouping?

For a group whose members sit in its own area, the data cannot say which kind it is. These two
are identical in every readable field:

| | `light.hall_back` — one lamp, two bulbs | `light.bathroom` — three lamps |
|---|---|---|
| platform | matter | matter |
| manufacturer / model | Leedarson / Smart RGBTW Bulb | Leedarson / Smart RGBTW Bulb |
| device names | `Hall back1`, `Hall back2` | `Bathroom1`, `Bathroom2`, `Bathroom3` |
| area | all `hall_back` | all `washroom` |

Same platform, same model, same trailing-digit naming, same area, same group shape. Any
heuristic that calls the first a fixture calls the second one too, and is wrong. The difference
is physical and exists nowhere in the system.

So **ask, once, at setup: is this a fixture or a grouping?** One checkbox per local group — six
for the house above — and it is the first thing in this project that genuinely cannot be
derived, which is exactly what a declaration is for.

What the answer changes:

* **Fixture** → the parts are not independently meaningful. Nobody lights half a lamp. Show the
  object; keep the bulbs for diagnostics.
* **Mental grouping** → the parts *are* meaningful. Someone may want the vanity light without
  the shower light. Show the group, collapsed, with the members reachable.

**Default when unanswered: mental grouping.** Hiding a control someone needs is worse than
showing one they do not, so the safe default never removes function. A parent group needs no
question at all — its members are in other areas, so it is a place, and both levels stay.

One edge: a group with no area of its own. Then "its own area" is undefined, and the fallback is
its members — if they all agree on one area, treat it as local and ask the question; if they
spread, it is a parent whose area was never set.

## What the shape does not tell you

The levels exist for reasons that are nowhere in Home Assistant. In the house above, the hall is
split three ways because **the back fixture spills into the living room and the front one into
the bedroom** — so "hall back only" and "hall front only" are the controls that let one room
stay dark while another is lit.

Nothing in HA models adjacency or spill. The group tree is the *trace* of that knowledge, and it
is enough to build the right controls — the granularities are all there. What it cannot
reconstruct is **why**, which is what a control needs to explain itself: *Back — keeps light out
of the living room*. That sentence is real user knowledge, it is one line per control, and it is
a better use of a declaration file than anything the registry can already answer.

## What it does not require

* **No declaration file.** The hierarchy comes out of the registry and the states.
* **No cooperation from HA.** Both pieces are UI-creatable: an area, and a group helper.
* **No purity.** The rule keys on the group, not on the area being otherwise empty, so a zone
  area that also holds a thermostat still reads as a zone. (In the house above the zone areas
  hold exactly one entity each, but nothing depends on that.)
* **No adoption.** Ignore all of this and areas stay flat, which is what every install does
  today: an uncurated registry resolves about a third of its entities to an area at all.

## What HA still will not do

It will not **navigate** it. The areas UI shows `hallway` and `hall_front` as siblings, because
to HA they are siblings — the parent relationship exists in the data but not in the model. That
is a presentation gap, and a dashboard is the thing that can close it.

Two open questions, deliberately undecided here:

* **Multiple parents.** Nothing stops two groups in different areas from both containing the
  same child, which makes the structure a graph rather than a tree. Not present in the house
  above; a renderer needs a rule before it meets one.
* **Marking zones.** A zone area looks empty in the HA UI apart from its group, which will read
  as a mistake to anyone who did not build it. Worth surfacing as *zone* in a dashboard rather
  than leaving it to be rediscovered.

## Related

* [`ha-hint-audit.md`](ha-hint-audit.md) — what HA answers on its own, measured.
* [`../cards/builder-debug-card/`](../cards/builder-debug-card/) — the capability layer that
  reads these hints, and the debug view onto it.
