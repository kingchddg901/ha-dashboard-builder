# The panel — dashboard 1.0

The base everything else sits in. The panel owns the whole area and the render; tiles are
**shapes** on a snap grid, and what fills each one is a declaration handed to a renderer.

    layout-core.js       the grid rules — no DOM, no HA, tested
    renderers.js         the closed set a tile can hold, and each one's phone-row summary
    seed.js              the starting layout for this house — data, the same shape a saved one has
    tokens.js            LCARS token fallbacks, held to ../tokens/lcars/core-tokens.json by a test
    themes.js            the 24 mined LCARS themes as role -> colour, held to ../tokens/lcars/presets.json by a test
    theme-core.js        which variables a theme sets, and keeping its status colours readable — no DOM, tested
    dashboard-panel.js   the element — the disposable half
    loader.js            the one stable file (see Deploy)
    test/                node --test panel/test/*.mjs

## What it does

| | desk (panel ≥ 700 px wide) | phone (narrower) |
|---|---|---|
| tabs | down the LCARS rail | a strip under the bar |
| tiles | on a 12-column grid, 64 px rows | status rows, in the desk layout's reading order |
| a tile's control | inside the tile | one tap deep, in a sheet |
| editing | **Edit layout**: move, resize, send or copy to another tab, remove to the shelf, add / rename / remove tabs, theme, reset | **Edit layout**: send or copy to another tab, remove to the shelf, add from the shelf |

The grid rules, and why:

- **Tiles never overlap.** A move or resize that would overlap is refused, and the ghost says
  what is in the way. Nothing nudges a neighbour for you: a layout that rearranges itself under
  your finger is worse than one that says no.
- **Nothing is lost.** Remove puts a tile on the shelf. Damaged stored data is repaired by moving
  tiles to free space, not by dropping them. A tile whose renderer isn't loaded is kept and says so.
- **Controls pause while editing.** Tile bodies take no input in edit mode, so arranging the fan
  tile cannot also turn the fan on.
- **The phone reads the desk layout like a page.** There is no second list to keep in sync.
- **Phone rows follow design rule 7.** On, off, unavailable and unknown each get their own mark. An
  unavailable row is inert, and an entity the layout names but HA does not have reads as
  unavailable, never as "off".

## Themes

**Edit layout → Theme** puts one of the 24 LCARS themes on the panel, or follows Home Assistant's
theme (the default). The choice is per HA user, under `dashboard_builder.theme`.

The tiles follow the theme without any change to the cards. The cards read Home Assistant's
standard variables (`--primary-text-color`, `--accent-color`, `--divider-color` and the rest), and
inside the panel those point at the LCARS roles. Outside the panel the same cards keep HA's theme.
A pop-up a tile opens is inside the panel too, so it follows.

22 of the 24 themes share one accent, `#ff7700`. So inside the tiles a theme shows mostly in
borders, dividers and the tinted backgrounds. The sliders and buttons stay orange.

A theme's status colours are not trusted. 21 of the 24 carry one below 3:1
on their own black. The worst is LCARS Transporter's warning, `#360000` at 1.16:1. Each status colour is
lifted to at least 3:1 against the background by changing only its lightness, so a dark red stays
red. The same check runs in follow mode on HA's current theme. It runs again when that theme
changes.

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
