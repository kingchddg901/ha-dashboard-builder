# The panel — dashboard 1.0

The base everything else sits in. The panel owns the whole area and the render; tiles are
**shapes** on a snap grid, and what fills each one is a declaration handed to a renderer.

    layout-core.js       the grid rules — no DOM, no HA, tested
    renderers.js         the closed set a tile can hold, and each one's phone-row summary
    seed.js              the starting layout for this house — data, the same shape a saved one has
    tokens.js            LCARS token fallbacks, held to ../tokens/lcars/core-tokens.json by a test
    themes.js            the 24 mined LCARS themes as role -> colour, held to ../tokens/lcars/presets.json by a test
    token-groups.js      the theme tokens as token-theme-kit groups — generated (tools/gen-panel-tokens.py), held by a test
    panel-tokens.js      the panel's own tokens: surfaces, corners, and the frame — hand-written, same shape
    own-themes.js        starting themes written for this panel, one per frame, beside the 24 mined ones
    frame-styles.js      how each frame but LCARS draws the structure - one block per frame, scoped to it
    cockpit-art.js       the cockpit's generated greebles and grain
    theme-library.js     your saved themes, and the export envelope and ingest gate for sharing them — no DOM, tested
    theme-core.js        where each token's value comes from, what the panel writes, readable status — no DOM, tested
    dashboard-panel.js   the element — the disposable half
    loader.js            the one stable file (see Deploy)
    upgrade-props.js     replays what HA set on the panel before it was defined (see Deploy) — tested
    test/                node --test panel/test/*.mjs

## What it does

| | desk (panel ≥ 700 px wide) | phone (narrower) |
|---|---|---|
| tabs | down the rail; with more than fit, they scroll and **Edit layout** / **Theme** stay pinned at its foot | a strip under the bar; **Edit** / **Theme** pinned at its end |
| tiles | on a 12-column grid, 64 px rows | status rows, in the desk layout's reading order |
| a tile's control | inside the tile | one tap deep, in a sheet |
| editing | **Edit layout**: move, resize, send or copy to another tab, remove to the shelf, add / rename / reorder / remove tabs, reset | **Edit layout**: send or copy to another tab, remove to the shelf, add from the shelf, reorder tabs |

The grid rules, and why:

- **Tiles never overlap.** A move or resize that would overlap is refused, and the ghost says
  what is in the way. Nothing nudges a neighbour for you: a layout that rearranges itself under
  your finger is worse than one that says no.
- **Nothing is lost.** Remove puts a tile on the shelf. Damaged stored data is repaired by moving
  tiles to free space, not by dropping them. A tile whose renderer isn't loaded is kept and says so.
- **Controls pause while editing.** Tile bodies take no input in edit mode, so arranging the fan
  tile cannot also turn the fan on.
- **The phone reads the desk layout like a page.** There is no second list to keep in sync.
- **Tabs move one place at a time.** **Move up / Move down** (left / right on a phone) shifts the
  tab you are on, tiles and all; the ends refuse rather than wrap. The rail keeps its scroll
  across a redraw and brings the selected tab into view, clear of the pinned tools.
- **Phone rows follow design rule 7.** On, off, unavailable and unknown each get their own mark. An
  unavailable row is inert, and an entity the layout names but HA does not have reads as
  unavailable, never as "off".

### The words on screen

Two rules, so text reads the same wherever it comes from:

- **A line starts with a capital; the rest of the line does not.** "Off · returns to 96%", not
  "Off · Returns To 96%" and not "off · returns to 96%". Sentence case, never title case — a state
  that reads `HDMI 2`, `OK` or `72 °F` has to survive untouched, and title case mangles all three.
- **Machine words go through `sentence()`** (`cards/readings-card/readings-core.js`): underscores
  out, first letter up, nothing else altered. It is for slugs and states arriving from HA — `docked`
  becomes "Docked". Text a person wrote gets its capital from whoever wrote it, and the panel's
  status line capitalises in `_say()`, so no call site has to remember.

Relative times are written out and agree with their number: "7 days ago", "1 hour ago", "in 2 days",
"just now". The abbreviated form ("7 d ago") read as something to decode.

`test/imports.test.mjs` guards the mechanical half of this: any file that calls a shared helper and
forgets to import it fails the suite. There is no linter here, `node --check` sees only syntax, and
the suite never mounts a card — so before that test, a helper called inside a render method stayed
invisible until the browser threw and the tile drew as an error.

### What it offers to add

In **Edit layout**, the shelf lists what Home Assistant has that is not on the dashboard yet,
grouped by area (`discover-core.js`). The rules come from what this house's registry actually looks
like: a **TV** is a remote and a media player from the same integration on one device; a **fan**
comes with its device's light; a **light group** carries the bulbs in its own area; a **robot** is a
vacuum Vacuum Agent manages; and a **plug** is a switch that IS the device.

That last test earns its keep. Offer every switch and this house offers 31, of which 30 are the
robots' per-room switches and the rest are the grill's and vacuums' own toggles — controls that
belong to those devices' tiles. A switch is a tile of its own only when nothing else on its device
is (no fan, light, vacuum, climate, media player, lock, cover…), and when HA gives it a device
class of `outlet` or `switch`. With those two tests the house offers exactly one: the dishwasher
plug. Switches HA marks as settings (`entity_category`) never appear; that field is a number in the
frontend's registry and a string over the websocket, so it is read for presence, not value.

A plug's tile is 4×2 rather than the fan's 4×5 — on and off is one line of control, and at the
fan's height the tile arrived four fifths empty.

## Themes

The last tab, **Theme**, is [token-theme-kit](https://github.com/kingchddg901/token-theme-kit)'s
self-building editor. It draws one control per token: the 30 mined ones in `token-groups.js`,
then the panel's own 11 in `panel-tokens.js`, in seven groups. Add a token to either, and a
control appears. No editor code changes.

Each token's value comes in layers, bottom to top:

1. the declared default — for a token with `byFrame`, the active frame's
2. Home Assistant's theme, where it sets the variable
3. **Start from**: Black One, one of the 24 LCARS themes, or none (follow Home Assistant's theme)
4. your own changes

### Your themes, and sharing them

The Theme tab opens on a **gallery**. Every card is a small preview drawn in that theme's own
colours, labelled with its name and frame, in three groups: **Your themes**, **Written for this
panel** and **LCARS themes**. Picking one uses it whole: frame, colours, shape and light.

What you change in the token editor below is a **draft** on top of the active theme, as in
Vacuum Agent's editor:

- **Save** writes the draft into the theme, for your own themes only.
- **Save as new** makes a theme of what is on screen.
- **Discard** drops the draft.
- Picking another theme with a draft asks before discarding it.

A saved theme holds every token, so it comes back exactly, whatever the defaults are by then.
Your themes are kept per HA user under `dashboard_builder.saved_themes`. The theme in use is
stored as its name, or `user:<id>` for one of yours.

**Sharing** borrows Vacuum Agent's format and flow. **Export** copies the theme's JSON and
**Download** saves it as `<name>.dashboard-theme.json`. **Import** (paste) and **Upload** (file)
add a shared theme to your themes; they don't switch to it. The envelope is VA's shape, marked
as ours:

    { ok, kind: "dashboard-builder-theme", version: 1, exported_at, theme: { name, source, tokens } }

A shared theme is **data, never code**. It passes an ingest gate (`ingestTheme`) before anything
is stored:

- Only this panel's token keys are kept.
- A colour must parse.
- A number is clamped to its range.
- A choice must be one of its options.
- Free text (fonts, shadows) is refused if it could escape a CSS value or fetch something:
  `;`, braces, `url(`, `@import`.

What is left out or clamped is reported by name. A name already in use gets " (imported)". An
import never claims to be built in, and an author link must be `http(s)`. A Vacuum Agent export
is refused whole ("none of its settings are ones this panel has"); its `--evcc-*` vocabulary means
nothing here.

Export copies with the clipboard API where the page is secure (`https://`). On a plain `http://`
Home Assistant it falls back to the older copy command, and failing that leaves the JSON selected
to copy by hand.

### Frames

`frame` is the master token. It picks how the panel draws its structure:

- **LCARS**: elbows, pill tabs, a rail running into a band.
- **Cockpit**, after an X-wing's:
  - the top is a glare shield, one console plate with its lower corners cut away, with the time
    and the panel's name in a recessed instrument cluster
  - the rail is a separate side console, with its tabs as backlit keys with lamps and its tools
    as hazard keys
  - tiles and phone rows are faceted plates: two corners cut, with the edge drawn along the cuts
    and a screw in each of the other two
  - greebles on the frame's plates, and metal grain on every plate (below)

- **Blueprint**: line work on drafting blue. Outlines instead of fills, a dimension line for the
  band, a drafting grid behind everything, dashed tools.
- **Terminal**: a ship's computer on a phosphor screen. One hue, with brightness and inverse video
  doing the work, scanlines, and a `>` on the tab you are on. Its theme breaks the one-hue rule for
  errors on purpose, so a failure can be told from success at a glance.
- **Braun**: Dieter Rams, and the first light frame. Warm grey plates and white panels. Tabs are
  keys with a dot that takes the accent colour for what is on, and words are shown as written.
- **HUD**: a holographic overlay. Tiles are drawn as corners only, tabs are cut at one corner (the
  shared Chamfer), and the tools are amber.
- **Glass**: calm and everyday. Frosted panels over a backdrop lit by the accent and tool colours,
  with almost no chrome.
- **Field notes**: e-ink paper for a daylight wall tablet, and the second light frame. Rules and
  type, no fills, no boxes. The tab you are on is set in bold with a rule under it.

Each frame has a starting theme of the same name (Black One for the cockpit) that passes the
theme tab's own checks: text at least 4.5:1 on its colour, and status colours that need no lifting.

The frame goes on as an attribute (`data-frame`). Every frame's rules select on it
(`frame-styles.js`), so none reach another frame; a test holds that, and that every frame offered
has its own block. Colours come from the tokens in every frame.

**Greebles** (`cockpit-art.js`) are generated hardware: raised angular plates, hatches with
stencilled part numbers, conduit with clamps, slanted ribs, hex bolts and vent slots. They sit on
the shield and the side console, never on a tile's content. They are lit from one source above
(a bright top edge, a dark underside) and never emit light. A lamp on a dashboard reads as data,
and one that means nothing teaches you to ignore the ones that do. All the lighting is white or
black at low alpha, so it falls correctly on any theme's plate colour; a test holds that.

**Greeble density** (0–100%) sets how much hardware there is. The cockpit's default is 60%, and
LCARS skips it. Each surface has a fixed seed and fixed slots, and density only decides which slots
are shown. Raising it adds hardware in place, lowering it takes hardware away, nothing moves. A test
compares positions, not slot numbers: slot numbers alone passed while every module slid sideways.

**Light** is two tokens, **Light angle** (where the light comes from; 0° is above, 90° is the
right) and **Light intensity**, and one light for everything the cockpit draws as lit:

- **Greebles:** every edge's outward direction is compared with the light. An edge facing it gets
  a highlight in proportion, an edge facing away gets shadow, and a raised part casts a short
  shadow opposite the light, darker as the light gets stronger. A hole is the reverse: its far
  wall catches the light.
- **Plates:** their sheen, and the bevels of plates and keys, follow the same light through CSS
  variables the panel paints (`--db-lx`, `--db-ly` for a unit vector toward the light,
  `--db-light-k` for its strength).

At 0° and 60% everything draws exactly as before these tokens existed. The light changes shading
only, never where a greeble sits (tested). LCARS draws nothing lit, so it skips both tokens.

**Each frame declares the tokens it does not draw with** (`FRAMES[].skips`), and the theme tab
marks those controls "Not used by the Cockpit frame" rather than offering a setting that changes
nothing. Controls are marked, not hidden, so a value you set stays in view when a frame ignores
it. The mark is a kit verdict and follows the Frame control as it changes. `NOT_DRAWN` lists the
ten mined LCARS tokens this panel draws with in no frame yet. Both lists are measured, not reasoned
about. Each token was set to a loud value in each frame, in every state the panel can be in (desk,
Edit, an open sheet, phone, phone Edit). A token counts as skipped only if nothing on screen
changed, and every token not skipped changed something. Tests keep the lists honest: a frame may
not skip a token and also give it a default.

Tokens are named for what they are, never for the frame that first used it (`chamfer`, not
"Chamfer (cockpit frame)"), so the next frame to cut a corner reuses it. A test holds keys and
labels to that.

A frame brings its own shape. Tokens with `byFrame` (tab and button corners, the tile's bevel) take
the active frame's value as their default. Switching **Frame** alone reshapes the
panel, a hand-set value still beats it, and a reset returns to the frame you started from.

The panel's own tokens cover what LCARS cannot say:

- **the tile surface:** a step above the ground; `follows` the background until set
- **the tile border and the active tab:** `follows` the matching LCARS role
- **tile shadow and bevel**
- **corners:** tile, tab and button
- **the chamfer**

A `follows` token is never written unless someone chose it, so its leader still reaches it
through CSS. Every default is the LCARS frame as it was drawn before these tokens existed. A
computed-style diff of the old and new panel, on the same tab with no theme picked, differs only
in edit mode: a few small buttons' corners grow by 0–2.5px and become full pills.

**Black One** (`own-themes.js`) echoes Vacuum Agent's Black One: Poe Dameron's T-70, matte warm
black, burnt-oxide markings and mustard for caution. Its colours come from VA's theme, made opaque
where VA layers them at low alpha. It picks the cockpit frame.

### Wear — what happened to this plate

A surface is four separable things: **geometry** (what hardware exists — the greebles), **material**
(what it is made of), **history** (what happened to it, in order) and **lighting** (how we see it).
The first and last were already here; `material-art.js` is the history.

It is an *ordered list of events*, because the order is the story. Heat then impact then rust is a
different plate from impact then heat then rust: the strike takes the coating off, so a later
oxidation event finds bare metal to start on, and a later heat event cooks steel where it would
otherwise have discoloured paint. Each event reads the surface the ones before it left — `exposed`,
`heated`, `damaged`, as coarse fields — and writes what it leaves behind. Those fields never leave
the generator: CSS composites for display and never hands back an intermediate, so the history runs
where the intermediates are just arrays, and only the per-event masks come out.

Three questions, three controls, because one slider cannot answer them:

| token | the question |
|---|---|
| `greeble-density` | how much hardware exists |
| `wear-density` | how much of it corroded |
| `wear-progress` | how far each one got |

Hardware is a fixed slot set that density keeps a share of, so turning it down and back up returns
the same fittings — and the wear hanging off them returns too, instead of drifting somewhere a bolt
has never been. Seeds are per plate **and per event**, so adding a fifth event never re-rolls the
first four, and a tile is seeded by its **id**, never its position, so it carries its scars when you
move it. Coordinates are normalized and the mask is painted `cover`, so a tile that resizes re-crops
its damage rather than stretching round blooms into ellipses.

The history runs on a coarse field because that is all it needs; the mask is then upsampled and
multiplied by fine noise at paint scale, which is where the crust and the pitting live. Painted
straight, 64 cells over a 350px tile is an airbrushed cloud.

The gate is legibility, not swing: `legibilityRange` blurs the composite to the size of a letter
first, because a thin bright vein is dramatic and harmless while a broad mottle at the same swing
eats a glyph.

### The tile shows through the card

Inside a tile or a sheet, `--ha-card-background` is transparent. So the tile's surface, and the
cockpit's screws and lighting, show wherever there is no control. Everything that must cover
content paints `--card-background-color`, which stays solid: pop-ups, inputs, the TV Plus guide's
sticky header, and the "on" power icon's text. In the cockpit frame, the cards' control fill and
dividers are mixed from the tile surface, not the ground. Mixed from the ground, they land exactly
on Black One's tile surface and vanish.

1-3 are what the editor shows for a token you have not changed, and what ↺ or **Reset all to
defaults** puts back. So a reset lands on the theme you started from, not on the mined one.
Changing **Start from** keeps your changes on top.

The panel writes only layers 3 and 4 onto itself. A token nobody chose is left unset, so Home
Assistant's theme keeps showing through it and a later change to that theme still arrives. Home
Assistant's theme is read from above the panel, since the panel's own writes would answer back.

Both are per HA user: the starting theme under `dashboard_builder.theme`, your changes under
`dashboard_builder.theme_tokens` (only the tokens you changed). Saves are debounced.

### Two people, one account

Per HA user is not per person when a household shares one login: a theme picked on the phone lands
on the wall tablet too. The theme tab's button row starts with the scope this browser is using —
**Shared** or **This device** — and the gallery's hint says which one a tap will change. Pick
**This device** and this browser keeps its own look; the others carry on with the shared theme,
which the gallery marks `shared` so it stays visible from a locked browser.

The scope is a switch rather than a button you press afterwards, and that is the whole point: as
"Only on this device", choosing a theme first had already changed it for everyone, and the lock
then pinned a decision that had leaked. Answer the scope question first and the trap is gone.

While a browser is locked, picking a theme changes that browser and nothing else, and your token
changes go to its own draft — the shared draft is left exactly as it is for whoever is still
following the account. Locking keeps the theme and draft that are on screen, so the moment of
locking changes nothing; **Share with the account** puts the browser back on the shared pair.

Its two keys are browser-local, not HA user data: `dashboard_builder.device_theme` (`{mode, theme}`)
and `dashboard_builder.device_theme_tokens`. Clearing the browser's site data drops the lock, and
the browser follows the account again. A pin on a theme deleted from another device falls back to
the shared one, but only once the library has loaded — before that every saved theme looks deleted,
and the first render would throw away a good pin. `device-theme.js` holds the rules, with
`test/device-theme.test.mjs`. The shape is borrowed from Vacuum Agent's per-device theme
selection; VA keeps only the selection local, and this keeps the draft too, because the panel puts
the token editor on the same screen as the lock.

The editor warns on the control itself in two cases. One is text that falls below 4.5:1 on its
own colour; the kit's contrast check runs over every `<name>-text` / `<name>` pair. On the 24
mined themes only 1 of 240 pairs is under. The other is a status colour the panel will show
lighter (below). **Reset all to defaults** is drawn in fixed black and white, so no theme value
can hide the control that undoes it.

The kit is copied into `vendor/token-theme-kit/` by `tools/vendor-kit.py`, with its MIT licence,
the commit it came from, and a hash of every file. `test/vendor.test.mjs` fails if a copied file
is edited in place. A fix belongs in the kit's repo, followed by a new copy.

The tiles follow the theme without any change to the cards. The cards read Home Assistant's
standard variables (`--primary-text-color`, `--accent-color`, `--divider-color` and the rest), and
inside the panel those point at the LCARS roles. Outside the panel the same cards keep HA's theme.
A pop-up a tile opens is inside the panel too, so it follows.

**Shape needed one more step.** HA's variables carry colour and nothing else, so a frame stopped at
the card's edge: a cockpit tile still held pill-shaped buttons, because the card had written `8px`
into its own stylesheet. This panel's own cards therefore also read three shape variables —
`--db-ctl-r` for a control, `--db-radius` for a card-sized surface, `--db-key-r` for a round key —
each with the card's old value as its fallback, so a card in a plain Lovelace dashboard looks
exactly as it did. A card from anywhere else still only needs HA's variables; these are an opt-in,
not a requirement.

`key-radius` ("Round button corners") is the token behind the third. A radius past half the key
reads as a circle, which is what LCARS wants and what every frame got before the token existed;
the cockpit sets 3 for a square cap, Braun 8, Terminal and HUD 0. It is the one shape token the
panel's own probe cannot measure, because the panel does not draw it — the cards do.

22 of the 24 themes share one accent, `#ff7700`. So inside the tiles a theme shows mostly in
borders, dividers and the tinted backgrounds. The sliders and buttons stay orange.

A theme's status colours are not trusted. 21 of the 24 carry one below 3:1
on their own black. The worst is LCARS Transporter's warning, `#360000` at 1.16:1. Each status colour is
lifted to at least 3:1 against the background by changing only its lightness, so a dark red stays
red. It applies to every layer, your own changes included. The editor then says, on that control,
which colour the panel is showing instead. It runs again when Home Assistant's theme changes.

## Where the layout lives

Per HA user, in `frontend/set_user_data` under the key `dashboard_builder.layout`, as
`{ v: 1, cols, tabs: [{ id, title, tiles: [...] }], shelf: [...] }`. Nothing is written until a
layout is edited; until then `seed.js` is shown. The active tab is remembered per device.

## Two ways to run it, same code

- **Lovelace card**: `type: custom:dashboard-builder-panel` alone in a `panel` view. Needs no
  restart. The **Panel** view on *The House* is this.
- **Sidebar panel**: [`../ha-config/packages/dashboard_builder_panel.yaml`](../ha-config/packages/dashboard_builder_panel.yaml)
  registers it through `panel_custom`. HA draws no toolbar there, so the panel shows its own
  sidebar button on narrow screens. It needs one restart to register.

Height is measured from where the element starts, not assumed. That is the same fix as VA's
panel offset.

## Deploy

    python tools/deploy.py

HA serves `/local` with `Cache-Control: max-age=2678400` (31 days). A `?v=` on a card's entry
file refreshes that file only, and every module it imports keeps its cached copy. That happened
for real: HA's log holds a phone failing to load the appliance card because the new card asked
its cached `control-core.js` for an export the old copy didn't have
(`RGB_WHITE_TRAP_SATURATION`). So each deploy
goes into its own directory, `www/dashboard-builder/vN/`, which mirrors the repo so relative
imports resolve. Every URL in it is new. The tool verifies each file over HTTP, switches
`current.json` last, and repoints the cards' Lovelace resources. `loader.js` is the only fixed URL:
it reads `current.json` past the cache and imports the current tree.

That wait has a cost. HA loads a custom panel with a `<script type="module">` tag and creates the
element when the tag's `load` event fires. For a module with top-level await, like `loader.js`,
that event comes before the awaits finish. On an uncached load (a hard refresh), HA therefore
creates `<dashboard-builder-panel>` before it is defined. It then sets `hass`, `panel` and `narrow`
on it as plain values, which hide the class's setters once the element upgrades. Nothing renders,
and HA's black background shows. On connect, the panel takes those values off the instance and
assigns them again, through its setters (`upgrade-props.js`, `hass` last).
