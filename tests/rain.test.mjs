import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HEAVY, RAIN, STEPS, STEP_MS, WET, buildSeries, levelOf, sampleColumns } from "../src/rain.js";
import { inRadarReach, parseDirectNowcast, parseForecast, parseNowcast } from "../src/sources.js";
import { AT, EVENING, forecast, nowcast, of } from "./forecast.mjs";

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
  assert.equal(series.made, "fine");
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

test("the radar's nowcast is what the first 2 hours show, whatever the models say", () => {
  // The models have drizzle all evening; the radar sees a shower from 21:30 to 21:45 and nothing else.
  const models = parseForecast(forecast({ hours: of(48, 0.3), quarters: of(24, 0.1) }));
  const radar = parseNowcast(nowcast([0, 0, 0, 0, 3, 3, 3]));
  const series = buildSeries(AT, models, radar);
  assert.equal(series.made, "radar");
  assert.deepEqual(Array.from(series.levels.slice(0, 8)), [0, 0, 0, 0, levelOf(3), levelOf(3), levelOf(3), 0]);
  assert.equal(series.levels[23], 0, "dry where the radar says dry, to the end of its 2 hours");
  assert.equal(series.levels[24], levelOf(0.4), "and the models from there on");
  assert.equal(series.known, 574);
});

test("rain the radar still has at its end fades into the models", () => {
  const models = parseForecast(forecast({ hours: of(48, 0) }));
  const series = buildSeries(AT, models, parseNowcast(nowcast(of(24, 5))));
  assert.equal(series.levels[23], levelOf(5));
  const after = Array.from(series.levels.slice(23, 37));
  for (let i = 1; i < after.length; i++) assert.ok(after[i] < after[i - 1], "the fade falls: " + after.join(","));
  assert.equal(series.levels[36], 0);
});

test("a nowcast that has grown old is not shown", () => {
  const models = parseForecast(forecast({ hours: of(48, 0) }));
  const radar = parseNowcast(nowcast(of(24, 5)));
  assert.equal(buildSeries(AT + 15 * 60000, models, radar).made, "radar");
  const without = buildSeries(AT + 26 * 60000, models, radar);
  assert.equal(without.made, "coarse");
  assert.equal(without.levels[0], 0);
  assert.equal(buildSeries(AT, models, null).made, "coarse");
  assert.equal(buildSeries(AT, null, radar), null, "the radar alone is no forecast");
});

test("the relay's answer is rain by the 5 minutes, nothing where the radar has no data, or not an answer", () => {
  assert.deepEqual(parseNowcast({ run: 600, step: 300, rain: [1, 10, 0] }), { firstEnds: 600000, span: 300000, levels: [109, 141, 0] });
  assert.equal(parseNowcast({ run: 600, step: 300, rain: null }), null);
  for (const odd of [null, undefined, "", [], {}, { run: 600, step: 300 }, { run: 600, step: 300, rain: [] }, { run: 0, step: 300, rain: [1] }, { run: 600, step: 300, rain: [1, null] }, { run: 600, step: 300, rain: "wet" }, { rain: null }]) {
    assert.equal(parseNowcast(odd), undefined, JSON.stringify(odd));
  }
});

test("the radar's least count on its own is a speck: shown faintly, not rain to speak of", () => {
  // As the radar had it for Borne on 18 November: specks now and in 20 minutes, a shower later.
  const radar = parseNowcast({ run: 600, step: 300, rain: [0.12, 0, 0, 0, 0.12, 0, 0.12, 0.12, 0, 0.84, 1.32, 0.12, 0] });
  const speck = WET - 1;
  assert.deepEqual(radar.levels, [speck, 0, 0, 0, speck, 0, levelOf(0.12), levelOf(0.12), 0, levelOf(0.84), levelOf(1.32), levelOf(0.12), 0]);
  assert.ok(levelOf(0.12) >= WET, "two in a row, or one at the edge of a shower, are drizzle");
});

test("KNMI's own answer is read for the moments that were asked, each standing for the 10 minutes around it", () => {
  const minute = 60000;
  const moments = [0, 10, 20, 30, 40].map((m) => Date.UTC(2026, 10, 18, 12, m));
  // As the service answered for Hamburg on 18 November: the first moment asked was before the run's start.
  const answer = [{ data: { "2026-11-18T12:05:00Z": { "2026-11-18T12:10:00Z": "0.000000", "2026-11-18T12:20:00Z": "0.360000", "2026-11-18T12:30:00Z": "2.640000", "2026-11-18T12:40:00Z": "0.120000" } } }];
  assert.deepEqual(parseDirectNowcast(answer, moments), {
    firstEnds: moments[1] + 5 * minute,
    span: 10 * minute,
    levels: [0, levelOf(0.36), levelOf(2.64), levelOf(0.12)],
  });
  assert.equal(parseDirectNowcast([{ data: {} }], moments), null, "outside the radar's picture");
  for (const odd of [null, "", {}, [], [{}], [{ data: "none" }], [{ data: { run: {} } }], [{ data: { run: { "2026-11-18T12:10:00Z": "nodata" } } }], { error: "Quota exceeded" }]) {
    assert.equal(parseDirectNowcast(odd, moments), undefined, JSON.stringify(odd));
  }
});

test("the radar is asked only for places its picture covers", () => {
  for (const [name, lat, lon, inside] of [["Utrecht", 52.09, 5.12, true], ["Brussels", 50.85, 4.35, true], ["Borne", 52.3, 6.75, true], ["Madrid", 40.42, -3.7, false], ["Berlin", 52.52, 13.4, false], ["Oslo", 59.91, 10.75, false], ["Dublin", 53.35, -6.26, false]]) {
    assert.equal(inRadarReach({ lat, lon }), inside, name);
  }
});

test("without quarters the hours are all there is", () => {
  const series = seriesOf({ hours: [1, 2, 3] });
  assert.equal(series.made, "coarse");
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
