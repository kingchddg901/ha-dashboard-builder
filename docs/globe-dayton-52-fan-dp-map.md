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
readable — and writable — from then on. DP 51 is the one found so far where a
mechanism does say otherwise: the device never acknowledges it.

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
* `chg` / `stay` — 0x00–0x64 (0–100). Playback is not observable from HA, so
  timing comes from video (method below). With both bytes at `0x58` (88), an
  8-step rainbow measures:

  | | |
  |---|---|
  | step period | **2.199 s** — four of five intervals identical to the frame |
  | fade | ≈ 0.4–0.5 s |
  | hold | ≈ 1.7 s |
  | loop | 8 × 2.2 = 17.6 s |
  | fade granularity | colour updates every **50 ms** (20 Hz) |

  Fade and hold are far from equal although the two bytes are, so they are not
  two durations in one unit. 2.2 s is exactly 88 × 25 ms and also exactly
  176 × 12.5 ms; with equal bytes those cannot be told apart. The names are
  Tuya's standard field order, not something measured here. A stopwatch put the
  loop at about 15 s — 15% short, which is why the frame timing is the number to
  use.

  The app's **Speed** slider writes its percentage straight into both bytes in
  Fade mode: this scene was set to 88%. If a higher Speed means faster playback,
  as the name says, the bytes cannot simply be durations — 2.2 s at 88 would grow
  at 100. A Flash-mode rainbow captured earlier carried `100/90` rather than a
  matched pair, which hints that Flash pins the first byte and Speed drives the
  second; its Speed setting was not recorded.
* The hue/sat/val ranges are independently confirmed by the profile's own
  declaration for DP 24 `rgbhsv`, which uses the identical field order and ranges.

**Every step carries both a colour triple and a white pair.** The vendor app's
mood editor forces White *or* Colour per step, so both halves are never non-zero
in a payload it writes — but the structure is there, and the firmware accepts a
step with both set. See *Colour and white together* below for what is and is not
known about the output.

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

The same rainbow as the app writes it with a white step added and Transition
set to Fade — every step becomes mode `02`, and the white step zeroes the colour
triple and fills the white pair:

```
   585802 0000 03e8 03e8 00000000   hue 0 ... through hue 300, as above
   585802 0000 0000 0000 03e8 02b7  white, brightness 1000, temperature 695 (app: 4085 K, 100%)
```

That capture is what confirms the white half of the step format; before it, the
white fields had only ever been seen as zero. The app shows the step as 4085 K at
100%, which pins both scales: brightness is the percentage × 10, and temperature
maps 0–1000 linearly onto 2000–5000 K (2000 + 695 × 3 = 4085).

### Three limits worth knowing

**9 steps maximum.** The HA text entity caps at 255 characters: `(255 - 2) / 26`.

**Scene playback is invisible to HA.** The device reports no state while a scene
runs — no per-step colour, nothing. Good for anything long-running (no network
chatter, survives an HA restart), but a light running a scene will report a stale
colour. Any card showing that light is showing the last thing HA saw, not what is
on the ceiling. The same is true of the fan's `nature` preset.

**Colour and white never crossfade.** In a scene where every step is set to
Fade, colour-to-colour steps interpolate smoothly, but the move from the last
colour step to the white step is an instant cut — and so is the move from white
back to the first colour when the loop restarts. The firmware switches between
the colour and white emitter groups rather than ramping one down while the other
comes up. A sunrise that should pass from colour into white cannot be written
as a single fading scene on this fixture; the handover will snap.

The video puts the cut about 0.5 s after the white step begins — roughly one
fade's length. The firmware still spends the step's fade slot, holding the
previous colour through it, and switches at its end.

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

**Repeated with an observer, and with `sw = 0x0003`.** Neither value was
acknowledged, the light's reported state did not move, and nothing visible
changed. The control in that run was stronger than the first: DP 24 was written
with the value it *already held*, and the device still echoed it. It
acknowledges every write it accepts, including no-ops.

DP 51 is ignored by this firmware.

## Colour and white together

Three routes to lighting the RGB and white channels at once, and where each
stands:

| Route | Result |
|---|---|
| Low saturation in colour mode | **No.** Pastels are made from RGB alone; the white channels stay dark |
| DP 51 `mix_rgbcw` | **No.** Ignored — see above |
| A scene step with both halves set | **Accepted.** Output undetermined, but a blend looks unlikely — see below |

**Low saturation.** Red at 25% saturation, viewed through a CD spectroscope,
shows distinct red, green and blue bars. White mode shows a broad yellow glow
from the phosphor instead. Had the white channels joined in, that yellow would
fill the space between green and red. Red at 100% shows red alone, so pure
colours use the colour die only.

A side effect is visible without instruments: 25% red reads as lavender rather
than pale pink. RAW captures at a single fixed exposure (1/1000 s, ISO 50,
4000 K), each primary and the firmware's own white at full brightness, show why.

**The primaries**, measured from the fixture's integrated light:

| emitter | chromaticity x, y | luminance share at equal drive | sRGB, for reference |
|---|---|---|---|
| red | 0.649, 0.311 | 27% | 21% |
| green | 0.303, 0.513 | 57% | 72% |
| blue | 0.132, 0.084 | 16% | 7% |

Green is weak against red and blue — which pushes any RGB white toward magenta —
and blue is roughly twice its usual share, which pushes it cool.

**The firmware's white.** Colour mode at 0% saturation measures
**9,854 K, Duv −0.016**: blue, and below the Planckian locus toward purple. The
three solo captures, summed, predict 9,501 K, so the measurement and the model
agree on temperature. White mode, by contrast, sits on the locus (below).

**Colour mode normalises its drive.** Decomposed into the solo primaries, the
0%-saturation white is red ×0.33, green ×0.43, blue ×0.37 of their individual
full outputs — about one channel's worth shared three ways, and 39% of the
light the three give separately. So colour-mode brightness is not comparable
across saturations, and pastels are dim as well as tinted.

**Sensitivity to the matrix.** Values above use the camera matrix interpolated
for the 4000 K white balance, as the DNG specification does. Using the daylight
or tungsten matrix alone gives blue 11–21%, green 52–58%, and the white at
9,209–10,085 K with Duv −0.009 to −0.028: always cool and always on the purple
side. Red's share (21–37%) is the least stable figure.

**Checking the conversion itself.** Converting the file's recorded white balance
(`AsShotNeutral`) through the interpolated matrix gives 3918 K, Duv +0.008,
against the 4000 K set on the camera — so the conversion runs in the right
direction with the right matrices.

**An earlier estimate this supersedes.** A first pass put blue at 35% of
luminance and the white near 10,900 K. It used ceiling-bounced light around
clipped cores, from primaries set in the app at unrecorded brightness. The
temperature survived; the blue share did not — it was overstated about
twofold.

For dashboards this means a swatch of the commanded colour will not match the
ceiling for pastels on this fixture; saturated colours match. It is correctable
upstream of the device — reduce blue and red relative to green before sending a
pastel — if it ever matters.

**Scene step.** Written as a single static step — red at 50%, white at 50%, mid
temperature — reusing the stored scene id and restoring the stored scene
afterwards:

```
05 64 64 00 0000 03e8 01f4 01f4 01f4
   chg stay static  red  sat  val  white temp
```

Both the DP 25 write and the switch of DP 21 to `scene` were echoed, and the
following full status reports carried the step, so the firmware stored and ran
it. The light entity kept reporting its previous colour throughout, as it does
for all scenes.

By eye the output was steady, and whether that is a true blend or the two halves
alternating faster than can be seen is not something an eye can settle — nor
does it matter for a light. What remains open is whether both halves were
present at all.

The strongest evidence on that is indirect. In a fading scene the firmware
refuses to crossfade between a colour step and a white step in either direction
(see *Three limits worth knowing*), which is precisely the moment a blending
controller would have both groups lit. A firmware that will not overlap the two
for the length of a fade is unlikely to hold them together indefinitely, so the
test step most probably rendered one half only. Which half is still unobserved. The id byte's meaning is also still unknown; reusing the stored
one avoided finding out the hard way.

## Reading the LEDs with a CD

A CD's data side is a diffraction grating, which makes it a spectroscope good
enough to tell phosphor white from RGB-synthesised white — the one distinction a
camera, a colour meter or a "spectrometer" app cannot make, because two lights
can be the same colour with completely different spectra.

* **Use a slit.** A ceiling fixture is a large source, and a large source smears
  its own spectrum. Without one, pure red covered about 80% of the length the
  white spectrum did — enough to blur RGB bands 65–100 nm apart into something
  that looks continuous. Two cards held about 1 mm apart, backlit by the
  fixture and viewed in the disc, cut red to a short stripe.
* **Calibrate with a single colour first.** A saturated colour should be one
  short band. If it is long, the setup cannot resolve gaps and any test with it
  cannot fail.
* **Tilt away from the mirror reflection.** The bright specular image is not the
  spectrum; the first-order bands sit well to one side.
* **Trust the eye over the phone.** A camera clips bright pure red and renders
  it yellow-white, which is exactly the colour that would otherwise be evidence
  of phosphor.
* **Magenta is a warning.** It is not a spectral colour, so seeing it in a band
  means red and blue are overlapping — smear.
* **Reading it:** white LEDs give a continuous band dominated by yellow, with a
  bright blue edge and a slightly dimmer cyan patch that is normal for a
  phosphor LED. RGB gives separate bars with no yellow between green and red.

## Timing a scene from video

A phone at 60 fps times scene playback far better than a stopwatch.

* Point the camera at the fixture with the fan **off** — moving blades modulate
  the light.
* Measure colour in an unclipped region: the halo around the fixture or a patch
  of ceiling. The fixture itself saturates.
* Work in chromaticity (`r/(r+g+b)`, `g/(r+g+b)`), which ignores auto-exposure.
  Auto white balance still drifts during holds, so time transitions, not
  absolute colour.
* Use each frame's container timestamp. Phone video drops frames — this one had
  four gaps of 33–116 ms — so frame number ÷ 60 is wrong.
* Time fade onsets for the period; the snap into or out of white is a one-frame
  event and the sharpest mark available. The frame-to-frame change inside a
  fade also shows the firmware's update rate directly.

## Measuring the emitters from RAW

A phone's RAW capture is linear and free of per-shot white balance, which makes
it usable for comparing the three primaries — though, being three-channel, it
cannot replace the CD for telling phosphor white from RGB white.

* **Fix the exposure.** Pro mode with manual shutter, ISO and white balance;
  the captures above were all 1/1500 s at ISO 3200.
* **Expect the core to clip anyway, and to lie about it.** Samsung's Expert RAW
  replaces saturated pixels with a neutral at the clip level (4095 × the
  as-shot neutral), so a clipped core reads *white* in the RAW data, not as a
  blown channel. Measure the unclipped edge of the diffuser instead.
* **Measure the fixture's integrated light**, background-subtracted, from an
  unclipped capture — for colour and brightness both. Convert with the file's
  own `ColorMatrix` and `CameraCalibration` pairs, interpolated for the shot's
  white balance. An earlier attempt using the diffuser rim for colour and
  ceiling-bounced light for brightness, around clipped cores, overstated blue
  about twofold.
* **Set the states from HA, and log when.** Primaries set in the app at
  unrecorded brightness cannot be compared. A scripted sequence with a
  timestamped log lets each capture be matched to its state by the DNG's
  `DateTimeOriginal`, which also catches renamed or mis-ordered files.
* **The file format needs a current reader.** These are DNG 1.7 files — linear
  (already demosaiced) and JPEG XL compressed. LibRaw 0.22, via `rawpy`, refuses
  them; `tifffile` with `imagecodecs` decodes them.
* **Clipping is avoidable.** 1/12000 s at ISO 640 and −2 EV left the core of a
  31%-brightness white unclipped, so the fixture itself can be measured rather
  than its rim.
* **Dimming did not band at that shutter.** Row-to-row variation through the
  core was about 1.4% rms — well above noise, but with no period except whole
  fractions of the sampled window, which is the diffuser's own structure — and
  the warm/cool ratio moved only 0.3% rms. A shutter slicing through
  out-of-phase dimming would have shown both, and would have got the colour
  wrong.
* **White mode is an on-locus white** at every setting measured — see
  *White mode, measured*.
* **Do not judge colour from the phone's preview.** The gallery rendered that
  capture with a pink cast that is not in the data.

## White mode, measured

RAW captures of white mode at DP 23 = 0, 533 and 1000, integrated over the
fixture and converted with the spec-interpolated camera matrix (range across the
daylight-only and tungsten-only matrices in brackets):

| DP 23 | corrected label | measured | Duv | shipped label |
|---|---|---|---|---|
| 0 | 2000 K | **1951 K** (1833–2037) | −0.003 | 2700 K |
| 533 | 3599 K | **3473 K** (3251–3599) | −0.005 | 4725 K |
| 1000 | 5000 K | **4514 K** (4420–4543) | +0.003 | 6500 K |

Two captures of the 5000 K setting three minutes apart agreed to within 1 K and
0.0001 Duv, so the method is repeatable; its accuracy is bounded by the camera
matrix, which read the camera's own 4000 K white balance 2% low.

**It is a two-emitter blend.** The 3599 K capture is reproduced by a combination
of the two end captures with a 0.1% misfit under every matrix — white mode is a
warm and a cool white LED and nothing else, consistent with the CD result.

**The blend is not a linear split of the setting.** Reaching the middle colour
takes roughly two parts cool output to one part warm, where a split
proportional to DP 23 would be 53:47. That fits firmware which targets a colour
temperature and solves for the blend, rather than dividing drive. (The middle
capture used a different exposure from the ends, so its brightness is not
compared with theirs; the proportion is independent of exposure.)

**The cool end is brighter.** At the same brightness setting and exposure, the
5000 K setting gives about 1.35× the luminance of the 2000 K setting
(1.19–1.47 across matrices).

**A tighter mapping is available, and not applied.** The best straight line
through the three measurements runs from 2000 K at DP 0 to about 4570 K at
DP 1000, which would put every label within about 100 K of the measurement
rather than within 490 K. The packaging and the vendor app both say 5000 K, and
this rests on one phone's colour conversion, so the profile stays at 2000–5000.

## Notes for upstream

Neither of these costs any capability. The full physical range and every function
are reachable through the profile as shipped; these are label accuracy, and worth
a PR rather than a bug report.

**DP 23 colour temperature.** The profile maps the raw 0–1000 scale to
2700–6500 K. Packaging states 2000–5000 K, and the vendor app's own slider is
labelled 2000 K at the warm end. The app also displays a scene's white step
stored as `695` as 4085 K — exactly 2000 + 695 × 3 — so the vendor's own
conversion is the linear 2000–5000 K mapping. RAW measurements at both ends and
the middle (see *White mode, measured*) put the corrected labels within 2.5–10%
of what the fixture emits, where the shipped labels are 36–44% high at every
point. Under the shipped mapping the reported value is
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
* DPs 108, 109 and 111 — what they control
* `schedule` (209) and the "Sync with the Sun" circadian routine — untouched, so unreported
* Whether a scene step with both halves set actually lights both. Two cheap
  checks: the CD spectroscope (phosphor yellow *and* a red line means both), or a
  white pencil waved fast under the light (separate red and white copies mean
  the halves alternate)
* What the scene id byte controls
* `chg` / `stay` — what each byte controls, and which way Speed runs. The next
  step needs no hand-written payload: film the same mood at a different Speed
  (say 50%). Shorter steps mean the byte is a duration; longer steps mean the
  firmware inverts it. Separating the two bytes from each other still needs
  unequal values — a hand-written scene at 100/20 and at 20/100
