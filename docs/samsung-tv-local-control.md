# Samsung TV: the whole control surface is local

Measured 2026-09-15 against `big tv` (`UN55AU8000FXZA`, `192.168.4.30`, Tizen, `21_NIKEL_UHD_BASIC_K`).
Every call below was run for real. Nothing here needs SmartThings, a token for most of it, or a
subscription.

## What works

| action | call | confirmable? |
|---|---|---|
| device info | `GET :8001/api/v2/` | — |
| is an app installed | `GET :8001/api/v2/applications/<tizenId>` | yes |
| what is on screen | same call, read `visible` | **yes** |
| launch an app | `POST :8001/api/v2/applications/<tizenId>` | **yes** |
| any remote key | WebSocket `wss://:8002/api/v2/channels/samsung.remote.control`, `ms.remote.control` | **no** |
| change channel | the same, digits then `KEY_ENTER` | **no** |

The 23 keys the vendor integration knows: `POWER HOME MENU SOURCE GUIDE TOOLS INFO RETURN UP DOWN
LEFT RIGHT ENTER CHUP CHDOWN CH_LIST VOLUP VOLDOWN MUTE RED GREEN YELLOW BLUE`.

**Launching does not need the token.** A plain unauthenticated `POST` works. The token
(pairing prompt on screen, once) is only needed for the key WebSocket.

## The state model, and its exact shape

- `visible: true` → an app owns the screen, and **which one is reliable**.
- A system overlay (the Tizen home menu) does **not** displace it — the app underneath stays
  `visible`, correctly, because it still owns the screen.
- Nothing visible while `PowerState: on` is **not missing information**. It positively means
  *the screen is showing something that is not a Tizen app*: Samsung TV Plus, broadcast, HDMI,
  or the bare home screen. You cannot tell those four apart; you can tell all four from "an app
  is playing", and you can see the handover (the outgoing app flips `visible` true→false while
  staying `running`).
- **Samsung TV Plus never enters the app lifecycle at all.** `3201710015037` exists as an
  installed-app record and reports `running: false` even while it is filling the screen.

So a channel change is invisible: digits land, the picture changes, and the API is byte-identical
before and after. A channel tile may say **sent**. It may never say **on**.

## The app dictionary must be verified against the device

`samsungtv_smart`'s bundled `STD_APP_LIST` ships Prime Video as `3201512006785`, which **404s** on
this TV. The real id is `3201910019365`. A declared vocabulary is a starting point, not a fact —
and here it is cheap to check, because `GET /applications/<id>` answers per set.

Installed on `big tv`, read off the set:

    Netflix 3201907018807 · Prime Video 3201910019365 · Disney+ 3201901017640
    HBO Max 3201601007230 · Apple TV 3201807016597 · Hulu 3201601007625
    YouTube 111299001912 · ESPN 3201708014618 · Spotify 3201606009684 · Tubi 3201504001965

Enumeration (`ed.installedApp.get` over the WebSocket) is **dead on 2020+ firmware** — it is why
the integration hardcodes a list at all. Probing a candidate dictionary rebuilds it.

## Channels: store the name, resolve the number

`https://i.mjh.nz/SamsungTVPlus/.channels.json` — 1.9 MB, regenerated daily, 581 US channels, each
with `chno`, `name`, official Samsung `logo` URL, `description`, `group` (20 categories) and
`programs` as `[epoch, title]` pairs. XMLTV EPG alongside it at `us.xml`.

**It is current and Samsung's own published PDF is not.** Cross-checking 67 rows gave 88%, and the
12% was not noise — Samsung had reshuffled the entire Kids block, and Chris verified against the
live TV that the JSON is right on every changed number:

| channel | Samsung PDF (stale) | JSON (correct) |
|---|---|---|
| PBS Kids | 3615 | **3614** |
| Peppa Pig & Friends | 3631 | **3615** |
| Pokémon | 3695 | **3648** |
| Kidoodle.TV | 3708 | **3695** |

So a preset saved as `3695 = Pokémon` now tunes Kidoodle.TV. **Presets store the NAME; the number
is resolved at press time and is a cache, not the saved thing.** A vendor renumber then heals on
the next refresh instead of silently tuning you to a cartoon.

Two cautions. The file is a community scrape — accurate enough to rely on, not authoritative.

And **the local slots belong to whoever ran the scraper.** It resolves `1122` to `WSOC Charlotte`;
on this TV that slot is **NBC San Diego**. So the dictionary splits cleanly:

- **~575 national channels** — correct, shareable with anyone in the US, refreshed daily
- **`Local News 1`–`5`** — resolved for the scraper's market, wrong everywhere else, and
  **must be hand-authored per household**

That is the one part of a shared vocabulary that cannot be shared, and it is worth designing for
rather than discovering: a preset on a local slot needs the user's own label, and inheriting the
file's value silently gives them another city's news.

## What this costs the SmartThings paywall

Nothing, for TVs. The one capability with no local equivalent was `tvChannel` / `tvChannelName` —
and the lineup JSON replaces it and goes further, since it also carries what is playing now. The
only honest limit is that the dashboard can enrich **the channel it set itself**; the physical
remote desyncs it, so the label is *last set*, not *on*.
