/**
 * TV Plus reminders — the Home Assistant half. Still no DOM, so it tests in Node.
 *
 * A reminder has two stages, and each is its own one-shot Scheduler entry, so
 * it runs in Home Assistant whether or not any browser is open:
 *
 *   1. remind  — a notification some minutes before the show starts
 *   2. tune    — only when asked for: at the start, script.tvplus_tune tunes the
 *                channel if the TV is on, and says what it did either way
 *
 * Two entries rather than two timeslots in one: a reminder at 23:55 for a show
 * at 00:05 falls on two dates, and a schedule has one date range. Scheduler
 * removes a `single` entry once it has run, so nothing is left to clean up.
 *
 * Every entry carries tags, which is how the card finds its own reminders again:
 * "tvplus", one tag per reminder (channel + start), and one for the stage.
 */

export const LEADS = Object.freeze([0, 5, 10, 15]);          // minutes before the start
export const TUNE_SCRIPT = "script.tvplus_tune";

const slug = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";

/**
 * When each stage fires, or why it cannot.
 *
 * `lead` 0 means "at the start". With tuning on and no lead, the tune stage's own
 * message is the reminder, so stage one is skipped rather than sent twice.
 */
export function reminderPlan({ start, lead = 5, tune = false, now = Date.now() / 1000 }) {
  if (!Number.isFinite(start)) return { ok: false, reason: "no start time" };
  if (start <= now) return { ok: false, reason: "it has already started" };
  const remindAt = lead > 0 ? start - lead * 60 : (tune ? null : start);
  if (remindAt != null && remindAt <= now) return { ok: false, reason: `it starts in under ${lead} min` };
  return { ok: true, start, remindAt, tuneAt: tune ? start : null };
}

/** Epoch seconds -> the date and time Scheduler expects, in Home Assistant's time zone. */
export function localParts(epoch, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(epoch * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

export const reminderTag = (channel, start) => `tvplus:${slug(channel)}:${start}`;

/**
 * The `scheduler.add` payloads for a plan. `when` is the start as the user reads
 * it ("9:00 PM"); it only goes into the message text.
 */
export function schedulerAdds({ plan, tz, channel, chno, show, when, notify = [], remote, mediaPlayer, command }) {
  if (!plan?.ok) return [];
  const tag = reminderTag(channel, plan.start);
  const label = `${channel} (${chno})`;
  const entry = (stage, epoch, actions) => {
    const at = localParts(epoch, tz);
    return {
      name: `TV ${stage} ${at.time.slice(0, 5)} ${chno} ${show}`.slice(0, 80),
      weekdays: ["daily"], start_date: at.date, end_date: at.date, repeat_type: "single",
      tags: ["tvplus", tag, `tvplus:${stage}`],
      timeslots: [{ start: at.time, actions }],
    };
  };
  const out = [];
  if (plan.remindAt != null && notify.length) {
    const message = plan.remindAt === plan.start ? `${show} is starting on ${label}.`
      : `${show} starts at ${when} on ${label}.`;
    out.push(entry("remind", plan.remindAt,
      notify.map((svc) => ({ service: svc, service_data: { title: "TV Plus", message } }))));
  }
  if (plan.tuneAt != null) {
    out.push(entry("tune", plan.tuneAt, [{ service: TUNE_SCRIPT,
      service_data: { remote, media_player: mediaPlayer, command, label, show, notify } }]));
  }
  return out;
}

/** The card's own pending reminders, found by tag in the Scheduler's entities. */
export function pendingReminders(states = {}) {
  const out = [];
  for (const [id, st] of Object.entries(states)) {
    if (!id.startsWith("switch.")) continue;
    const tags = st?.attributes?.tags;
    if (!Array.isArray(tags) || !tags.includes("tvplus")) continue;
    const tag = tags.find((t) => /^tvplus:.+:\d+$/.test(t));
    const stage = tags.includes("tvplus:tune") ? "tune" : "remind";
    const next = st.attributes.next_trigger ? Date.parse(st.attributes.next_trigger) / 1000 : null;
    if (tag) out.push({ entity_id: id, tag, stage, next });
  }
  return out;
}

/**
 * Where reminders go when the card does not say: the phones of the person
 * signed in. A person lists their device trackers; the companion app names each
 * device's notify service after the same object id. Only services that exist
 * are returned - nothing is guessed.
 */
export function notifyTargetsFor({ states = {}, userId = null, notifyServices = {} }) {
  if (!userId) return [];
  const person = Object.entries(states).find(([id, st]) =>
    id.startsWith("person.") && st?.attributes?.user_id === userId)?.[1];
  const trackers = person?.attributes?.device_trackers || [];
  return trackers.map((t) => `mobile_app_${String(t).split(".")[1]}`)
    .filter((svc) => svc in notifyServices).map((svc) => `notify.${svc}`);
}

/** The TV's media player: the one on the same device as the remote. */
export function mediaPlayerFor(remote, entities = {}) {
  const dev = entities?.[remote]?.device_id;
  if (!dev) return null;
  const hit = Object.values(entities).find((e) =>
    e?.device_id === dev && String(e.entity_id || "").startsWith("media_player."));
  return hit?.entity_id || null;
}
