# Scope — Dashboard Builder

Adjudication of the GPT handoff against what is actually on disk. The handoff is the design;
this is the delta. Nothing here restates it — read it alongside.

**Status:** repo stood up 2026-09-15. Design and measurement only — no dashboard code yet.

**Framing (2026-09-15).** A fun pastime while VA 2.2.0 soaks — not a deadline project. And the
cards get **rebuilt as LCARS-native first-class citizens** rather than wrapped. See §2.5, which
revises §2.4 and demotes Spike C.

---

## 1. What already exists and is reusable

More than the handoff accounts for. Four of the hard problems are already solved in repos you own.

| need | what exists | where |
|---|---|---|
| dashboard owns layout, not cards | `panel_custom.async_register_panel(..., embed_iframe=False)` — a real full-area custom panel, shipping | `eufy-vacuum-manager/custom_components/eufy_vacuum/panels.py` |
| panel-mode viewport scars | `--evcc-panel-offset` measured from the viewport because panel mode draws **no** toolbar, so the `--header-height` subtraction left dead space | `eufy-vacuum-manager/src/main.js:267-295`, `src/styles/foundation.js:167` |
| capability normalization pattern | your own written guide: runtime-configurable adapter registry, entity resolution by role (§5), vocabulary registries (§6), capability gating (§8) | `ha-adapter-pattern/README.md` |
| token engine | zero-domain core, four plugin studs, pure `computeVars` / `editorModel` | `token-theme-kit/` (888 LOC, 12 files) |
| second app-renderer consumer | a second self-contained app card, not just VA | `ha-prime-polaris-card/` |

The panel one is the biggest. "A dashboard that owns layout" in HA is a `panel_custom`
registration, not a card — and you have a shipping one, including the scar tissue for the case
where HA hands you the whole area and draws no chrome.

---

## 2. Where the handoff is optimistic

### 2.1 "Token Theme Kit is already sufficiently abstract" — right shape, two named gaps

The shape is right and I'd keep it. `computeVars` and `editorModel` are pure, the core carries no
domain knowledge, and the four studs are the correct extension points. But:

**Gap A — the HA *theme* adapter does not exist.** `src/adapters/ha.js` is a *persistence*
adapter: it writes values to `frontend/set_user_data` over the websocket. The precedence ladder in
the handoff has "Home Assistant theme adapter" as layer 2 of 5 — the layer that lets existing HA
themes contribute where their vocabulary maps cleanly. Nothing in the kit reads HA's theme.
That layer is unbuilt.

This is the same gap I was scoping inside VA an hour ago, and it should be built **once, in the
kit**, where VA and the dashboard both get it.

**Gap B — 411 tokens has never actually gone through the kit.**
`test/large-registry.test.mjs` says so outright: *"the eufy_vacuum card's ~406-token registry
lives in a separate private repo, so we can't import it here — instead we reproduce its SHAPE."*
That comment is stale (VA has been public since 2026-08-01) and the test proves scale against a
synthetic stand-in, not the real registry.

### 2.2 Capability normalization is the hard part and is treated as a given

HA gives you no capability model. `supported_features` is a per-domain bitmask with no
cross-domain vocabulary, and VA already learned that a capability layer needs *two distinct kinds*
of adapter hint — confusing them shipped a defect
(`eufy-vacuum-manager/docs/dev/34-capability-detection.md`).

You have the answer written down already — `ha-adapter-pattern` is that pattern, extracted from
this exact problem. Reuse the guide, not just the idea.

### 2.3 The compound fan is not discoverable

The device registry groups entities by device, but *"this fan and this light are one appliance"*
is true for some ceiling fans and false for others — separately-paired lights, or two devices.
So composition needs **declaration**, with device-registry inference as a convenience, not as the
mechanism. The handoff defers this; the torture test forces it early, which is good.

---

## 2.4 Hand-off to foreign cards — the sharpest open question

The self-building half is settled: declare a token, the editor builds its control, VA proves it at
411 tokens. The open problem is cards **you did not write**. It splits in two, and only one half
is hard.

**Half 1 — getting values in. Already solved, by the panel decision.**
Custom properties inherit *down*. VA confirms both directions: `--evcc-*` set on the card host
reaches everything in its shadow DOM, and a *sibling* card can never see them — which is exactly
why VA separately bridges `_modalHost`, because the modal is appended to `document.body`, outside
the subtree. A `panel_custom` that owns the whole area makes every card in it a descendant, so
tokens arrive with no card_mod and no per-card wiring.

§1's panel finding and this are the same decision.

**Half 2 — getting them consumed. This is the work.**
Inheritance puts `--dash-accent` inside `mushroom-card`'s shadow DOM, but nothing in there reads
it. Mushroom reads `--mush-*`; stock HA cards read `--primary-color` / `--ha-card-background`;
`big-slider-card` reads its own. So hand-off needs a **mapping per foreign card type**.

That is the mirror of Gap A:

| direction | maps | example |
|---|---|---|
| inbound | HA theme vars → semantic tokens | `--primary-color` → `core.accent` |
| outbound | semantic tokens → foreign card vars | `core.accent` → `--mush-rgb-blue` |

Both are `{from: to}` dicts registered at runtime — the same adapter-registry pattern as
`ha-adapter-pattern`, now the **third** independent place that shape has appeared. Worth trusting.

Two honest constraints:

- **It beats card_mod structurally.** card_mod injects CSS text per card *instance*, in YAML. A
  mapping is declared once per card *type* and applies everywhere that type appears.
- **Mappings drift and cannot be tested.** Foreign cards rename internals between versions, and
  no test goes red for that without rendering the real card. So the contract cannot be fidelity —
  it must be **degradation**: an unmapped or stale card falls through to HA's own variables, which
  the dashboard sets anyway, and renders as a normal HA card in your palette rather than breaking.
  This is the handoff's "core-only component still renders acceptably", made load-bearing.

---

## 2.5 Revision — the cards get rebuilt, so §2.4 is no longer the gate

Decided 2026-09-15: rebuild the current cards as LCARS-native first-class citizens rather than
theme foreign ones into place. This is the right call and it makes the project smaller.

**What it removes.** The one constraint you do not control — a foreign card's internal variable
vocabulary, which drifts between versions and cannot be tested without rendering it. Owning both
the token vocabulary *and* every consumer is exactly VA's position, and VA's 411-token system is
the existence proof that it holds.

**Spike C is demoted** from the gate to optional. Inheritance into foreign cards only matters for
cards you did not write.

**VA becomes the hand-off test**, because it is now the only renderer NOT being rebuilt. This is
convenient rather than awkward: VA already speaks `--evcc-*`, already registers a `panel_custom`,
and already carries a 411-token registry. *"Does VA render correctly inside the dashboard panel,
inheriting the dashboard's tokens?"* is the same question as Spike C, on a card you own both ends
of. Fold C into torture test 4.

**`lcars.yaml` is already the token vocabulary.** 3109 variable lines at
`\\192.168.4.104\config\themes\lcars\lcars.yaml`. If the goal is LCARS-native controls, that file
is the de-facto design language. Mining it into a semantic core token set beats designing one on
paper, and it is the one task here that cannot go wrong. **Better first move than any spike.**

**One honest caution.** The semantic capability layer earns most of its keep when you do *not* own
the renderers — it exists to auto-select among renderers nobody coordinated. Writing all of them
yourself for LCARS, across roughly six interaction types, you could hand-place them and still get
the dashboard you want. The layer buys discovery and reuse-per-entity-kind, not necessity.

That is a fine reason to build it — the architecture is part of the point. It is worth knowing it
is a *want*, not a *must*, so that when the abstraction gets expensive you spend deliberately
rather than defending a premise. The remote and the fan still bite, and still say whether it is
in the right place.

---

## 3. What would kill the architecture

One thing: **if renderer selection needs a per-entity special case more often than not.**

If "brightness-capable light → slider" holds but "compound fan → ?" and "remote → ?" each need
bespoke handling, then the semantic layer is a lookup table wearing an abstraction, and the
honest version of the project is a small set of good hand-built renderers with shared tokens.

That is a fine outcome. It is just a different project, and it is much cheaper to discover now.

---

## 4. Torture-test order — reversed from the handoff

The handoff lists light → fan → remote → VA. Run it roughly the other way, because **the light
proves nothing.** A brightness-capable light maps to a slider under any abstraction you could
draw; a test that cannot go red is a preference, not a test.

| order | test | what it can falsify | why here |
|---|---|---|---|
| 1 | simple light | nothing — baseline | needed to stand the pipeline up, ~a day. Not evidence. |
| 2 | **TV remote** | that renderer selection is capability-driven at all | a D-pad is *spatial*. There is no capability bitmask that yields a button matrix — the intent list **is** the layout. First real bite. |
| 3 | **compound fan** | that capabilities compose | two domains, one appliance, related semantics. If this needs a special case, §3 has fired. |
| 4 | VA as app renderer | that the layout contract is real | cannot be attempted until a layout contract exists. It is the boundary test, so it goes last. |

Tests 2 and 3 are the whole experiment. If both pass without special-casing, the abstraction is
in the right place and the rest is work rather than risk.

---

## 5. Recommended first move — a spike, not a build

Two things, both hours rather than weeks, both able to come back negative:

**Spike A — prove the kit at real scale (mechanical, ~1 hour).**
Import VA's actual 411-token registry into `token-theme-kit`'s test suite and assert
`computeVars` is 1:1 and every string-valued type renders as `raw`, never a colour swatch.
Red condition: any token dropped, collided, or mistyped. Also retires the stale
"separate private repo" comment.

**Spike B — model the remote and the fan on paper (~2 hours, no code).**
Write the capability declarations for the TV remote and the compound ceiling fan, then write the
*single* renderer-selection rule you would need. If one rule covers both, build. If it needs a
branch per device kind, §3 has fired and the project changes shape before a line is committed.

**Spike C — prove hand-off by inheritance (~30 min, live box).**
The whole "no card_mod" premise rests on a foreign card inheriting custom properties from an
ancestor panel. It has one plausible failure mode: if HA's `applyThemesOnElement` writes theme
variables **onto the card element itself**, that beats anything inherited from your panel and the
premise collapses.

Check it on the live LCARS dashboard: pick one stock card, set a mapped variable on an ancestor,
see whether it takes. Red condition — the card keeps HA's value. This is the cheapest test in the
list and it gates §2.4 entirely.

Run C first (it is 30 minutes and can invalidate the most), then B. A is mechanical and can go
whenever. Nothing else should start until B and C answer.

---

## 5.5 The test dashboard, with a theme tab as the last tab

Decided 2026-09-15. This is the right first build target and it is cheaper than it looks.

**It mirrors VA exactly** — VA's theme editor is a tab inside the card it themes, and that has
shipped for months. So the pattern is proven, not speculative.

**The kit's reference editor drops straight in.** `<theme-kit-editor>`
(`token-theme-kit/src/element.js`) is a self-building web component: set `previewTarget` to the
element that receives `var(--token)`, set `kit`, done. It renders one control per token, wired to
live preview and persistence, and it is explicitly focus-safe — a value change repaints preview
and verdicts only, never the inputs, so dragging a slider does not lose focus. Roughly ten lines
of glue.

**Set `previewTarget` to the panel root, not a card.** Then every control on every tab inherits,
because custom properties inherit down through the subtree the panel owns. This is the same
mechanism as Spike C, but *inside* your own tree, where it is guaranteed rather than hopeful.

**The self-building payoff lands here.** A control declares the tokens it needs; the theme tab
grows the matching editor UI with no editor-code change. That is the whole thesis, demonstrated
in the shortest possible loop — and it is the no-YAML path for re-theming.

**One trap, already defended.** The theme tab is a descendant of its own preview target, so
editing a token restyles the editor too — a user can set a hostile value and lose the ability to
see the control that would undo it. The kit already handles this: its chrome styles itself off
`--tk-fg` / `--tk-line` / `--tk-warn` with literal fallbacks, deliberately *not* off the tokens
being edited. Keep that separation when writing a custom view; VA's hardcoded `MODAL_HOST_STYLES`
fallbacks exist for the same reason.

**Shape:** N tabs of controls (light → remote → fan → VA, per §4) + a final theme tab. Each
torture test becomes a tab. The dashboard is its own test harness.

---

## 6. Repo and licensing

- **Dashboard → new private repo.** Correct call. Personal, exploratory, and the layout/LCARS
  character is yours.
- **Kit stays public.** `token-theme-kit` is MIT. The HA theme adapter (Gap A) and the scale
  proof (Gap B) belong in it, publicly, because VA and the dashboard both consume them. Splitting
  them into the private repo forks the engine, which is the one thing the kit's own concepts doc
  argues against.
- **MIT requires keeping the notice.** Consuming the kit as a dependency is clean; vendoring the
  source into the private repo means carrying `LICENSE` with it.

---

## 7. Held, not dropped

The VA card fix — scheme-aware `:host` seed layer, driven by `hass.themes.darkMode` — is decided
but not built. It is independent of this project and stays available:

- 14 seed tokens are dark-assuming literals no built-in theme ever overrides.
- `theme_warm_light` (`surface_base="#F3EFE7"`, `text_primary="#2F2418"`) renders
  `--evcc-surface-action-hover: rgba(255,255,255,0.18)` on cream today. That is the bite test,
  and it needs no HA theme at all.
- Unverified: that `hass.themes.darkMode` exists on your HA version. It is a frontend object,
  not reachable over REST — first implementation step is reading it off the live card.
