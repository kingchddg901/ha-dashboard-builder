# Samsung TV Plus card

Your saved channels and what is on. **Tap a channel to select it**: its detail opens underneath
with the show on now, **◀ ▶** to step through what is on later, and **Tune**. **Search** the whole
lineup (a channel, a show, a category or a number) and save from there; **Edit list** reorders or
removes.

Tuning always changes the channel now. When the detail is showing a later show, the card says so
rather than implying it can tune ahead.

**No integration, no backend, no API key, no subscription.** The lineup comes from a public
JSON file the browser fetches directly (CORS is open), and tuning goes through
`remote.send_command` — a stock Home Assistant service.

## Shape

    tvplus-core.js          the logic — no DOM, no Home Assistant, no Lovelace
    samsung-tvplus-card.js  the Lovelace adapter, and the disposable half
    test/core.test.mjs      14 tests, `node --test test/core.test.mjs`

The core is the part worth keeping. It knows about channels and time and nothing
else, so the same rules can sit behind a dashboard renderer later without the
Lovelace shape having leaked into them — and it tests in Node with no browser.

## Install

Copy **both** `samsung-tvplus-card.js` and `tvplus-core.js` to `config/www/`
(the card imports the core relatively), then add the resource
(Settings → Dashboards → ⋮ → Resources) as a **JavaScript module**:

    /local/samsung-tvplus-card.js

## Use

```yaml
type: custom:samsung-tvplus-card
remote: remote.big_tv
title: Living room
channels:
  - Witness to Justice
  - CBS News 24/7
  - Movie Hub
  - BBC Earth
```

| option | | |
|---|---|---|
| `remote` | **required** | a `remote.*` entity for the TV, from core `samsungtv` or from `samsungtv_smart` (see below) |
| `channels` | optional | the list to start from, until one is saved: channel **names**, not numbers (see below) |
| `list` | optional | which saved list this card shows. Default: the TV's own, named after its remote (`remote.big_tv` → `big_tv`), so each TV keeps its own favourites. Cards naming the same list share it |
| `notify` | optional | where reminders go (a notify service or a list). Default: the signed-in person's phones |
| `media_player` | optional | the TV's media player, checked before tuning at the start. Default: the one on the remote's device |
| `remind_lead` | optional | minutes before a show the reminder starts at: `0`, `5` (default), `10` or `15` |
| `saved_for` | optional | `user` (default): each HA user keeps their own. `house`: one list for everyone, which only an admin can change |
| `title` | optional | card heading |
| `region` | optional | `us` (default), `ca`, `gb`, `de`, `fr`, `es`, `it`, `at`, `ch`, `in`, `kr` |
| `key_gap_ms` | optional | pause between keys when tuning, `samsungtv_smart` only (200–2000, default 1000) |

## Reminders

Step to a later show and **Remind me** appears: pick how long before (at the start, 5, 10 or
15 minutes; times already past are greyed out), tick **Tune when it starts** if you want that
too, and **Set reminder**.

- **Stage one** is a notification to your phones, found through your person entity's device
  trackers (only notify services that exist; `notify:` overrides it).
- **Stage two** happens only when ticked. At the start, `script.tvplus_tune` (from
  [`ha-config/packages/tvplus_reminders.yaml`](../../ha-config/packages/tvplus_reminders.yaml))
  tunes the channel **if the TV is on**. It never switches the TV on, and it says what it did
  either way.

Each stage is a one-shot entry in the **Scheduler** integration (HACS), so it fires in Home
Assistant with no browser open, survives a restart, shows in Scheduler's own card, and removes
itself once it has run. Two entries rather than one, because a reminder at 23:55 for a show at
00:05 falls on two dates. Times go to Scheduler in Home Assistant's time zone. The card finds its
reminders again by their tags; a channel with one pending shows "reminder 8:55 PM", and
**Cancel reminder** removes both stages. The logic is in `reminders-core.js`, tested in
`test/reminders.test.mjs`.

Without Scheduler, the card says reminders need it. Without the package, "Tune when it starts"
is disabled and says why.

## Where saved channels live

In Home Assistant, not the browser, so they follow you to every device: `frontend/set_user_data`
(per user) or `frontend/set_system_data` (`saved_for: house`), under
`samsung_tvplus.saved.<list>`. The card subscribes to that key, so the same list open in the
panel and on a view stays in step. Until anything is saved, it shows `channels`.

## What the lineup carries

Per channel: number, name, logo, a description, **one of 20 categories** (`group` — Sports &
Outdoors, Music, Kids, News & Opinion, …) and a schedule of `[start, title]` pairs. There are no end
times (the next start is the end) and no per-programme descriptions. Search reads the name, the
category and what is on now and next, ignoring case and accents.

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

## Which remote

Tuning was measured working through core `samsungtv`, which waits **1 s** after every key (its
websocket library's default). `samsungtv_smart` joins the keys with `+` and waits only **0.5 s**
between them, and at that spacing the set did not get full channel numbers. It does read a bare
number in the chain as a pause (200–2000 ms), so on `samsungtv_smart` the card puts one between
every key, 1000 ms unless `key_gap_ms` says otherwise. Core `samsungtv` gets plain keys: it would
send a number as a key, and it spaces keys itself.

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
