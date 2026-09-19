# Card vocabularies — what the installed cards actually read

Measured 2026-09-15 from the shipped bundles in `\\192.168.4.104\config\www\community`, not from
documentation. Regenerate with `tools/extract-card-vars.sh`; re-run after a HACS update.

**What this measures:** `var(--x)` *reads*. A card may also set properties it never reads back —
those are invisible here by design, because a mapping can only target something the card reads.

**Why it exists:** the outbound half of theme hand-off (SCOPE §2.4) needs a mapping per foreign
card *type*, from semantic token to that card's variable vocabulary. The bundle is the only
trustworthy source — docs lag, and a renamed internal is exactly the drift a mapping must survive.

---

## Results

| card | total | card-owned | shared/HA | namespace |
|---|---|---|---|---|
| lovelace-mushroom-better-sliders | 316 | 177 | 139 | `--mush-*` (rides mushroom) |
| lovelace-mushroom | 265 | 178 | 87 | `--mush-*` |
| Bubble-Card | 185 | 137 | 48 | `--bubble-*` |
| lovelace-xiaomi-vacuum-map-card | 146 | 140 | 6 | own |
| todo-swipe-card | 93 | 67 | 26 | own |
| universal-remote-card | 72 | 38 | 34 | `--md-*` / `--mdc-*` (Material) |
| button-card | 59 | 34 | 25 | `--button-*` |
| lovelace-big-slider-card | 54 | 34 | 20 | `--bsc-*` |
| scheduler-card | 42 | 16 | 26 | own |
| **cb-lcars** | **11** | **2** | **9** | *none* |
| ha-prime-polaris-card | 2 | 0 | 2 | *none* |

Full per-card lists in the `.txt` files beside this one, split into card-owned and shared.

---

## Findings

### 1. Every themeable card has an owned prefix, and that prefix is the mapping target

`--mush-*`, `--bubble-*`, `--bsc-*`, `--button-*`. This is the shape SCOPE §2.4 predicted, now
measured. An outbound adapter is a `{semantic token → that card's var}` dict, registered at
runtime — the same shape as `ha-adapter-pattern`.

### 2. The vocabularies are semantic, so mappings are small

You do not map 178 variables. You map the dozen or two that carry the look:

```
--bsc-active-color       --bsc-icon-color        --bsc-border-radius
--bsc-slider-color       --bsc-off-color         --bsc-primary-text-color
--mush-control-border-radius   --mush-icon-size   --mush-card-primary-font-size
```

These are already named in semantic terms. ~15–25 entries per card, not hundreds.

### 3. cb-lcars is not themeable by CSS variables at all — and this vindicates rebuilding

11 variables read, **2** of them card-owned. cb-lcars is a `button-card` template library: its
look lives in YAML templates, not in a custom-property vocabulary. There is nothing to map into.

So "LCARS-native first-class citizens" **cannot** be reached by mapping tokens into cb-lcars. That
is not a defeat — it is the direct evidence for rebuilding the controls, which is already the
decision (SCOPE §2.5). Worth keeping, because it is the kind of thing that gets re-litigated.

### 4. Mushroom needs a format transform, not just a rename

Mushroom carries `--mush-rgb-*` and `--rgb-*` — **RGB triples**, not hex. A mapping entry has to
transform the value, not merely alias the key. That is `token-theme-kit`'s stud #2
(`registerControlType`'s `toCss`) plus `src/color.js`, so the seam exists — but it means a mapping
entry is `{to, transform?}`, not a bare string. Design for that from the first entry.

### 5. universal-remote-card rides Material, and its names are generic enough to collide

38 card-owned, but they are `--icon-*`, `--thumb-*`, `--label-*`, `--tooltip-*` over `--md-*` /
`--mdc-*`. Mappable, but the names are generic, so scope the mapping to the card's element rather
than setting these anywhere an ancestor could leak them.

### 6. Bubble's pop-up is fully exposed — 19 dedicated variables

`--bubble-pop-up-background-color`, `-border-radius`, `-mask-top-alpha`, `-header-overlap`, … the
whole sheet is themeable.

**But that is not the complaint.** The dislike is Bubble's *build UI* — which is a configuration
problem, not a rendering one, and mapping tokens into Bubble fixes nothing about it.

The architectural read: **a pop-up / sheet is a layout primitive the dashboard should own**,
configured by the dashboard's own editor, which is the whole thesis — *configuration describes
intent, not implementation plumbing*. Wrapping Bubble would import the exact UI being rejected.
Keep the interaction pattern; own the primitive.

### 7. `ha-prime-polaris-card` reads two variables, both shared

`--error-color` and `--paper-font-body1_-_font-family`. Your own card is effectively unthemeable
today — a second consumer needing the same retrofit as VA. Reading HA's theme is host-owned
(SCOPE §2.1), so each host needs a reader. Whether the hosts share one is still undecided.

---

## What this does not answer

Whether a foreign card actually *receives* inherited custom properties from an ancestor panel, or
whether HA writes theme variables onto the card element and wins. That is SCOPE Spike C, and it
is unmeasured. Every mapping above is moot if that comes back red.
