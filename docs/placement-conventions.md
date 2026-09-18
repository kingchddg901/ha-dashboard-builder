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

* Members resolve to the group's **own area** → a *local* control. `light.bathroom` over its
  three bulbs, `light.hall_front_2` over its two. One control standing in for several things in
  the same place; the group and its members will both answer a query for that area, and the
  dashboard decides which to show.
* Members resolve to **other** areas → the group's area is a **parent** of those areas. That is
  `hallway`, and `public_areas`.

Nothing is named specially, no label or prefix is required, and a user who happens to build that
shape without reading this gets the hierarchy anyway — because the shape genuinely means what
the rule says it means.

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
