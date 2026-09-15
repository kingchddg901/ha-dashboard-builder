# Design source — Semantic Home Assistant Dashboard + Token Theme Kit

> **Provenance.** Chris's own handoff, worked out with GPT and pasted into a Claude Code session
> on 2026-09-15. Transcribed here so the repo's origin document is under version control rather
> than living in a chat log. If you still have the original, diff it — this is a transcription.
>
> This file is the **idea**. [SCOPE.md](SCOPE.md) is the delta against it: what is already on
> disk, what is unproven, and what would kill it. SCOPE deliberately does not restate this.

---

## Core idea

The project idea grew out of dissatisfaction with the normal Home Assistant composition model:

```
entities → cards → YAML → card_mod → theme overrides → dashboard
```

The proposed inversion is:

```
entities/devices → semantic capabilities → interaction intents → presentation model
                 → layout primitives → semantic tokens → renderer
```

The goal is not to build another collection of Lovelace cards. It is to build a dashboard system
that understands what a control *means*, then chooses an appropriate way to present it.

Instead of:

> Make a card, then theme the card until it looks like part of the dashboard.

the model becomes:

> Make a dashboard. Controls occupy regions of that dashboard.

This came partly from the existing LCARS dashboard. The thing worth preserving is the layout and
interaction character, not the current pile of Lovelace/card_mod glue.

## Existing UI examples that drove the idea

The current dashboard is mostly ordinary Lovelace plumbing around a surprisingly small number of
actual interactions:

- lights/sliders
- compound ceiling fan
- TV remote
- vacuum
- stock HA entities
- popups / selectors

Some interactions from existing cards are excellent, but the desire is to take the interaction
pattern rather than depend on the card.

**Big Slider.** The useful thing is not `big-slider-card` itself. It is: *"For this semantic
control, a large direct-manipulation slider is a good renderer."*

**Bubble-style popup.** Again, preserve the interaction/layout concept, not the external card
dependency.

**TV remote.** This can be modeled as a small semantic command surface:

```
up  down  left  right  select  back  home  menu
power  volume_up  volume_down  mute  play_pause  ...
```

Then a D-pad / remote-grid renderer consumes those intents.

**Compound ceiling fan.** This is useful as a torture test because it is not merely `fan.foo`.
It is one appliance with related semantics:

```
fan power        fan speed        fan direction
light power      light brightness light color / temperature
```

The dashboard should understand that relationship rather than just discovering six unrelated
entities.

**Vacuum Agent.** VA is the opposite extreme: it is already an application. The dashboard should
not attempt to rebuild VA from generic buttons. It should allow an app-owned renderer such as:

```yaml
type: custom:vacuum-agent-dashboard
vacuum_entity_id: vacuum.robin
```

Potential VA presentation modes could be: `full application`, `map + interaction`, `compact`. The
map-only/compact modes should still reuse VA's own map and semantic systems rather than the
dashboard duplicating them.

## Semantic layer

The important abstraction is between HA's raw entities and the renderer:

```
Home Assistant → entity/device discovery → capability normalization
               → semantic component model → interaction intent → renderer selection
```

A light should not fundamentally be:

```yaml
entity_id: light.kitchen
domain: light
supported_features: 44
```

The presentation layer should receive something closer to:

```yaml
kind: light
capabilities:
  power: true
  brightness: true
  color_temperature: true
  rgb: false
```

Likewise a fan could expose `kind: fan` with `power`, `speed`, `direction`.

From there, the presentation system can decide *brightness-capable light → slider renderer* or
*brightness-capable light → compact button + popup renderer*, without changing the underlying
semantic component. That means renderer choice becomes **configuration**, rather than the user
replacing one entire card implementation with another.

The phrase from the earlier discussion was essentially: *"I like how that card does X"* becomes
*"implement X as another renderer choice."*

## Token Theme Kit

The existing `kingchddg901/token-theme-kit` is already abstract enough to serve as the styling
engine. Its thesis: declare a design token in a group file → the editor builds its own UI for it →
users re-theme through the editor rather than touching CSS.

Its conceptual architecture is `Token Registry → Resolver → Renderer / target adapter`.

The durable abstraction is not CSS. It is: token vocabulary + metadata + values +
relationships/validation → intermediate theme model → target adapter. CSS variables happen to be
one output target.

The kit already separates the important extension points around `registerTokenGroup`,
`registerControlType`, `registerValidator`, `setAdapter`, with presentation widgets registered
independently.

The core should remain domain agnostic. It should not learn Home Assistant dashboards, vacuums,
lights, etc. Instead: **the dashboard describes itself to Token Theme Kit using tokens.**

## Semantic token structure

A possible stable core vocabulary:

```
core/        surface  text  border  accent  state
             typography  spacing  elevation  motion
controls/    button  toggle  slider  selector  navigation
containers/  panel  popup  sheet  header  footer
```

Then domain-specific extensions can exist: `light/ fan/ climate/ media/ remote/ vacuum/ map/`.

The important rule is not to make the token registry the union of every styling knob every
component has ever exposed. There should be: **stable semantic core + optional domain extensions +
fallbacks.** A component that understands only the core can still render acceptably. A component
that understands `vacuum.map.room.selected.surface` can consume a richer extension when one exists.

## Theme precedence

```
built-in semantic defaults
  → Home Assistant theme adapter
    → semantic theme pack
      → component/domain extension
        → explicit local override
```

That lets existing HA themes contribute where their vocabulary maps cleanly without making Home
Assistant's current theme variables the architectural foundation.

That distinction matters because HA's normal theme system is weak as a cross-component design
language. Individual cards invent their own variables, Shadow DOM boundaries complicate
application, and `card_mod` frequently becomes a retrofit layer. The new system should provide the
shared vocabulary card authors currently lack.

## Theme authoring UX

This should follow the same philosophy as Vacuum Agent setup: **the normal path should not require
YAML.** Token Theme Kit already supports the idea that declaration metadata generates the editor
itself. So a dashboard token such as `control.slider.track.height` (type `size`, group `sliders`)
should automatically result in an appropriate editor control. Adding a token should not mean adding
bespoke editor UI.

The existing theme-system lesson is important here: declarations should drive **both**
`declaration → runtime value / CSS variable` **and** `declaration → editor model / control`.

The user should be manipulating a design system, not editing CSS disguised as JSON.

## Complex components versus generic rendering

Not everything should be flattened into generic controls. The likely boundary:

> Simple things are rendered from semantic capabilities. Complex applications may render
> themselves, but participate in common contracts.

An app-owned renderer should still respect: layout contract, semantic theme tokens, interaction
conventions, responsive shell, possibly navigation/popup contracts.

Vacuum Agent is the obvious example. Trying to make the generic dashboard renderer understand VA's
profiles, access graph, map transforms, learning, maintenance, zones, current-room tracking, etc.
would simply recreate VA badly. Instead, VA plugs into the dashboard as a first-class application
surface.

## Layout

The dashboard itself should own layout instead of composing independently styled cards:

```
Dashboard
 ├── region ── semantic control
 │          └─ semantic control
 ├── region ── application renderer
 └── region ── navigation / status
```

That makes things such as LCARS framing native rather than something `card_mod` paints around
several unrelated cards afterward. This also gives the system control over responsive behavior
globally rather than every card independently guessing how much space it has.

## Configuration philosophy

The system should discover as much as possible. The user should primarily be saying things such
as: *"Put kitchen lighting here. Use the large-slider renderer. Put TV controls here. Put Vacuum
Agent here in compact mode."*

rather than: *"Instantiate custom card X. Provide sixteen implementation-specific properties.
Inject this CSS. Add card_mod selector. Override these Shadow DOM internals."*

**Configuration describes intent and exceptions, not implementation plumbing.**

## Important non-goals

Do not turn this into another universal Lovelace card framework, and do not recreate the current
ecosystem as `semantic-button-card`, `semantic-slider-card`, `semantic-fan-card`,
`semantic-remote-card`, … That loses the architectural advantage.

Likewise, Token Theme Kit should not absorb dashboard logic. It remains the generic token engine.

And avoid arbitrary escape hatches becoming the normal solution. There will probably need to be an
extension boundary, but ideally new presentation requirements become registered renderer
primitives, not "paste arbitrary card YAML here" every time something unusual appears.

## Useful torture tests

Before trusting the abstraction, make it successfully express four very different things:

1. A brightness light using the Big-Slider interaction pattern.
2. The compound fan/light appliance.
3. A TV remote with a spatial D-pad/button matrix.
4. Vacuum Agent as an app-owned renderer with map/application behavior.

If the architecture can represent all four without special-casing the entire system around any one
of them, the abstraction is probably in the right place.

The compound fan tests capability composition. The remote tests nonlinear/spatial controls. The
light tests simple semantic auto-rendering. VA tests the complex-application extension boundary.

> SCOPE §4 reverses this ORDER on the grounds that the light cannot fail and therefore proves
> nothing. The set of four is unchanged.

## Where the thought had reached

The important realization was that there may not actually need to be much new theme architecture.
Token Theme Kit is already sufficiently abstract. The dashboard needs to expose the right semantic
tokens and renderer metadata to it.

> SCOPE §2.1 qualifies this: the kit's *shape* is right, but two gaps are measured — it has no HA
> **theme** adapter (only a persistence adapter), and 411 tokens has never actually been run
> through it.

So the likely project decomposition is:

```
Home Assistant
  → semantic capability layer
    → presentation / intent model
      → generic renderers  +  app renderers
        → layout engine
          → Token Theme Kit
            → rendered UI
```

The unanswered architectural question was essentially: *how far can rendering itself be abstracted
before the exceptions become more complicated than simply allowing a domain application to own its
presentation?*

The working answer: **very far for ordinary HA controls; stop when the thing has become an
application.**

That leaves a pretty clean separation:

- Home Assistant provides state and actions.
- The semantic layer says what those things mean.
- The dashboard says where and how interactions appear.
- Token Theme Kit says what the visual system looks like.
- Domain applications such as Vacuum Agent retain ownership of genuinely complex UX.
