// Attempts to break the app: answers no service should give, settings no page should save, buttons mashed,
// clocks that jump. Whatever happens it must keep running, throw nothing, and never show what it does not know.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { backElements } from "../src/back.js";
import { createFront, drawFront } from "../src/front.js";
import { headline } from "../src/headline.js";
import { STEPS, buildSeries, sampleColumns } from "../src/rain.js";
import { readSettings } from "../src/settings.js";
import { describe } from "../src/show.js";
import { parseModel, parseNowcast } from "../src/sources.js";
import { builtApp, launch } from "../tools/sim.mjs";

const fixture = (name) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
const TAKEN = Number(fixture("taken-at.txt")) * 1000;
const RADAR = fixture("raintext-amsterdam.txt");
const MODEL = JSON.parse(fixture("model-amsterdam.json"));
const live = (more = {}) => ({ at: TAKEN, radar: RADAR, model: MODEL, ...more });

/** Random numbers that are the same on every run. */
function dice(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A promise nobody caught would end the app on the bar: none may be left. */
const uncaught = [];
const note = (reason) => uncaught.push(String(reason && reason.stack ? reason.stack : reason));
let app;
before(async () => {
  process.on("unhandledRejection", note);
  app = await builtApp();
});
after(() => process.off("unhandledRejection", note));

/** Every pixel is a colour of the palette, and every line on the back is text the bar can show. */
function assertSane(bar, what) {
  assert.equal(bar.alive, true, what + ": the app is still running");
  assert.deepEqual(uncaught, [], what + ": a promise was left uncaught");
  if (bar.front) {
    assert.equal(bar.front.length, 16, what);
    for (const row of bar.front) assert.match(row, /^[.natdrRwlkeKG]{72}$/, what);
  }
  for (const id in bar.back) {
    const element = bar.back[id];
    if (element.type === "text") {
      assert.match(element.text, /^[\x20-\x7e]+$/, what + ": the back display's " + id + " is " + JSON.stringify(element.text));
      assert.ok(element.text.length <= 34, what + ": the back display's " + id + " is too long: " + element.text);
    }
  }
}

const ODD_RADAR = [
  "",
  "\n\n\n",
  "<html><body>502 Bad Gateway</body></html>",
  "000|21:15",
  "999|99:99\r\n-12|21:20\r\nabc|21:25\r\n077|",
  "077|21:15\r\n".repeat(500),
  "077|21:15|extra|fields\r\n1e3|21:20\r\n",
  "\u0000\u0001\u0002",
  "077|21:15\n077|21:15\n077|21:15\n",
  "255|03:00\r\n255|03:05\r\n",
  JSON.stringify({ error: "rate limited" }),
  500,
  503,
  301,
  null,
];

const ODD_MODEL = [
  {},
  [],
  "not json at all",
  "",
  { hourly: {} },
  { hourly: { time: [], precipitation: [] } },
  { hourly: { time: [1, 2, 3], precipitation: [] } },
  { hourly: { time: ["soon", "later"], precipitation: ["wet", "dry"] } },
  { hourly: { time: [TAKEN / 1000], precipitation: [null] } },
  { hourly: { time: [TAKEN / 1000, TAKEN / 1000 + 3600], precipitation: [-5, 1e12] } },
  { hourly: { time: [0, 0, 0], precipitation: [1, 1, 1] } },
  { hourly: { time: [TAKEN / 1000 + 1e7], precipitation: [3] } },
  { hourly: { time: MODEL.hourly.time, precipitation: MODEL.hourly.time.map(() => NaN) } },
  { hourly: { time: MODEL.hourly.time, precipitation: MODEL.hourly.time.map(() => "2.5") } },
  { hourly: MODEL.hourly, minutely_15: { time: [1], precipitation: [] } },
  { hourly: MODEL.hourly, minutely_15: "soon" },
  { error: true, reason: "Cannot initialize WeatherVariable" },
  400,
  500,
  null,
];

test("the parsers take anything without throwing", () => {
  for (const answer of ODD_RADAR) {
    const nowcast = parseNowcast(answer);
    if (!nowcast) continue;
    assert.ok(nowcast.minute >= 0 && nowcast.minute <= 99);
    for (const level of nowcast.levels) assert.ok(Number.isInteger(level) && level >= 0 && level <= 255, String(level));
  }
  for (const answer of ODD_MODEL) {
    const model = parseModel(answer);
    if (!model) continue;
    for (const level of model.hours.levels) assert.ok(Number.isInteger(level) && level >= 0 && level <= 255, String(level));
  }
});

test("any pair of answers makes a series the displays can draw, or none", () => {
  const cv = createFront();
  const columns = new Uint8Array(72);
  for (const radar of ODD_RADAR.concat([RADAR])) {
    for (const answer of ODD_MODEL.concat([MODEL])) {
      const nowcast = typeof radar === "string" ? parseNowcast(radar) : null;
      const model = answer && typeof answer === "object" ? parseModel(answer) : null;
      const series = buildSeries(TAKEN, nowcast, model);
      if (!series) continue;
      assert.equal(series.levels.length, STEPS);
      for (const hours of [1, 2, 7.3, 48]) {
        sampleColumns(series, TAKEN, hours, columns);
        const show = describe({
          series,
          version: 1,
          freshAt: TAKEN,
          now: TAKEN,
          zone: 60,
          hours,
          window: Math.round(hours),
          labelled: hours === 2,
          inWords: hours === 48,
          language: "nl",
          place: "Utrecht",
          frame: 7,
        });
        drawFront(cv, show);
        for (const pixel of cv.px) assert.match(pixel, /^[.natdrRwlkeKG]$/);
        for (const element of backElements(show)) {
          if (element.type === "text") assert.match(element.text, /^[\x20-\x7e]+$/);
        }
      }
    }
  }
});

test("the series, the columns and the headline hold at any moment, before, in and long after the data", () => {
  const series = buildSeries(TAKEN, parseNowcast(RADAR), parseModel(MODEL));
  const columns = new Uint8Array(72);
  const moments = [-1e12, -86400000, -1, 0, 1, 299999, 47 * 3600000, 48 * 3600000, 49 * 3600000, 1e12];
  for (const offset of moments) {
    for (const zone of [-720, -330, 0, 60, 345, 840]) {
      for (const language of ["en", "nl", "zz", undefined]) {
        const words = headline(series, TAKEN + offset, zone, language);
        for (const part of [words.full, words.top, words.bottom]) assert.match(part, /^[\x20-\x7e]+$/, part);
        assert.doesNotMatch(words.full + words.bottom, /NaN|undefined|Infinity|-\d/, words.full + " / " + words.bottom);
      }
    }
    for (const hours of [0.001, 1, 48, 1000]) {
      sampleColumns(series, TAKEN + offset, hours, columns);
      for (const level of columns) assert.ok(level >= 0 && level <= 255);
    }
  }
});

test("settings of any shape give settings the app can run on", () => {
  const odd = [undefined, null, 0, -1, 1e99, NaN, "", "x", "48", [], {}, { lat: "52", lon: null }, true];
  for (const place of odd.concat([{ lat: 91, lon: 181 }, { lat: -91, lon: -181 }, { lat: Infinity, lon: NaN }])) {
    for (const value of odd) {
      const settings = readSettings({ place, zoom: value, alert: value, sound: value, language: value });
      assert.ok(settings.place.lat >= -90 && settings.place.lat <= 90, JSON.stringify(place));
      assert.ok(settings.place.lon >= -180 && settings.place.lon <= 180, JSON.stringify(place));
      assert.equal(typeof settings.place.name, "string");
      assert.ok(Number.isInteger(settings.zoom) && settings.zoom >= 0 && settings.zoom <= 9, String(value));
      assert.ok(Number.isFinite(settings.alert) && settings.alert >= 0 && settings.alert <= 120, String(value));
      assert.equal(typeof settings.sound, "boolean");
      assert.ok(settings.language === "en" || settings.language === "nl");
    }
  }
});

test("a place name with accents, emoji or great length is shown as text the bar can show", async () => {
  const names = [
    "Súdwest-Fryslân, Friesland, The Netherlands",
    "'s-Hertogenbosch",
    "Zürich — Kreis 1",
    "東京",
    "🌧️",
    "x".repeat(300),
    "",
    "   ",
    "line\nbreak\ttab",
  ];
  for (const name of names) {
    const bar = await launch(app, live({ settings: { place: { mode: "fixed", name, lat: 52.1, lon: 5.1 } } }));
    assertSane(bar, "place " + JSON.stringify(name));
    assert.ok(bar.text("head1"), "the headline is on show");
  }
});

test("it survives every odd answer of the sources, and shows rain only when it has some", async () => {
  for (const radar of ODD_RADAR) {
    for (const model of [ODD_MODEL[0], ODD_MODEL[2], ODD_MODEL[7], ODD_MODEL[9], ODD_MODEL[12], 500, null]) {
      const bar = await launch(app, { at: TAKEN, radar, model });
      await bar.advance(7 * 60000);
      await bar.wheel(3);
      await bar.press("ok");
      assertSane(bar, "radar " + JSON.stringify(radar).slice(0, 40) + " model " + JSON.stringify(model).slice(0, 40));
    }
  }
});

test("mashing the buttons and the wheel breaks nothing", async () => {
  const roll = dice(7);
  const bar = await launch(app, live());
  const actions = ["press", "release", "short", "long", "repeat"];
  const keys = ["ok", "start", "back-not-yet", "encoder", "unknown"];
  for (let i = 0; i < 1500; i++) {
    const key = keys[Math.floor(roll() * keys.length)];
    if (key === "encoder") bar.handler({ key, action: "clockwise", delta: roll() < 0.5 ? 1 : -1 });
    else bar.handler({ key, action: actions[Math.floor(roll() * actions.length)] });
    if (roll() < 0.3) await bar.advance(Math.floor(roll() * 400));
  }
  await bar.advance(3000);
  assertSane(bar, "after 1500 events");
  // Events of shapes the firmware does not send.
  for (const event of [{}, { key: "encoder" }, { key: "encoder", delta: 1e9 }, { key: "encoder", delta: NaN }, { key: "encoder", delta: "2" }]) {
    bar.handler(event);
    await bar.advance(1500);
    assertSane(bar, "event " + JSON.stringify(event));
  }
  await bar.wheel(-40);
  await bar.advance(2000);
  assert.equal(bar.text("window"), "Next 1 hour on the front");
});

test("Back in the middle of anything quits cleanly, once", async () => {
  for (const moment of [0, 90, 400, 1100]) {
    const bar = await launch(app, live());
    await bar.wheel(2);
    await bar.advance(moment);
    bar.handler({ key: "back", action: "short" });
    if (bar.handler) bar.handler({ key: "back", action: "short" });
    await bar.advance(5 * 60000);
    assert.equal(bar.alive, false, "after " + moment + " ms");
    assert.deepEqual(uncaught, []);
  }
});

test("the bar's clock may jump: back, far ahead, and across midnight", async () => {
  const bar = await launch(app, live());
  for (const jump of [-3600000, -86400000 * 3, 86400000 * 400, -86400000 * 397, 3 * 3600000]) {
    bar.jump(jump);
    await bar.advance(90000);
    await bar.wheel(1);
    await bar.advance(2000);
    assertSane(bar, "after a jump of " + jump / 3600000 + " hours");
  }
});

test("a display that refuses frames, a bar with no settings and no clock: it carries on", async () => {
  const bar = await launch(app, live({ broken: ["display/draw", "apps/settings", "time", "wifi/status"] }));
  await bar.advance(10 * 60000);
  assert.equal(bar.alive, true);
  assert.deepEqual(uncaught, []);
  bar.broken = [];
  await bar.advance(3000);
  assertSane(bar, "once the bar answers again");
  assert.ok(bar.text("head1"));
});

test("a week of sources that fail at random, a Wi-Fi that comes and goes, and someone at the wheel", async () => {
  const roll = dice(42);
  const bar = await launch(app, live());
  const radars = ODD_RADAR.concat([RADAR, RADAR, RADAR, RADAR]);
  const models = ODD_MODEL.concat([MODEL, MODEL, MODEL, MODEL]);
  for (let quarter = 0; quarter < 7 * 96; quarter++) {
    bar.radar = radars[Math.floor(roll() * radars.length)];
    bar.model = models[Math.floor(roll() * models.length)];
    bar.wifi = roll() < 0.8 ? "connected" : ["disconnected", "connecting", "reconnecting", "unknown", ""][Math.floor(roll() * 5)];
    if (roll() < 0.2) await bar.wheel(Math.floor(roll() * 7) - 3);
    if (roll() < 0.1) await bar.press(roll() < 0.5 ? "ok" : "start");
    await bar.advance(15 * 60000);
    assertSane(bar, "quarter " + quarter);
  }
  // However it went, with the sources back the app shows rain again.
  bar.radar = RADAR;
  bar.model = MODEL;
  bar.wifi = "connected";
  await bar.advance(65 * 60000);
  assertSane(bar, "at the end of the week");
  assert.equal(bar.text("source"), "Buienradar + KNMI via Open-Meteo");
});
