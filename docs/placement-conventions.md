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
  the place itself, most often **one fixture**. `light.hall_back` is a single lamp holding two
  bulbs and `light.bathroom` is a three-light fixture set that *is* the room's lighting; in both
  cases the separate devices are bulbs, and the group is the only record that they are one
  object, because HA has no concept of a fixture. What that means for the controls is a separate
  question — see below.
* Members resolve to **other** areas → the group's area is a **parent** of those areas — a
  *place*, not an object. That is `hallway` and `public_areas`. Here both levels are real
  controls and **neither should be buried**: the house this came from uses the zone when it
  wants the whole hall lit and a single child when it does not, which is the entire reason the
  child areas were split out.

Nothing is named specially, no label or prefix is required, and a user who happens to build that
shape without reading this gets the hierarchy anyway — because the shape genuinely means what
the rule says it means.

## The one question worth asking: are the parts used?

It is tempting to ask "is this one fixture or several things grouped?" and hide the parts of a
fixture. The bathroom kills that rule. It is a **three-light fixture set** — one object, and it
*is* the room's lighting — and its bulbs are still controlled individually, because running one
or two instead of three is how you get less light. Identity says "one object"; the controls that
are actually wanted are per-bulb. The two do not follow from each other.

Nor can the data answer either one. These are identical in every readable field:

| | `light.hall_back` | `light.bathroom` |
|---|---|---|
| platform | matter | matter |
| manufacturer / model | Leedarson / Smart RGBTW Bulb | Leedarson / Smart RGBTW Bulb |
| device names | `Hall back1`, `Hall back2` | `Bathroom1`, `Bathroom2`, `Bathroom3` |
| area | all `hall_back` | all `washroom` |

Same platform, model, trailing-digit naming, area and group shape. Any heuristic that gets one
right gets the other wrong.

So ask the question the dashboard actually needs, once per local group, at setup:

> **Do you ever control these individually?**

A user answers that from habit. "Is it ontologically one fixture?" they have to think about, and
the answer would not tell us what to draw anyway.

* **Yes** → open by default. The bathroom, where fewer bulbs is the dimmer.
* **No** → closed by default.

Note what that is *not*: nothing is hidden either way. With a nested control (below) the parts
are always one click away, so the answer sets a default and nothing else. **Unanswered means
closed**, and being wrong costs a click rather than a missing control — which also means the
answer can simply be *learned* from use, by remembering what gets opened. The checkbox is a head
start, not a requirement. A parent group needs no question at all: its members are in other
areas, so it is a place, and every level stays.

One edge: a group with no area of its own. Then "its own area" is undefined, and the fallback is
its members — if they all agree on one area, treat it as local and ask; if they spread, it is a
parent whose area was never set.

### What it renders as

One recursive disclosure control, because every level of the tree is the same shape — a control
that acts on everything beneath it, over parts that are themselves controls:

```
Public Areas ⌄
  Hallway ⌄
    Hall front ⌄
      Hallfront1
      Hall front2
    Hall center ⌄
    Hall back ⌄
  Living Room ⌄
Bathroom ⌄
  Bathroom 1
  Bathroom 2
  Bathroom 3
```

Fixture-over-bulbs and zone-over-rooms differ only in depth, so there is one renderer, not two,
and the checkbox above only decides which rows start open.

The constraint this runs into is **depth against width**. Four levels of indentation is
comfortable on a desktop and hostile at phone-portrait width, so the same tree wants two
presentations: nested in place where there is room, and drill-in — tap a row to descend, with a
breadcrumb back — where there is not. That is a presentation choice over one data shape, which
is the point: the tree is derived once and rendered per form factor.

### An affordance this suggests

If a fixture's parts are used to get less light, then *how many bulbs are lit* is a control in
its own right — "1 / 2 / 3" beside the brightness slider, not buried in three separate toggles.
Worth remembering when the renderer gets built; it is the kind of control that only exists if
the fixture is understood as one object with parts.

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
