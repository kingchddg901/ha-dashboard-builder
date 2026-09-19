/**
 * Tests for the reminder half: when each stage fires, the Scheduler payloads,
 * finding the card's reminders again, and where notifications go. Entity and
 * service names are the real ones on this box (2026-09-19).
 *
 *   node --test cards/samsung-tvplus-card/test/reminders.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reminderPlan, localParts, reminderTag, schedulerAdds, pendingReminders, notifyTargetsFor,
  mediaPlayerFor, TUNE_SCRIPT,
} from "../reminders-core.js";

const NOW = 1_800_000_000;
const START = NOW + 20 * 60;                     // a show twenty minutes out

/* ------------------------------------------------------------------ plan */

// RED IF: a reminder is scheduled for a time already past - Scheduler would
// hold an entry that never fires, and the card would show it as set.
test("a reminder that would land in the past is refused, with the reason", () => {
  assert.equal(reminderPlan({ start: NOW - 60, now: NOW }).reason, "it has already started");
  const late = reminderPlan({ start: NOW + 3 * 60, lead: 5, now: NOW });
  assert.equal(late.ok, false);
  assert.match(late.reason, /under 5 min/);
});

test("the two stages land where they should", () => {
  assert.deepEqual(reminderPlan({ start: START, lead: 10, tune: true, now: NOW }),
    { ok: true, start: START, remindAt: START - 600, tuneAt: START });
  assert.deepEqual(reminderPlan({ start: START, lead: 5, tune: false, now: NOW }),
    { ok: true, start: START, remindAt: START - 300, tuneAt: null });
});

// RED IF: "at the start" with tuning on sends two messages at the same moment.
test("at the start with tuning, the tune stage is the only message", () => {
  assert.deepEqual(reminderPlan({ start: START, lead: 0, tune: true, now: NOW }),
    { ok: true, start: START, remindAt: null, tuneAt: START });
  assert.equal(reminderPlan({ start: START, lead: 0, tune: false, now: NOW }).remindAt, START);
});

/* ----------------------------------------------------------- the payloads */

// RED IF: times go out in UTC or the browser's zone instead of Home Assistant's.
test("Scheduler gets the date and time in Home Assistant's own time zone", () => {
  // 2027-01-15 03:30:00 UTC is 21:30 on the 14th in Chicago.
  const t = Date.UTC(2027, 0, 15, 3, 30, 0) / 1000;
  assert.deepEqual(localParts(t, "America/Chicago"), { date: "2027-01-14", time: "21:30:00" });
  assert.deepEqual(localParts(t, "UTC"), { date: "2027-01-15", time: "03:30:00" });
});

const base = {
  tz: "UTC", channel: "Witness to Justice", chno: 1833, show: "Court Cam", when: "9:00 PM",
  notify: ["notify.mobile_app_sm_s918u"], remote: "remote.big_tv", mediaPlayer: "media_player.big_tv_2",
  command: ["KEY_1", "1000", "KEY_8", "1000", "KEY_3", "1000", "KEY_3", "1000", "KEY_ENTER"],
};

// RED IF: the stages share one entry (a show just after midnight would have its
// reminder on the other date), or an entry is not single-shot.
test("each stage is its own one-shot entry, tagged so the card can find it", () => {
  const plan = reminderPlan({ start: START, lead: 10, tune: true, now: NOW });
  const [remind, tune] = schedulerAdds({ ...base, plan });
  const tag = reminderTag("Witness to Justice", START);
  for (const e of [remind, tune]) {
    assert.equal(e.repeat_type, "single");
    assert.equal(e.start_date, e.end_date);
    assert.ok(e.tags.includes("tvplus") && e.tags.includes(tag));
  }
  assert.ok(remind.tags.includes("tvplus:remind"));
  assert.ok(tune.tags.includes("tvplus:tune"));
  assert.deepEqual(remind.timeslots[0].actions, [{ service: "notify.mobile_app_sm_s918u",
    service_data: { title: "TV Plus", message: "Court Cam starts at 9:00 PM on Witness to Justice (1833)." } }]);
  assert.equal(tune.timeslots[0].actions[0].service, TUNE_SCRIPT);
  assert.deepEqual(tune.timeslots[0].actions[0].service_data.command, base.command);
  assert.equal(tune.timeslots[0].actions[0].service_data.media_player, "media_player.big_tv_2");
});

test("a reminder across midnight puts each stage on its own date", () => {
  const start = Date.UTC(2027, 0, 15, 0, 5, 0) / 1000;
  const plan = reminderPlan({ start, lead: 10, tune: true, now: start - 3600 });
  const [remind, tune] = schedulerAdds({ ...base, plan });
  assert.deepEqual([remind.start_date, remind.timeslots[0].start], ["2027-01-14", "23:55:00"]);
  assert.deepEqual([tune.start_date, tune.timeslots[0].start], ["2027-01-15", "00:05:00"]);
});

// RED IF: the payload builder ignores the zone it is handed - found by ablation:
// every other payload test here uses UTC, so forcing UTC inside it went unseen.
test("the entries are written in the time zone they are given", () => {
  const start = Date.UTC(2027, 0, 15, 5, 0, 0) / 1000;          // 21:00 on the 14th in Los Angeles
  const plan = reminderPlan({ start, lead: 10, tune: true, now: start - 3600 });
  const [remind, tune] = schedulerAdds({ ...base, tz: "America/Los_Angeles", plan });
  assert.deepEqual([remind.start_date, remind.timeslots[0].start], ["2027-01-14", "20:50:00"]);
  assert.deepEqual([tune.start_date, tune.timeslots[0].start], ["2027-01-14", "21:00:00"]);
});

test("with nobody to tell, stage one is left out rather than sent to no one", () => {
  const plan = reminderPlan({ start: START, lead: 10, tune: true, now: NOW });
  const out = schedulerAdds({ ...base, notify: [], plan });
  assert.deepEqual(out.map((e) => e.tags[2]), ["tvplus:tune"]);
  assert.deepEqual(schedulerAdds({ ...base, plan: { ok: false } }), []);
});

/* ------------------------------------------------------ finding them again */

// RED IF: another integration's switch is taken for a reminder, or a stage is misread.
test("pending reminders are the Scheduler entities carrying the card's tags", () => {
  const tag = reminderTag("Witness to Justice", START);
  const states = {
    "switch.schedule_a": { attributes: { tags: ["tvplus", tag, "tvplus:remind"], next_trigger: "2027-01-14T21:20:00+00:00" } },
    "switch.schedule_b": { attributes: { tags: ["tvplus", tag, "tvplus:tune"], next_trigger: null } },
    "switch.schedule_other": { attributes: { tags: ["heating"] } },
    "switch.kitchen": { attributes: {} },
  };
  const got = pendingReminders(states);
  assert.deepEqual(got.map((r) => [r.entity_id, r.stage, r.tag]),
    [["switch.schedule_a", "remind", tag], ["switch.schedule_b", "tune", tag]]);
  assert.equal(got[0].next, Date.parse("2027-01-14T21:20:00+00:00") / 1000);
});

test("a reminder tag survives accents and punctuation in the channel name", () => {
  assert.equal(reminderTag("Pokémon", 123), "tvplus:pokemon:123");
  assert.equal(reminderTag("CBS News 24/7", 5), "tvplus:cbs_news_24_7:5");
});

/* ------------------------------------------------------- who gets told */

const people = {
  "person.christopher_king": { attributes: { user_id: "u1",
    device_trackers: ["device_tracker.sm_s918u", "device_tracker.wakefield", "device_tracker.no_app"] } },
  "person.someone_else": { attributes: { user_id: "u2", device_trackers: ["device_tracker.other"] } },
};
const services = { mobile_app_sm_s918u: {}, mobile_app_wakefield: {}, mobile_app_other: {} };

// RED IF: a notify service is guessed that does not exist, or another person's
// phone gets your reminder.
test("reminders go to the signed-in person's phones, and only real services", () => {
  assert.deepEqual(notifyTargetsFor({ states: people, userId: "u1", notifyServices: services }),
    ["notify.mobile_app_sm_s918u", "notify.mobile_app_wakefield"]);
  assert.deepEqual(notifyTargetsFor({ states: people, userId: "nobody", notifyServices: services }), []);
  assert.deepEqual(notifyTargetsFor({ states: people, userId: null, notifyServices: services }), []);
});

test("the TV's media player is the one on the remote's device", () => {
  const entities = {
    "remote.big_tv": { entity_id: "remote.big_tv", device_id: "d1" },
    "media_player.big_tv_2": { entity_id: "media_player.big_tv_2", device_id: "d1" },
    "media_player.other": { entity_id: "media_player.other", device_id: "d2" },
  };
  assert.equal(mediaPlayerFor("remote.big_tv", entities), "media_player.big_tv_2");
  assert.equal(mediaPlayerFor("remote.missing", entities), null);
});
