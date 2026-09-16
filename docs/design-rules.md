# Design rules

Decided 2026-09-15 while building the [Control Rail prototype](https://claude.ai/artifact/HFAe7m78qyGKhBKcu7StZR).
Every one of these came from a failure mode, not from a look. They are constraints on renderers,
so they bind the capability layer too — noted where they do.

---

## 1. The frame is structure, not paint

The rail, elbows and bars are **grid cells that contain the controls**. Nothing reaches into a
card's internals to draw around it.

*Why:* ha-lcars paints the frame with card_mod — 201 references, 321 selector lines in the card
block alone, reaching `hui-generic-entity-row`, `hui-masonry-view`, `.card-content`, `#states`.
It falls off three ways: a selector stops matching after an HA release (silently — CSS that
matches nothing does not error), a card type nobody enumerated gets no frame at all, and card_mod
runs *after* the card renders so timing gets a vote. A frame that is a **parent** cannot fall off
a child that has never heard of it.

## 2. Configuration is a command against data, never a magic string

`uix: class: middle-left` names a CSS class in a theme you do not own. Typo it — nothing happens,
silently. Upstream renames it — your shape disappears, silently.

Every visual choice comes from a **closed set the dashboard declares**, so the editor enumerates
it, previews each option, and an invalid value cannot be expressed.

## 3. Rhythm is generated; the override is one tap

Bars run `left → large-right → right → large-left`, irregular on purpose — strict alternation
reads as a pattern rather than a cadence. A section can pin a specific one; the rest keep flowing.

*Why:* cadence should not cost four YAML edits, and a per-section choice should not cost a
per-section config block.

## 4. LCARS is a theming touch. Colour is theming

The flavour is carried by **geometry** — pill ends, the elbow, the inset label. Colour is picked
from the palette in the theme layer, not baked into the structure.

## 5. Name every control unless the glyph is genuinely universal

A d-pad arrow *is* its own name. A bell is not.

*Why:* the failure in a full-LCARS bridge panel was never the colour — it was twenty unlabelled
icons. That works on a prop because the actor presses the right one on the first take and the rest
is added in post. On a wall at 2am it does not. **An icon is shorthand for something you already
know; it is not a name.**

> **Binds the capability layer.** A renderer that cannot produce a name for a button must not
> render the button — so capabilities have to carry names, not only actions.

## 6. A lit control shows its own colour

An RGB light's knob and brightness fill take the bulb's actual colour. A light with no colour
support lights in the accent — the row cannot show a colour the device does not have, and faking
one is worse than not showing it.

> **Binds the capability layer.** "Does this report a colour" is a *presentational* capability.
> The layer has to carry those, not only actionable ones.

## 7. Off, unavailable and unknown are three states, and two of them behave differently

| state | mark | value text | behaviour |
|---|---|---|---|
| on | lit, own colour | the level | live |
| off | dimmed | `OFF` | live |
| unavailable | dashed ring, **struck through** | `UNAVAILABLE` | **inert** |
| unknown | dotted ring, **`?`** | `UNKNOWN` | **live** |

*Why the marks:* most cards grey out all three, so a dim row means "off" or "fell off the network"
or "never reported", and the only way to find out is to open the entity. Dim already means off, so
each absence needs its own mark. Three channels carry it — mark, word, and a count on the section
bar — so neither colour vision nor a glance at one column is load-bearing.

*Why the behaviour split, which matters more:* **unavailable means pressing will not help.
Unknown means pressing is how you find out.** A remote for a TV that is not answering is a lie, so
that row is inert. An unknown device is present and will take a command, so its row is fully live
— and commanding it resolves the `?`, because you now know: you just set it. Collapsing the two
loses the only fact that decides what to do.

Same shape as VA's rule that absent / unavailable / never-created / disabled are distinct causes
of absence and must not be merged.

## 8. Screen area tracks frequency of use

Everything is a row. Heavy controls — TV remotes, vacuums, the fan — are one tap deep in a sheet.

*Why:* in the current dashboard two remotes and two vacuum cards fill a page while the lights you
touch a hundred times a day are a strip at the top. That is the density inversion, and it is the
real defect behind "the UI is meh".

## 9. A row with a useful shallow action does it; a row without one is a door

A light row *is* its own slider — drag to set, tap to toggle, `⋯` for the rest. A TV row has no
shallow action worth having, so the whole row opens the sheet.

> **Binds the capability layer.** Which of the two a control gets is derivable from its
> capabilities, not per-entity config.

## 10. The escape hatch is never styled by what it escapes

The reset is `#000000` on `#ffffff` with a white outline — literals, no `var()`. Shipped in
`token-theme-kit` (`8ea5bf8`, `4918061`) with a test that fails if a `var()` appears in any reset
rule.

*Why:* a live editor may theme itself — that is live preview and it is the point. But whatever
recovers from a bad value must not be reachable by that value. A literal has no inputs, so nothing
can poison it.
