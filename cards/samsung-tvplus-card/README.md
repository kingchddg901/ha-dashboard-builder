# Samsung TV Plus card

Pick a few channels, see what is on, tap to tune.

**No integration, no backend, no API key, no subscription.** The lineup comes from a public
JSON file the browser fetches directly (CORS is open), and tuning goes through
`remote.send_command` — a stock Home Assistant service.

## Install

Copy `samsung-tvplus-card.js` to `config/www/`, then add the resource
(Settings → Dashboards → ⋮ → Resources) as a **JavaScript module**:

    /local/samsung-tvplus-card.js

## Use

```yaml
type: custom:samsung-tvplus-card
remote: remote.big_tv_un55au8000fxza
title: Living room
channels:
  - Witness to Justice
  - CBS News 24/7
  - Movie Hub
  - BBC Earth
```

| option | | |
|---|---|---|
| `remote` | **required** | a `remote.*` entity for the TV — the one from the core `samsungtv` integration |
| `channels` | **required** | channel **names**, not numbers (see below) |
| `title` | optional | card heading |
| `region` | optional | `us` (default), `ca`, `gb`, `de`, `fr`, `es`, `it`, `at`, `ch`, `in`, `kr` |

## Three things it does deliberately

**Channels are keyed by name, never by number.** Samsung renumbers: the whole Kids block moved
recently, so a favourite saved as `3695 = Pokémon` now tunes Kidoodle.TV. The number is resolved
at press time from the current lineup and is a cache, not the saved thing — a renumber heals on
the next refresh instead of silently tuning you somewhere else. A channel that has been renamed
or dropped says **"not in the current lineup"** rather than guessing at a number.

**It says *sent*, never *on*.** A Samsung TV reports nothing back after a channel change — the
set's own local API is byte-identical before and after — so the card acknowledges the send and
claims nothing about the result. (Launching an *app* is different: that the TV does report, via
`running` / `visible` per app.)

**Local News 1–5 are not worth adding.** The lineup source resolves those slots for whatever
market its scraper ran in, so they are somebody else's stations. Everything else is national and
correct.

## Data source

`https://i.mjh.nz/SamsungTVPlus/.channels.json` — 581 US channels with number, name, logo,
description, category and a `[epoch, title]` programme list, regenerated daily. It is a community
scrape: accurate enough to rely on, not authoritative. Verified against a live TV — it was right
on every number Samsung's own published PDF had wrong.

The card caches the parsed lineup in `localStorage` for 6 hours, so a dashboard reload is not a
2 MB download.

## Limits

- Guide depth is about **5 hours**. Enough for now-and-next, not an evening's browsing.
- The whole data layer is one person's static host. If it stops, the card stops.
- Eleven countries only.
- Tuning is fire-and-forget by nature; nothing confirms the channel actually changed.
