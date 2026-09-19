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
    own-themes.js        starting themes written for this panel (Black One), beside the 24 mined ones
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

### Frames

`frame` is the master token. It picks how the panel draws its structure. The LCARS frame has
elbows, pill tabs and a rail. The cockpit frame draws the same structure as instrument panels:

- chamfered consoles
- a scale on the top band
- the time in a recessed readout
- tabs as switches with indicator lamps
- hazard-striped tools
- tiles with a screw in each corner and light from above
- square status lamps that glow

The frame goes on as an attribute (`data-frame`), and the cockpit's rules all select on it, so
none of them reach LCARS. Colours still come from the tokens either way.

A frame brings its own shape. Tokens with `byFrame` (tile, tab and button corners, the tile's
bevel) take the active frame's value as their default. Switching **Frame** alone reshapes the
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
