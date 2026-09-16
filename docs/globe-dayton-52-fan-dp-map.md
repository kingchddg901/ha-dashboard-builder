# Globe Dayton 52" Smart Ceiling Fan — DP map

Retail product: **Globe Dayton 52" Indoor/Covered-Outdoor Smart Ceiling Fan**, SKU
`5971299`. Wi-Fi, no hub. Packaging specs: tunable white 2000–5000 K, 16M colour,
1000 lm, 6 speeds, reversible, DC motor, 5500 CFM.

`tuya_local` matches it as **`ligency_fl15b1p_fanlight`** — Ligency is the ODM
(model `LI-FL15B1PUS2502`). The profile's `products:` block is commented out, so
the Globe branding does not appear anywhere in the integration. Searching for
"Globe" or "Dayton" finds nothing; you have to match on the DP signature.

Protocol 3.4, local key required.

## The rule that unlocked everything else

**A DP the device has never been asked about does not report.** It reads
`unknown` locally and stays that way indefinitely.

Four DPs on this device sat at `unknown` through a full evening of probing and
then populated within seconds of the corresponding screen being *opened* in the
vendor app — not saved, opened. `sleep_settings`, `randomized_schedule`,
`wake_settings` and `scene` all appeared this way.

So on this hardware `unavailable` means *untouched*, not *unsupported*. Any DP
marked `optional: true` in the profile should be assumed reachable until a
mechanism says otherwise. Touch it once in the vendor app and it becomes
readable — and writable — from then on.

Corollary: app-side writes propagate to the local connection within seconds. The
vendor app and local control are not in competition for this device.

## Entity / DP table

| DP | Entity | Type | Notes |
|----|--------|------|-------|
| 20 | light switch | bool | |
| 21 | `color_mode` | string | `white` / `colour` / `scene` / `music` |
| 22 | brightness | int | 10–1000 |
| 23 | colour temp | int | raw 0–1000; see mapping note below |
| 24 | `rgbhsv` | hex | `h` (2B, 0–360) `s` (2B, 0–1000) `v` (2B, 0–1000) |
| 25 | `scene` | **hex** | decoded below |
| 26 | light timer | int | seconds, 0–86400, counts down |
| 31 | `sleep_settings` | base64 | "Bedtime" routine |
| 32 | `wake_settings` | base64 | "Wake Up" routine — the sunrise alarm |
| 33 | `initial_settings` | base64 | power-on behaviour |
| 34 | do-not-disturb | bool | its own DP, not a power-on mode |
| 35 | light switch gradient | base64 | never reported |
| 36 | `mix_light_scene` | base64 | never reported |
| 51 | `mix_rgbcw` | base64 | never reported |
| 52 | `segment_dimming` | base64 | **not present in hardware** — see below |
| 53 | nightlight | bool | |
| 101 | fan beep | bool | |
| 102 | fault | bitfield | |
| 103 | fan timer | int | seconds (profile says minutes) |
| 104–107 | fan | | direction, speed 1–6, preset, switch |
| 209 | `schedule` | base64 | never reported |
| 210 | `randomized_schedule` | base64 | "Vacation / Random On/Off" |

`scene` is the only hex DP among the blobs; everything else in that family is
base64. Note that a hex string passes a naive base64 validity check — decoding
one as base64 yields plausible-looking garbage rather than an error.

## DP 25 `scene` — colour/white sequences

Format: a 2-character scene id, then N repeats of a 26-character step.

```
64   5a   01     0000   03e8   03e8   0000    0000
chg  stay mode   hue    sat    val    white   white
                 0-360  0-1000 0-1000 bright  temp
```

* `mode` — `01` = Flash (jump), `02` = Fade (gradient), `00` = static.
* `chg` / `stay` — 0x00–0x64 (0–100). Unit unmeasured; playback is not observable
  from HA (see below), so it cannot be timed by watching state.
* The hue/sat/val ranges are independently confirmed by the profile's own
  declaration for DP 24 `rgbhsv`, which uses the identical field order and ranges.

**Every step carries both a colour triple and a white pair.** The vendor app's
mood editor forces White *or* Colour per step, so both halves are never non-zero
in a payload it writes — but the structure is there. Whether the firmware blends
them when both are set is untested.

Worked example, a 7-step rainbow (`07`, seven steps, Flash):

```
07 645a01 0000 03e8 03e8 00000000   hue 0
   645a01 0021 03e8 03e8 00000000   hue 33
   645a01 003c 03e8 03e8 00000000   hue 60
   645a01 0078 03e8 03e8 00000000   hue 120
   645a01 00b0 03e8 03e8 00000000   hue 176
   645a01 00f0 03e8 03e8 00000000   hue 240
   645a01 012c 03e8 03e8 00000000   hue 300
```

### Two limits worth knowing

**9 steps maximum.** The HA text entity caps at 255 characters: `(255 - 2) / 26`.

**Scene playback is invisible to HA.** The device reports no state while a scene
runs — no per-step colour, nothing. Good for anything long-running (no network
chatter, survives an HA restart), but a light running a scene will report a stale
colour. Any card showing that light is showing the last thing HA saw, not what is
on the ceiling. The same is true of the fan's `nature` preset.

## DP 31 / 32 — Bedtime and Wake Up

Same layout. Wake Up is a genuine on-device sunrise: schedule, fade-in, target
colour temperature and brightness, all held in firmware. It fires with no hub, no
cloud and no Home Assistant.

```
00 01 01 3e 01 06 00 00 00 00 00 64 00 00
      ^^ ^^    ^^ ^^                ^^
      |  |     |  |                 [11] brightness, 0-100
      |  |     |  [6] not the minute — see below
      |  |     [5] hour, raw 0-23
      |  [3] weekday bitmask, bit0=Sun .. bit6=Sat
      [2] enabled
```

Confirmed by controlled change against the vendor UI:

| Field | Evidence |
|---|---|
| `[2]` enable | toggled six times across three DPs; that byte alone moved |
| `[3]` weekdays | `0x3e` = `0111110` = Mon–Fri, matching the app's day chips |
| `[5]` hour | 7:00 AM → 6:00 AM moved it `07` → `06` |
| `[5]` hour, second DP | Bedtime at 10:00 PM reads `0x16` = 22 |
| `[11]` brightness | `0x64` = 100, app shows 100% |

Note the scale change: brightness here is **0–100**, while the `scene` payload
uses 0–1000 for the same concept.

**The stored time is the target, not the start.** The app displays Wake Up as
`05:55–06:00` for a stored `06` with a 5-minute fade — the ramp runs backwards
from the alarm time.

*Unconfirmed:* `[4]` is `01` in both DPs, and both have 5-minute fades. Leading
hypothesis is fade duration in 5-minute units. Discriminator: set fade to 30
minutes — `06` means units of 5, `0x1e` means raw minutes.

*Byte `[6]` is not the minute.* It read `00` on both DPs for most of the mapping
work, which is consistent with the minute of an on-the-hour alarm and made that
the obvious reading. It later moved to `01` on Wake Up and `02` on Bedtime while
both routines were still set to whole hours, which rules the minute out. Two
samples is not enough to name what it is; a counter or revision marker fits the
shape, but so would other things. Where the minute is stored is therefore also
open — no routine has yet been set to anything but a whole hour.

## DP 210 `randomized_schedule` — and a second time encoding

```
00 0c 02 3e 01a4 0528 00 00 00 00 64 00
         ^^ ^^^^ ^^^^
         |  |    [6:8] end   = 1320 = 22:00
         |  [4:6] start = 420  = 07:00
         [3] weekday mask, as above
```

**This DP stores time as a 16-bit minutes-past-midnight count**, where DP 31/32
store a raw hour byte. Two encodings on one device — both nailed to the vendor
UI, which showed 07:00 AM–10:00 PM for exactly these bytes.

Byte `[2]` here moved `03` → `02` rather than `01` → `00`, so the enable flag is
not a clean boolean in this struct.

## DP 33 `initial_settings` — power-on behaviour

```
byte[1] = 00   factory default colour
byte[1] = 01   last state
```

Because bytes 0 and 2 are pinned at zero and base64 packs 3 bytes per 4
characters, byte[1] lands alone in the **third character**: `A`=0, `E`=1, `I`=2,
`M`=3. The mode is readable by eye without decoding.

The remaining ten bytes stay zero in both states. "Default colour" means the
factory colour, not a user-chosen one, so there is nothing to store.

Do-not-disturb is **DP 34**, a separate boolean, not a third value here.

## DP 52 `segment_dimming` — a real no

Not present in the hardware. Running a rainbow scene turns the whole fixture one
colour at a time rather than travelling colour around the ring: one LED driver
channel, no per-zone addressing. The DP appears in the profile because Tuya
products inherit a schema from their product category.

This is the distinction worth preserving: DP 52 has a *mechanism* for its no.
DP 51 `mix_rgbcw` does not — this fixture demonstrably drives both RGB and
tunable white, so the capability is physically present and only the command path
is unfound. Treat it as not-yet, not no.

## Notes for upstream

Neither of these costs any capability. The full physical range and every function
are reachable through the profile as shipped; these are label accuracy, and worth
a PR rather than a bug report.

**DP 23 colour temperature.** The profile maps the raw 0–1000 scale to
2700–6500 K. Packaging states 2000–5000 K, and the vendor app's own slider is
labelled 2000 K at the warm end. Under the shipped mapping the reported value is
700 K low at the warm end and 1500 K low at the cool end.

Correcting `target_range` to `{min: 2000, max: 5000}` takes effect on a
config-entry reload — the YAML is re-read on construction, so no restart and no
Python reload is involved. The light does not move; only the reported number
changes. A light sitting at a reported 4600 K reports 3500 K afterwards, which is
what it was emitting all along.

**DP 103 fan timer.** Declared `unit: min, range 0–540`. Observed at `7020`,
thirteen times its own ceiling, decrementing by 60 each minute in lockstep with
DP 26, which is declared in seconds. It is seconds.

DP 26 and DP 103 are separate countdowns — one for the light, one for the fan.
They appear to move together only because the app's timer dialog can target both
devices at once, setting both to the same value in a single action.

**Product identification.** Filling in the commented-out `products:` block with
the Globe SKU is the change with the most practical value — it is currently
impossible to find this profile by the name on the box.

## Still open

* `mix_rgbcw` (51) and `mix_light_scene` (36) — find the app control that writes them
* `schedule` (209) and the "Sync with the Sun" circadian routine — untouched, so unreported
* Fade-duration encoding in DP 31/32, byte `[4]`
* Whether the firmware blends colour and white when both halves of a scene step are set
* `chg` / `stay` time units in DP 25
