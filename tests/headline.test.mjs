import assert from "node:assert/strict";
import { test } from "node:test";
import { headline } from "../src/headline.js";
import { STEPS, levelOf } from "../src/rain.js";

/** Tuesday 17 November 2026, 21:00 in the Netherlands. */
const NOW = Date.UTC(2026, 10, 17, 20, 0);
const CET = 60;

/** A series from spells of [first step, steps, mm an hour]. */
function rain(...spells) {
  const levels = new Uint8Array(STEPS);
  for (const [from, steps, mm] of spells) levels.fill(levelOf(mm), from, from + steps);
  return { base: NOW, levels };
}
const say = (series, language = "en", now = NOW) => headline(series, now, CET, language);

test("raining now: what kind and for how long", () => {
  const words = say(rain([0, 9, 0.3]));
  assert.equal(words.full, "Drizzle for about 45 minutes");
  assert.equal(words.top, "DRIZZLE");
  assert.equal(words.bottom, "45 MIN");
  assert.equal(words.wet, true);
  assert.equal(words.startsIn, -1);
});

test("the strongest rain of the spell names it", () => {
  assert.equal(say(rain([0, 6, 0.3], [6, 2, 2])).full, "Rain for about 40 minutes");
  assert.equal(say(rain([0, 6, 0.3], [6, 2, 9])).full, "Heavy rain for about 40 minutes");
  assert.equal(say(rain([0, 6, 9])).top, "HEAVY");
});

test("lengths are rounded the way people say them", () => {
  assert.equal(say(rain([0, 1, 1])).full, "Rain for about 5 minutes");
  assert.equal(say(rain([0, 17, 1])).full, "Rain for about 85 minutes");
  assert.equal(say(rain([0, 19, 1])).full, "Rain for about 1.5 hours");
  assert.equal(say(rain([0, 25, 1])).full, "Rain for about 2 hours");
  assert.equal(say(rain([0, 25, 1])).bottom, "2 HRS");
  assert.equal(say(rain([0, 100, 1])).full, "Rain for about 8 hours");
});

test("rain to the end of the two days", () => {
  const words = say(rain([0, STEPS, 1]));
  assert.equal(words.full, "Rain for the next 2 days");
  assert.equal(words.bottom, "2 DAYS");
});

test("dry now, rain within 2 hours: how soon, and what kind", () => {
  const words = say(rain([3, 4, 6]));
  assert.equal(words.full, "Heavy rain in 15 minutes");
  assert.equal(words.top, "HEAVY IN");
  assert.equal(words.bottom, "15 MIN");
  assert.equal(words.wet, false);
  assert.equal(words.startsIn, 15);
  assert.equal(say(rain([24, 4, 1])).full, "Rain in 2 hours");
  assert.equal(say(rain([24, 4, 1])).startsIn, 120);
});

test("dry now, rain later: until when", () => {
  const words = say(rain([25, 4, 1]));
  assert.equal(words.full, "Dry until 23:05");
  assert.equal(words.top, "DRY TILL");
  assert.equal(words.bottom, "23:05");
  assert.equal(words.startsIn, -1);
  // 21:00 + 630 minutes is 7:30 the next morning; 2 days on it is a weekday's name.
  assert.equal(say(rain([126, 4, 1])).full, "Dry until tomorrow 7:30");
  assert.equal(say(rain([414, 4, 1])).full, "Dry until Thursday 7:30");
});

test("dry for the two days", () => {
  const words = say(rain());
  assert.equal(words.full, "Dry for the next 2 days");
  assert.equal(words.top, "DRY");
  assert.equal(words.wet, false);
});

test("rain too faint to notice is dry", () => {
  assert.equal(say(rain([0, 12, 0.05])).full, "Dry for the next 2 days");
});

test("the headline follows the clock between two fetches", () => {
  const series = rain([6, 6, 1]);
  assert.equal(say(series).full, "Rain in 30 minutes");
  assert.equal(say(series, "en", NOW + 20 * 60000).full, "Rain in 10 minutes");
  assert.equal(say(series, "en", NOW + 40 * 60000).full, "Rain for about 20 minutes");
  assert.equal(say(series, "en", NOW + 70 * 60000).full, "Dry for the next 2 days");
});

test("the same in Dutch", () => {
  assert.equal(say(rain([0, 9, 0.3]), "nl").full, "Motregen, nog ca. 45 minuten");
  assert.equal(say(rain([0, 25, 9]), "nl").full, "Zware regen, nog ca. 2 uur");
  assert.equal(say(rain([0, STEPS, 1]), "nl").full, "Regen de komende 2 dagen");
  assert.equal(say(rain([3, 4, 1]), "nl").full, "Regen over 15 minuten");
  assert.equal(say(rain([3, 4, 1]), "nl").top, "REGEN OVER");
  assert.equal(say(rain([25, 4, 1]), "nl").full, "Droog tot 23:05");
  assert.equal(say(rain([126, 4, 1]), "nl").full, "Droog tot morgen 7:30");
  assert.equal(say(rain([414, 4, 1]), "nl").full, "Droog tot donderdag 7:30");
  assert.equal(say(rain(), "nl").full, "Droog de komende 2 dagen");
  assert.equal(say(rain(), "xx").full, "Dry for the next 2 days");
});

test("every headline fits the displays", () => {
  const cases = [rain([0, 9, 0.3]), rain([0, 25, 9]), rain([0, STEPS, 9]), rain([3, 4, 9]), rain([24, 4, 9]), rain([414, 4, 1]), rain()];
  for (const language of ["en", "nl"]) {
    for (const series of cases) {
      const words = say(series, language);
      for (const part of [words.full, words.top, words.bottom]) assert.match(part, /^[\x20-\x7e]+$/);
      // Two lines of 34 characters on the back; 13 letters of the small font on the front.
      assert.ok(words.full.length <= 68, words.full);
      assert.ok(words.top.length <= 13, words.top);
      assert.ok(words.bottom.length <= 13, words.bottom);
    }
  }
});
