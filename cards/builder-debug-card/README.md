# Builder debug card — level 1

The first working piece of the dashboard builder, and deliberately ugly. It answers one
question for every entity you point it at: **what will Home Assistant tell us about this,
before anyone decides what control to draw?**

For each entity it shows the friendly name *and* the entity id, the state, then the hints:

| row | why it is there |
|---|---|
| domain / platform | the platform is how you tell a template entity or a light group from a real device |
| `entity_category` | the best "is this worth showing" filter HA has — and only a claim; one integration marks 2 of 21 entities primary, another 115 of 218 |
| area | with **how** it resolved: on the entity, inherited from the device, or not at all |
| device | plus every sibling on it and how many are primary, which is where "these are one appliance" comes from when it comes for free |
| `supported_features` | decoded against HA's own flag values; `0` is shown as a real answer, and any bit missing from the table shows as `bit N` rather than vanishing |
| `device_class` | with whether the value is in that domain's set. It is an **open** vocabulary — `vacuum.robin` reports `dreame_vacuum` in a domain that defines none |
| capabilities | the limit-shaped attributes only (colour modes, kelvin range, option lists, `percentage_step`), never the live values |
| raw attributes | the whole dump, collapsed |

The measurements behind those choices are in [`../../docs/ha-hint-audit.md`](../../docs/ha-hint-audit.md).

## Use

```yaml
type: custom:builder-debug-card
domains: [light]                  # default [light]
area: bedroom                     # optional, filters on the RESOLVED area (either route)
entities: [remote.big_tv]         # optional, overrides domains
raw: true                         # attribute dump, default true
title: Lights — level 1
```

Resource: `/local/dashboard-builder/builder-debug-card.js` as a **module** — it imports
`capability-core.js` from the same folder, so both files ship together.

## Shape

`capability-core.js` holds the rules and has no DOM and no Home Assistant in it, so the same
answers can feed a renderer later. `builder-debug-card.js` is the Lovelace adapter and is the
disposable half — same split as the TV Plus card.

```bash
node --test cards/builder-debug-card/test/capability-core.test.mjs
```

22 tests. The fixture is generated from a real registry and state dump, so the numbers in it
are what the house actually reports — 21 entities on the fan device, `4566 K` on the
calibrated light, `Error` among the grill's presets. Each test comments the input that turns
it red; two were checked by ablation, and one of those (area precedence) only became able to
fail after the conflict case was added, because no entity on the live box has both an
entity-level area and a device area to disagree with.

## Known limits

* Reading only. It proves what HA says a thing can do; it does not prove anything can be
  driven. The first control that actually writes is the next step, not this.
* `hass.entities` / `hass.devices` / `hass.areas` come from the frontend's display registry, so
  disabled entities are absent and the card says so when a registry is missing entirely.
* The layout breakpoint is a **container** query, not a viewport one, because a card lives in a
  dashboard column: measured collapsing at a card width of 480px and holding two columns at
  700px, independent of screen size.
