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

**Scoped. Not started.** See [docs/SCOPE.md](docs/SCOPE.md) for what is settled, what is
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
tools/
  extract-card-vars.sh    regenerates card-vocabularies/ from installed bundles
```

## Related repos

| repo | role here |
|---|---|
| `token-theme-kit` | the token engine. Public, MIT. Stays generic — the dashboard describes itself *to* it. |
| `eufy-vacuum-manager` | the app-renderer torture test, and the source of the `panel_custom` and adapter patterns |
| `ha-adapter-pattern` | the written guide to runtime-configurable adapter registries — the capability-normalization pattern |
| `ha-prime-polaris-card` | a second app-owned card, so VA is not the only consumer |
