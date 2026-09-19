# Dashboard Builder

A Home Assistant dashboard that understands what a control *means*, then picks a way to show it.

Private, personal, exploratory. A pastime while Vacuum Agent 2.2.0 soaks.

---

## The inversion

Home Assistant's normal composition model:

```
entities → cards → YAML → card_mod → theme overrides → dashboard
```

What this builds instead:

```
entities/devices → semantic capabilities → interaction intents
                 → presentation model → layout primitives
                 → semantic tokens → renderer
```

Not another pile of Lovelace cards. **The dashboard owns layout; controls occupy regions of it.**

Instead of *make a card, then theme it until it looks like part of the dashboard*, the model is
*make a dashboard, and controls occupy regions of it.*

## The stop line

**Abstract far for ordinary HA controls. Stop when the thing has become an application.**

A light, a fan, a remote — those render from semantic capabilities. Vacuum Agent does not get
rebuilt from generic buttons; it plugs in as an app-owned renderer that participates in the
layout contract, the token vocabulary, and the interaction conventions. Trying to teach a generic
renderer about VA's profiles, access graph, map transforms and learning would recreate VA badly.

## Status

**Dashboard 1.0 is built:** the panel, with tabs of tiles on a snap grid and phone status rows
([panel/README.md](panel/README.md)). The controls it hosts are the level-2 cards below, each a
thin element over a tested core. See [docs/SCOPE.md](docs/SCOPE.md) for what is settled, what is
unproven, and what would kill the architecture.

Read [docs/design-source.md](docs/design-source.md) first — it is the origin document. SCOPE.md is
the delta against it and deliberately does not restate it.

## Non-goals

- Another universal Lovelace card framework.
- Recreating the current ecosystem as `semantic-button-card`, `semantic-slider-card`, … — that
  loses the entire architectural advantage.
- Absorbing dashboard logic into `token-theme-kit`. The kit stays a generic token engine.
- "Paste arbitrary card YAML here" as the normal escape hatch. New presentation requirements
  should become registered renderer primitives.

## Layout

```
docs/
  design-source.md        the origin document — the idea, in full
  SCOPE.md                the delta: what is reusable, what is unproven, what kills it
  design-rules.md         ten rules, each from a failure mode; three bind the capability layer
  capability-test-2026-09-15.md   can we query an entity for what it can do? partly — measured
  samsung-tv-local-control.md     the whole TV control surface, local — measured against the set
  card-vocabularies/      measured CSS custom properties of the installed cards
panel/                    dashboard 1.0 — the panel, the grid rules, the renderer registry, the theme tab
vendor/token-theme-kit/   a hashed copy of the kit (MIT) — the panel has no bundler; never edit it here
cards/
  builder-debug-card/     level 1: entity -> record (capability-core), shown raw
  appliance-card/         fan + light as one appliance (control-core)
  tv-card/                a TV that only claims what the set confirms (tv-core)
  readings-card/          sensors, weather and robot glances (readings-core; no card yet)
  samsung-tvplus-card/    a finished, standalone card — no integration, no cloud account
ha-config/packages/       the HA-side pieces: last level, presets, colour correction, the panel
tokens/lcars/             the LCARS token vocabulary, mined from the installed themes
tools/
  deploy.py               versioned deploy to HA — verifies, switches, repoints resources
  vendor-kit.py           re-copies token-theme-kit into vendor/, recording its commit and hashes
  gen-panel-tokens.py     writes panel/token-groups.js from tokens/lcars/core-tokens.json
  extract-card-vars.sh    regenerates card-vocabularies/ from installed bundles
```

## Related repos

| repo | role here |
|---|---|
| `token-theme-kit` | the token engine. Public, MIT. Stays generic — the dashboard describes itself *to* it. |
| `eufy-vacuum-manager` | the app-renderer torture test, and the source of the `panel_custom` and adapter patterns |
| `ha-adapter-pattern` | the written guide to runtime-configurable adapter registries — the capability-normalization pattern |
| `ha-prime-polaris-card` | a second app-owned card, so VA is not the only consumer |
