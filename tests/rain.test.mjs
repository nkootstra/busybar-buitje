import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  HEAVY,
  RAIN,
  STEPS,
  STEP_MS,
  WET,
  buildSeries,
  levelOf,
  mmPerHour,
  parseModel,
  parseNowcast,
  sampleColumns,
} from "../src/rain.js";

const fixture = (name) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
/** The fixtures were taken at this moment: 17 November 2026, 21:14 in the Netherlands. */
const TAKEN = Number(fixture("taken-at.txt")) * 1000;
const CET = 60;

/** A model with one value for every hour after `from`. */
const hourly = (from, values) => ({ hours: { end: from + 3600000, levels: values.map(levelOf) }, quarters: null });

test("levels and mm an hour are the same scale, both ways", () => {
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(-1), 0);
  assert.equal(levelOf(0.1), WET);
  assert.equal(levelOf(0.5), RAIN - 1);
  assert.equal(levelOf(4), HEAVY - 1);
  assert.equal(levelOf(1e9), 255);
  assert.equal(levelOf(1e-9), 1);
  assert.equal(mmPerHour(0), 0);
  assert.ok(Math.abs(mmPerHour(109) - 1) < 1e-9);
  assert.ok(Math.abs(mmPerHour(levelOf(2.5)) - 2.5) < 0.1);
});

test("the radar's answer is read line by line", () => {
  const nowcast = parseNowcast(fixture("raintext-amsterdam.txt"));
  assert.equal(nowcast.levels.length, 24);
  assert.equal(nowcast.minutes, 21 * 60 + 15);
  assert.deepEqual(nowcast.levels.slice(0, 8), [0, 0, 0, 0, 0, 0, 77, 77]);
  assert.equal(nowcast.levels[23], 123);
  // Windows line ends, a line that is not one, and a value past the scale.
  assert.deepEqual(parseNowcast("000|23:55\r\nnonsense\r\n999|00:00\r\n"), { minutes: 23 * 60 + 55, levels: [0, 255] });
});

test("an answer that is not a nowcast is no nowcast", () => {
  assert.equal(parseNowcast(fixture("raintext-berlin.txt")), null);
  assert.equal(parseNowcast(""), null);
  assert.equal(parseNowcast(undefined), null);
});

test("the model's answer gives levels by the hour and by the quarter", () => {
  const model = parseModel(JSON.parse(fixture("model-amsterdam.json")));
  assert.equal(model.hours.levels.length, 49);
  assert.equal(model.quarters.levels.length, 12);
  // Its first hour ends at the top of the hour the fixture was taken in.
  assert.equal(model.hours.end, Math.floor(TAKEN / 3600000) * 3600000);
  for (const level of model.hours.levels) assert.ok(level >= 0 && level <= 255);
  // A quarter's value is the rain of 15 minutes: four times that an hour.
  assert.equal(parseModel({ hourly: { time: [0], precipitation: [1] }, minutely_15: { time: [0], precipitation: [0.25] } }).quarters.levels[0], 109);
});

test("a model answer without a forecast is none", () => {
  assert.equal(parseModel({}), null);
  assert.equal(parseModel({ hourly: { time: [], precipitation: [] } }), null);
  assert.equal(parseModel(null), null);
  // A missing value is dry, not a crash.
  assert.deepEqual(parseModel({ hourly: { time: [0, 3600], precipitation: [null, 1] } }).hours.levels, [0, 109]);
});

test("the series starts at the step now falls in and takes the radar's first 2 hours", () => {
  const nowcast = parseNowcast(fixture("raintext-amsterdam.txt"));
  const model = parseModel(JSON.parse(fixture("model-amsterdam.json")));
  const series = buildSeries(TAKEN, CET, nowcast, model);
  assert.equal(series.base, Math.floor(TAKEN / STEP_MS) * STEP_MS);
  assert.equal(series.levels.length, STEPS);
  assert.equal(series.radar, true);
  // 21:10 is step 0; the radar's 21:15 is step 1, its drizzle at 21:45 step 7, its last line 23:10 step 24.
  assert.deepEqual(Array.from(series.levels.slice(0, 9)), [0, 0, 0, 0, 0, 0, 0, 77, 77]);
  assert.equal(series.levels[24], 123);
});

test("the radar's clock times are found across midnight and in another zone", () => {
  const at = Date.UTC(2026, 10, 17, 22, 58);
  const nowcast = { minutes: 0, levels: [200, 0, 0] };
  // 23:58 in the Netherlands: 00:00 is the step after 23:55.
  assert.equal(buildSeries(at, CET, nowcast, null).levels[1], 200);
  // A bar set to another zone cannot place the times: the first line is taken as now.
  assert.equal(buildSeries(at, -300, nowcast, null).levels[0], 200);
});

test("there is no step where the radar ends and the model takes over", () => {
  const nowcast = { minutes: 20 * 60, levels: new Array(24).fill(140) };
  const at = Date.UTC(2026, 10, 17, 19, 0);
  const series = buildSeries(at, CET, nowcast, hourly(at - 3600000, new Array(50).fill(0.1)));
  const levels = Array.from(series.levels.slice(23, 37));
  assert.equal(levels[0], 140);
  assert.equal(levels[13], WET);
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] <= levels[i - 1], "the fade never rises");
    assert.ok(levels[i - 1] - levels[i] <= 6, "the fade has no step: " + levels.join(","));
  }
});

test("without radar the model's quarters stand in, then its hours", () => {
  const at = Date.UTC(2026, 10, 17, 19, 0);
  const model = {
    hours: { end: at + 3600000, levels: [levelOf(1), levelOf(2), levelOf(3)] },
    quarters: { end: at + 900000, levels: [levelOf(8), 0, 0, 0] },
  };
  const series = buildSeries(at, CET, null, model);
  assert.equal(series.radar, false);
  assert.equal(series.levels[0], levelOf(8));
  assert.equal(series.levels[3], 0);
  assert.equal(series.levels[12], levelOf(2));
  assert.equal(series.levels[24], levelOf(3));
  // Past the model's last hour nothing is known: dry.
  assert.equal(series.levels[36], 0);
});

test("with radar alone, or nothing, the series is what there is", () => {
  const at = Date.UTC(2026, 10, 17, 19, 0);
  assert.equal(buildSeries(at, CET, null, null), null);
  const series = buildSeries(at, CET, { minutes: 20 * 60, levels: [90, 90] }, null);
  assert.equal(series.levels[0], 90);
  assert.equal(series.levels[2], 0);
});

test("a column shows the strongest rain in its span, so a short shower survives a wide window", () => {
  const at = Date.UTC(2026, 10, 17, 19, 0);
  const series = buildSeries(at, CET, null, hourly(at - 3600000, new Array(50).fill(0)));
  series.levels[300] = 150;
  const out = new Uint8Array(72);
  sampleColumns(series, at, 48, out);
  // 48 hours over 72 columns is 8 steps a column: step 300 is column 37.
  assert.equal(out[37], 150);
  assert.equal(out.filter((level) => level > 0).length, 1);
  // At 2 hours a step is exactly 3 columns.
  series.levels[1] = 100;
  sampleColumns(series, at, 2, out);
  assert.deepEqual(Array.from(out.slice(0, 7)), [0, 0, 0, 100, 100, 100, 0]);
});

test("the columns slide as time passes, and run dry past the end of the series", () => {
  const at = Date.UTC(2026, 10, 17, 19, 0);
  const series = buildSeries(at, CET, null, hourly(at - 3600000, new Array(50).fill(0)));
  series.levels[12] = 120;
  const out = new Uint8Array(72);
  sampleColumns(series, at, 2, out);
  assert.equal(out.indexOf(120), 36);
  sampleColumns(series, at + 30 * 60000, 2, out);
  assert.equal(out.indexOf(120), 18);
  sampleColumns(series, at + 47.5 * 3600000, 48, out);
  assert.equal(out[71], 0);
});
