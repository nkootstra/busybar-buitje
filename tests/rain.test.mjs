import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HEAVY, RAIN, STEPS, STEP_MS, WET, buildSeries, levelOf, sampleColumns } from "../src/rain.js";
import { parseForecast } from "../src/sources.js";
import { AT, EVENING, forecast, of } from "./forecast.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));
const HOUR = 3600000;
const QUARTER = 900000;

/** A series from a forecast as the service would answer at AT. */
const seriesOf = (given, now = AT) => buildSeries(now, parseForecast(forecast(given)));

test("rain in mm an hour becomes a level", () => {
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(-1), 0);
  assert.equal(levelOf(NaN), 0);
  assert.equal(levelOf(0.1), WET);
  assert.equal(levelOf(0.5), RAIN - 1);
  assert.equal(levelOf(4), HEAVY - 1);
  assert.equal(levelOf(1), 109);
  assert.equal(levelOf(10), 141);
  assert.equal(levelOf(1e9), 255);
  assert.equal(levelOf(1e-9), 1);
});

test("a live answer for the Netherlands has hours of one model and quarters of the other", () => {
  const answer = parseForecast(fixture("forecast-utrecht.json"));
  assert.equal(answer.hours.span, HOUR);
  assert.equal(answer.hours.levels.length, 49);
  assert.equal(answer.quarters.span, QUARTER);
  assert.equal(answer.quarters.levels.length, 24);
  for (const level of answer.hours.levels.concat(answer.quarters.levels)) assert.ok(Number.isInteger(level) && level >= 0 && level <= 255);
  // The finer model's values are its own: KNMI's quarters are its hours cut in four, and would all be alike.
  const raw = fixture("forecast-utrecht.json").minutely_15;
  assert.notDeepEqual(raw.precipitation_icon_d2, raw.precipitation_knmi_seamless);
});

test("a live answer from outside the finer model's reach has hours only", () => {
  const answer = parseForecast(fixture("forecast-madrid.json"));
  assert.equal(answer.hours.levels.length, 49);
  assert.equal(answer.quarters, null, "the plain quarters are the hours cut in four: not taken");
});

test("a value is the rain of the time before its moment, as mm an hour", () => {
  const answer = parseForecast({
    hourly: { time: [3600, 7200], precipitation_knmi_seamless: [1, 10] },
    minutely_15: { time: [900, 1800], precipitation_icon_d2: [0.25, 2.5] },
  });
  assert.deepEqual(answer.hours, { firstEnds: HOUR, span: HOUR, levels: [109, 141] });
  assert.deepEqual(answer.quarters, { firstEnds: QUARTER, span: QUARTER, levels: [109, 141] });
});

test("an answer stops at the first value that is missing; without any it is no forecast", () => {
  const cut = parseForecast({ hourly: { time: [3600, 7200, 10800], precipitation: [1, null, 1] } });
  assert.deepEqual(cut.hours.levels, [109], "what follows a gap is not taken: the gap would read as dry");
  assert.equal(cut.quarters, null);
  assert.equal(parseForecast({}), null);
  assert.equal(parseForecast(null), null);
  assert.equal(parseForecast({ hourly: { time: [], precipitation: [] } }), null);
  assert.equal(parseForecast({ hourly: { time: [3600], precipitation: [null] } }), null);
  assert.equal(parseForecast({ hourly: { time: ["soon"], precipitation: ["wet"] } }), null);
});

test("the series starts at the step now falls in, with the quarters for the first hours", () => {
  const series = buildSeries(AT, parseForecast(EVENING));
  assert.equal(series.base, Math.floor(AT / STEP_MS) * STEP_MS);
  assert.equal(series.levels.length, STEPS);
  assert.equal(series.fine, true);
  // 21:10 is step 0. Dry until 21:45, step 7; drizzle of 0.3 mm an hour until 22:30, step 16.
  const drizzle = levelOf(0.3);
  assert.deepEqual(Array.from(series.levels.slice(0, 17)), [...of(7, 0), ...of(9, drizzle), 0]);
  // Rain of 2 mm an hour from 23:00, step 22.
  assert.deepEqual(Array.from(series.levels.slice(20, 24)), [0, 0, levelOf(2), levelOf(2)]);
  // The hours reach 48 hours from the top of this one, 10 minutes ago: all but the last 2 steps are known.
  assert.equal(series.known, 574);
});

test("there is no step where the quarters end and the hours take over", () => {
  const series = seriesOf({ quarters: of(24, 2.5), hours: of(48, 0.1) });
  // The quarters end 6 hours from the top of this one: step 70.
  const levels = Array.from(series.levels.slice(69, 84));
  assert.equal(levels[0], levelOf(10));
  assert.equal(levels[14], WET);
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] <= levels[i - 1], "the fade never rises");
    assert.ok(levels[i - 1] - levels[i] <= 6, "the fade has no step: " + levels.join(","));
  }
});

test("where the two models disagree, the stronger rain of the two is shown", () => {
  // The model by the hour has drizzle for the hour now is in and the next; the finer one has none, and a
  // shower of its own from 23:00 to 23:30.
  const series = seriesOf({ hours: [0.4, 0.3, ...of(46, 0)], quarters: [...of(8, 0), 1, 1, ...of(14, 0)] });
  assert.equal(series.levels[0], levelOf(0.4), "rain only the hours have is not hidden by the quarters");
  assert.equal(series.levels[21], levelOf(0.3));
  assert.equal(series.levels[22], levelOf(4), "and rain only the quarters have is there too");
  assert.equal(series.levels[27], levelOf(4));
  assert.equal(series.levels[28], 0);
  // Where both have rain, the stronger: the quarters' shape stands out of the hours' even layer.
  const both = seriesOf({ hours: of(48, 0.4), quarters: [...of(4, 0), 1, ...of(19, 0)] });
  assert.equal(both.levels[9], levelOf(0.4));
  assert.equal(both.levels[10], levelOf(4));
});

test("without quarters the hours are all there is", () => {
  const series = seriesOf({ hours: [1, 2, 3] });
  assert.equal(series.fine, false);
  // The hour now is in ends at 22:00, step 10.
  assert.equal(series.levels[0], levelOf(1));
  assert.equal(series.levels[9], levelOf(1));
  assert.equal(series.levels[10], levelOf(2));
  assert.equal(series.levels[22], levelOf(3));
  assert.equal(series.known, 34, "past the last hour nothing is known");
});

test("a forecast that has aged covers less, and none makes no series", () => {
  const answer = parseForecast(forecast({ hours: of(48, 1) }));
  assert.equal(buildSeries(AT + 5 * HOUR, answer).known, 574 - 60);
  assert.equal(buildSeries(AT + 60 * HOUR, answer).known, 0);
  assert.equal(buildSeries(AT, null), null);
});

test("a column shows the strongest rain in its span, so a short shower survives a wide window", () => {
  const series = seriesOf({ hours: of(48, 0) });
  series.levels[300] = 150;
  const out = new Uint8Array(72);
  sampleColumns(series, series.base, 48, out);
  // 48 hours over 72 columns is 8 steps a column: step 300 is column 37.
  assert.equal(out[37], 150);
  assert.equal(out.filter((level) => level > 0).length, 1);
  // At 2 hours a step is exactly 3 columns.
  series.levels[1] = 100;
  sampleColumns(series, series.base, 2, out);
  assert.deepEqual(Array.from(out.slice(0, 7)), [0, 0, 0, 100, 100, 100, 0]);
});

test("the columns slide as time passes, and run dry past the end of the series", () => {
  const series = seriesOf({ hours: of(48, 0) });
  series.levels[12] = 120;
  const out = new Uint8Array(72);
  sampleColumns(series, series.base, 2, out);
  assert.equal(out.indexOf(120), 36);
  sampleColumns(series, series.base + 30 * 60000, 2, out);
  assert.equal(out.indexOf(120), 18);
  sampleColumns(series, series.base + 47.5 * HOUR, 48, out);
  assert.equal(out[71], 0);
});
