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
`wake_settings` and `scene` all appeared this way. `scene` then behaved
differently from the other three: once set, it has been present in every full
status report since (see below), while the routines drop out of view again after
a reload.

So on this hardware `unavailable` means *untouched*, not *unsupported*. Any DP
marked `optional: true` in the profile should be assumed reachable until a
mechanism says otherwise. Touch it once in the vendor app and it becomes
readable — and writable — from then on.

Corollary: app-side writes propagate to the local connection within seconds. The
vendor app and local control are not in competition for this device.

### What the device reports unprompted

The device's full status report — which `tuya_local` requests every 30 seconds —
contains DPs 20–26, 34, 53, 101 and 103–111. Nothing else. The configuration
blobs (31–33, 35, 36, 209, 210) and DPs 51 and 52 appear only when the vendor app
asks for them.

That membership is what decides whether a value survives a config-entry reload
or an HA restart. `tuya_local` only knows what it has been sent, so after a
reload the full-poll DPs repopulate within seconds and everything else reads
`unknown` until the app is opened again. This is why `scene` (DP 25) kept its
value through a reload that wiped every routine.

It also means absence from a full poll is not evidence that a DP is
unimplemented — DPs 31, 32, 33 and 210 are absent from every full poll and
demonstrably work.

### A trap when decoding this way

**The app writes as you adjust, not when you press Save.** Dragging a picker
emits a DP write for every value it passes, so a captured payload may be a
value your finger went through rather than the one you settled on.

This is easy to mistake for evidence. A minute field caught mid-scroll at `01`
and `02`, while the routine list still displayed a whole-hour time, reads as
proof that the byte is *not* the minute — and it is not proof of anything except
that the wheel was moving. Take the last write after the UI settles, and prefer
values that cannot be confused with an intermediate: a 6:03 alarm and a
70-minute fade each pin a field in one sample, where zeros and round hundreds
look the same on every candidate scale.

The flip side is that no probe here ever needs Save. Opening the screen makes the
DP report; touching a control makes it write.

### A second trap: the integration shows your own write back to you

`tuya_local` displays a written value immediately and keeps displaying it for up
to five seconds (`_FAKE_IT_TIMEOUT`) whether or not the device accepts it. If an
unrelated status report arrives inside that window, the entity re-renders with
the pending value, and a `state_changed` event carrying exactly the bytes you
sent looks like the device echoing them.

Two tells separate a real acknowledgement from this:

* **The cache never forgets.** Device reports are merged into `tuya_local`'s
  cache and never removed, so an acknowledged value persists across later polls.
  A value that drops to `unknown` at the next full poll was never received.
* **The debug log names the sender.** With debug logging on for the integration,
  an accepted write is followed within about a second by a
  `received {...}` line containing the written DP with `"full_poll": false`.

Note that HA's core log endpoint returns only the last 100 lines by default; a
`Range: entries=:-3000:` header reaches further back.

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
| 51 | `mix_rgbcw` | base64 | write not acknowledged — see below |
| 52 | `segment_dimming` | base64 | **not present in hardware** — see below |
| 53 | nightlight | bool | |
| 101 | fan beep | bool | |
| 102 | fault | bitfield | never reported, yet the `problem` sensor reads `on` — see upstream notes |
| 103 | fan timer | int | seconds (profile says minutes) |
| 104–107 | fan | | direction, speed 1–6, preset, switch |
| 108 | — | bool | **not in the profile**; reads `false` |
| 109 | — | bool | **not in the profile**; reads `false` |
| 110 | — | string | **not in the profile**; reads `memory` — likely the fan's own power-on behaviour |
| 111 | — | string | **not in the profile**; reads `010000` |
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
00 01 01 3e 0e 06 03 00 00 00 00 64 00 04
      |  |  |  |  |              |     |
      |  |  |  |  |              |     [13] turn-off-after, 5-minute units
      |  |  |  |  |              [11] brightness, 0-100
      |  |  |  |  [6] minute
      |  |  |  [5] hour, raw 0-23
      |  |  [4] fade-in duration, 5-minute units
      |  [3] weekday bitmask, bit0=Sun .. bit6=Sat
      [2] enable in bit 0
```

That sample is a 6:03 alarm, Mon–Fri, 70-minute fade (`0x0e` = 14 × 5), ramping
to 100% and switching off 20 minutes later (`0x04` = 4 × 5).

`sleep_settings` is 13 bytes to `wake_settings`' 14; the trailing byte that only
Wake Up carries is the turn-off-after duration.

Confirmed by controlled change against the vendor UI:

| Field | Evidence |
|---|---|
| `[2]` enable | toggled six times across three DPs; that byte alone moved. It is **bit 0**, not the whole byte — DP 210 carries a second flag in bit 1 and moves `02`↔`03` where these move `00`↔`01` |
| `[3]` weekdays | `0x3e` = `0111110` = Mon–Fri, matching the app's day chips. Selecting all seven days gives `0x7f` |
| `[4]` fade-in | a 5-minute fade reads `01`; changing it to 1 h 10 min gives `0x0e` = 14 = 70 ÷ 5 |
| `[5]` hour | 7:00 AM → 6:00 AM moved it `07` → `06` |
| `[5]` hour, second DP | Bedtime at 10:00 PM reads `0x16` = 22 |
| `[6]` minute | a 6:03 alarm reads `03`; scrolling the picker writes each value it passes |
| `[11]` brightness | `0x64` = 100, app shows 100% |
| `[13]` off-after | 20 minutes reads `0x04` = 4 = 20 ÷ 5, same units as `[4]` |

Note the scale change: brightness here is **0–100**, while the `scene` payload
uses 0–1000 for the same concept.

**The stored time is the target, not the start.** The app displays Wake Up as
`05:55–06:00` for a stored `06` with a 5-minute fade — the ramp runs backwards
from the alarm time.

Note that two durations in this struct use 5-minute units while the times beside
them are raw hour and minute. The app's own pickers only offer fade and
turn-off-after in 5-minute steps, so the encoding matches the UI rather than the
clock.

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

DP 51 `mix_rgbcw` is a different case with its own section below. The fixture
demonstrably drives both RGB and tunable white, so a colour-and-white blend is
physically plausible even though the DP that names it goes unanswered.

## DP 51 `mix_rgbcw` — a write the firmware does not acknowledge

Tuya defines `mix_rgbcw` as the control for colour and white light on at the
same time. `tuya_local`'s reference decode (the `ledvance_smart_plabl100x25b`
profile, used as the template in make-all/tuya-local#4024) is 12 bytes, six
big-endian 16-bit fields:

```
sw    h      s       v        wb      wc
      0-360  0-1000  0-1000   white   colour temp
```

In that profile bit 0 of `sw` switches the white light and bit 1 the RGB light.
Other reverse-engineering reports `sw` as 4 = off, 5 = white, 6 = colour,
7 = both, which is the same two bits over a constant `0x04`; that constant does
not appear in the template.

The same issue lists this profile as *"a normal rgbcw light without separate
control"*. In context that concerns fixtures with a physically separate RGB
backlight and whether to expose it as a second light entity — it is not a
finding about DP 51.

**Test.** Written: `AAcAAAPoAfQB9AH0` —

```
0007  0000  03e8  01f4  01f4  01f4
both  red   sat   RGB     white   mid
            full  50%     50%     CCT
```

Result, from the integration's debug log:

```
sending   {"51": "AAcAAAPoAfQB9AH0"}
received  {full status, no "51"}                  +0.7 s
received  {full status, no "51"}                  +32 s

sending   {"22": 320, "23": 533}                  (restoring the light)
received  {"22": 320, "23": 533, "full_poll": false}   +0.9 s
```

The restore is the positive control: two standard DPs, echoed back in under a
second. DP 51 received no echo, and the light's work mode (DP 21) stayed
`white` with brightness and temperature unchanged. The entity appeared to report
the value at +0.7 s — that was the pending value re-rendered by a full poll, per
the second trap above.

**Not yet established:** whether the fixture changed visibly during the write
(nobody was watching), and whether `sw = 0x0003` behaves differently from
`0x0007`. Neither would overturn the missing acknowledgement, but both are cheap
to check. Whether the fixture blends colour and white *internally* at low
saturation is a separate question — see the open list.

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

**DP 102 `problem` sensor.** The mapping sends `0` to `false` and everything else
— including a DP that has never been reported — to `true`. This device never
reports DP 102, so the sensor reads `on` permanently. The debug log states it
directly: `Mapped dps 102 value from None to True`. Mapping an absent value to
`false` (or to unavailable) would make the sensor mean what it says.

**DPs 108–111** appear in every full status report and are not in the profile.
`110: "memory"` is very likely the fan's power-on behaviour.

**Product identification.** Filling in the commented-out `products:` block with
the Globe SKU is the change with the most practical value — it is currently
impossible to find this profile by the name on the box.

## Still open

* `mix_light_scene` (36) — find the app control that writes it
* DP 51 — a visual check during a write, and the `sw = 0x0003` variant
* DPs 108, 109 and 111 — what they control
* Whether colour mode already mixes implicitly: a desaturated colour could be
  rendered by raising green and blue, or by bringing in the white channels in
  proportion to `100% − saturation`. At 11% saturation the light stays in `hs`
  mode rather than handing off to `color_temp`, which rules out a mode switch but
  does not separate the other two. An eye comparison was inconclusive; a lux
  reading of colour mode at 0% saturation against white mode at 100% should be
  decisive, since RGB-synthesised white is far dimmer than the phosphor channels
* `schedule` (209) and the "Sync with the Sun" circadian routine — untouched, so unreported
* Fade-duration encoding in DP 31/32, byte `[4]`
* Whether the firmware blends colour and white when both halves of a scene step are set
* `chg` / `stay` time units in DP 25
