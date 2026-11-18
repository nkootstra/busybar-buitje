// Attempts to break the app: answers no service should give, settings no page should save, buttons mashed,
// clocks that jump. Whatever happens it must keep running, throw nothing, and never show what it does not know.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { backElements } from "../src/back.js";
import { createFront, drawFront } from "../src/front.js";
import { headline } from "../src/headline.js";
import { STEPS, buildSeries, sampleColumns } from "../src/rain.js";
import { readSettings } from "../src/settings.js";
import { describe } from "../src/show.js";
import { parseForecast } from "../src/sources.js";
import { builtApp, launch } from "../tools/sim.mjs";
import { AT, EVENING, directNowcast, forecast, nowcast, of } from "./forecast.mjs";

const evening = (more = {}) => ({ at: AT, forecast: EVENING, ...more });

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

const SECONDS = AT / 1000;
/** Answers the forecast service should never give, and some it might on a bad day. */
const ODD = [
  {},
  [],
  "not json at all",
  "",
  "<html><body>502 Bad Gateway</body></html>",
  { hourly: {} },
  { hourly: { time: [], precipitation: [] } },
  { hourly: { time: [1, 2, 3], precipitation: [] } },
  { hourly: { time: ["soon", "later"], precipitation: ["wet", "dry"] } },
  { hourly: { time: [SECONDS], precipitation: [null] } },
  { hourly: { time: [SECONDS, SECONDS + 3600], precipitation: [-5, 1e12] } },
  { hourly: { time: [0, 0, 0], precipitation: [1, 1, 1] } },
  { hourly: { time: [SECONDS + 1e7], precipitation: [3] } },
  { hourly: { time: EVENING.hourly.time, precipitation: EVENING.hourly.time.map(() => NaN) } },
  { hourly: { time: EVENING.hourly.time, precipitation: EVENING.hourly.time.map(() => "2.5") } },
  { hourly: { time: EVENING.hourly.time, precipitation: EVENING.hourly.time.map((_, i) => (i < 4 ? 1 : null)) } },
  { hourly: EVENING.hourly, minutely_15: { time: [1], precipitation_icon_d2: [] } },
  { hourly: EVENING.hourly, minutely_15: "soon" },
  { hourly: EVENING.hourly, minutely_15: { time: EVENING.minutely_15.time, precipitation_icon_d2: [1, null, 1] } },
  { error: true, reason: "Cannot initialize WeatherVariable" },
  forecast({ hours: of(48, 300), quarters: of(24, 80) }),
  400,
  500,
  301,
  null,
];

test("the parser takes anything without throwing, and gives levels or nothing", () => {
  for (const answer of ODD) {
    const parsed = parseForecast(answer);
    if (!parsed) continue;
    for (const block of [parsed.hours, parsed.quarters]) {
      if (!block) continue;
      assert.ok(block.firstEnds > 0);
      for (const level of block.levels) assert.ok(Number.isInteger(level) && level >= 0 && level <= 255, String(level));
    }
  }
});

test("any answer makes a series the displays can draw, or none", () => {
  const cv = createFront();
  for (const answer of ODD.concat([EVENING])) {
    const series = buildSeries(AT, answer && typeof answer === "object" ? parseForecast(answer) : null);
    if (!series) continue;
    assert.equal(series.levels.length, STEPS);
    assert.ok(series.known >= 0 && series.known <= STEPS);
    for (const hours of [1, 2, 7.3, 48]) {
      const show = describe({ series, version: 1, freshAt: AT, now: AT, zone: 60, hours, window: Math.round(hours), labelled: hours === 2, inWords: hours === 48, language: "nl", place: "Utrecht", frame: 7 });
      drawFront(cv, show);
      for (const pixel of cv.px) assert.match(pixel, /^[.natdrRwlkeKG]$/);
      for (const element of backElements(show)) {
        if (element.type === "text") assert.match(element.text, /^[\x20-\x7e]+$/);
      }
    }
  }
});

test("a forecast with a gap in it is known only up to the gap", () => {
  const gap = { hourly: { time: EVENING.hourly.time, precipitation: EVENING.hourly.time.map((_, i) => (i < 4 ? 0 : null)) } };
  const series = buildSeries(AT, parseForecast(gap));
  // Three hours from the top of this one: 34 steps from 21:10.
  assert.equal(series.known, 34);
  assert.equal(headline(series, AT, 60, "en").full, "Dry for the next 3 hours");
});

test("the series, the columns and the headline hold at any moment, before, in and long after the data", () => {
  const series = buildSeries(AT, parseForecast(EVENING));
  const columns = new Uint8Array(72);
  const moments = [-1e12, -86400000, -1, 0, 1, 299999, 47 * 3600000, 48 * 3600000, 49 * 3600000, 1e12];
  for (const offset of moments) {
    for (const zone of [-720, -330, 0, 60, 345, 840]) {
      for (const language of ["en", "nl", "zz", undefined]) {
        const words = headline(series, AT + offset, zone, language);
        for (const part of [words.full, words.top, words.bottom]) assert.match(part, /^[\x20-\x7e]+$/, part);
        assert.doesNotMatch(words.full + words.bottom, /NaN|undefined|Infinity|-\d/, words.full + " / " + words.bottom);
      }
    }
    for (const hours of [0.001, 1, 48, 1000]) {
      sampleColumns(series, AT + offset, hours, columns);
      for (const level of columns) assert.ok(level >= 0 && level <= 255);
    }
  }
});

test("a frame is what it shows and nothing of the frames before it", () => {
  const series = buildSeries(AT, parseForecast(EVENING));
  const cv = createFront();
  const picture = (fields) => {
    drawFront(cv, describe({ series, version: 1, freshAt: AT, now: AT, zone: 60, hours: 2, window: 2, place: "x", ...fields }));
    return cv.px.join("");
  };
  // The shimmer and the mark for old data are drawn over the picture and taken off again: after any run of
  // other frames, the same description gives the same picture.
  const first = picture({ frame: 3 });
  for (let frame = 0; frame < 200; frame++) picture({ frame, stale: frame % 7 === 0 });
  picture({ inWords: true, stale: true });
  picture({ labelled: true, frame: 9 });
  assert.equal(picture({ frame: 3 }), first);
  assert.notEqual(picture({ frame: 4 }), first, "the shimmer does move");
  const marked = picture({ frame: 3, stale: true });
  assert.equal(marked.slice(0, -1), first.slice(0, -1));
  assert.equal(marked.slice(-1), "e");
});

test("settings of any shape give settings the app can run on", () => {
  const odd = [undefined, null, 0, -1, 1e99, NaN, "", "x", "48", [], {}, { lat: "52", lon: null }, true];
  for (const place of odd.concat([{ lat: 91, lon: 181 }, { lat: -91, lon: -181 }, { lat: Infinity, lon: NaN }])) {
    for (const value of odd) {
      const settings = readSettings({ place, zoom: value, alert: value, sound: value, language: value });
      assert.ok(settings.place.lat >= -90 && settings.place.lat <= 90, JSON.stringify(place));
      assert.ok(settings.place.lon >= -180 && settings.place.lon <= 180, JSON.stringify(place));
      assert.equal(typeof settings.place.name, "string");
      assert.ok(Number.isInteger(settings.zoomStep) && settings.zoomStep >= 0 && settings.zoomStep <= 9, String(value));
      assert.ok(Number.isFinite(settings.alert) && settings.alert >= 0 && settings.alert <= 120, String(value));
      assert.equal(typeof settings.sound, "boolean");
      assert.ok(settings.language === "en" || settings.language === "nl");
    }
  }
  assert.equal(readSettings(null).language, "en");
});

test("a place name with accents, emoji or great length is shown as text the bar can show", async () => {
  const names = [
    "Súdwest-Fryslân, Friesland, The Netherlands",
    "'s-Hertogenbosch",
    "Zürich — Kreis 1",
    "Straße, Łódź",
    "東京",
    "🌧️",
    "x".repeat(300),
    "",
    "   ",
    "line\nbreak\ttab",
  ];
  for (const name of names) {
    const bar = await launch(app, evening({ settings: { place: { mode: "fixed", name, lat: 52.1, lon: 5.1 } } }));
    assertSane(bar, "place " + JSON.stringify(name));
    assert.equal(bar.text("head1"), "Drizzle in 30 minutes");
  }
});

test("it survives every odd answer of the service, and shows rain only when it has some", async () => {
  for (const answer of ODD) {
    const bar = await launch(app, { at: AT, forecast: answer });
    await bar.advance(7 * 60000);
    await bar.wheel(3);
    await bar.press("ok");
    assertSane(bar, "answer " + JSON.stringify(answer).slice(0, 60));
  }
});

test("mashing the buttons and the wheel breaks nothing", async () => {
  const roll = dice(7);
  const bar = await launch(app, evening());
  const actions = ["press", "release", "short", "long", "repeat"];
  const keys = ["ok", "start", "encoder", "unknown"];
  for (let i = 0; i < 1500; i++) {
    const key = keys[Math.floor(roll() * keys.length)];
    if (key === "encoder") bar.handler({ key, action: "clockwise", delta: roll() < 0.5 ? 1 : -1 });
    else bar.handler({ key, action: actions[Math.floor(roll() * actions.length)] });
    if (roll() < 0.3) await bar.advance(Math.floor(roll() * 400));
  }
  await bar.advance(3000);
  assertSane(bar, "after 1500 events");
  // Events of shapes the firmware does not send.
  for (const event of [undefined, null, {}, { key: "encoder" }, { key: "encoder", delta: 1e9 }, { key: "encoder", delta: NaN }, { key: "encoder", delta: "2" }]) {
    bar.handler(event);
    await bar.advance(1500);
    assertSane(bar, "event " + JSON.stringify(event));
  }
  await bar.wheel(-40);
  await bar.advance(2000);
  assert.equal(bar.text("window"), "Next 1 hour on the front");
});

test("Back in the middle of anything quits cleanly, once, and asks nothing more of anyone", async () => {
  for (const moment of [0, 90, 400, 1100]) {
    const bar = await launch(app, evening({ nowcast: nowcast([1, 2, 3]) }));
    await bar.wheel(2);
    await bar.advance(moment);
    // A forecast is just due when Back is pressed: it must not be asked for after it.
    bar.handler({ key: "start", action: "short" });
    bar.handler({ key: "back", action: "short" });
    if (bar.handler) bar.handler({ key: "back", action: "short" });
    const asked = bar.requests.length + bar.radarRequests.length + bar.directRequests.length;
    await bar.advance(20 * 60000);
    assert.equal(bar.alive, false, "after " + moment + " ms");
    assert.equal(bar.requests.length + bar.radarRequests.length + bar.directRequests.length, asked, "no request after Back");
    assert.deepEqual(uncaught, []);
  }
});

test("the bar's clock may jump: back, far ahead, and across midnight", async () => {
  const bar = await launch(app, evening());
  for (const jump of [-3600000, -86400000 * 3, 86400000 * 400, -86400000 * 397, 3 * 3600000]) {
    bar.jump(jump);
    await bar.advance(90000);
    await bar.wheel(1);
    await bar.advance(2000);
    assertSane(bar, "after a jump of " + jump / 3600000 + " hours");
  }
});

test("a display that refuses frames, a bar with no settings and no clock: it carries on", async () => {
  const bar = await launch(app, evening({ broken: ["display/draw", "apps/settings", "time", "wifi/status"] }));
  await bar.advance(10 * 60000);
  assert.equal(bar.alive, true);
  assert.deepEqual(uncaught, []);
  bar.broken = [];
  await bar.advance(3000);
  assertSane(bar, "once the bar answers again");
  assert.equal(bar.text("head1"), "Drizzle in 20 minutes");
});

test("a week of a service that fails at random, a Wi-Fi that comes and goes, and someone at the wheel", async () => {
  const roll = dice(42);
  const bar = await launch(app, evening());
  const answers = ODD.concat(of(12, EVENING));
  const radar = [null, 500, "", {}, { run: 5, step: 300, rain: [1e9, -1] }, { run: 1e12, step: 1, rain: of(25, 2) }];
  // Not among them: the relay saying the radar has no data here, after which the app rightly leaves it alone
  // for hours. The app tests have that.
  for (let quarter = 0; quarter < 7 * 96; quarter++) {
    bar.forecast = answers[Math.floor(roll() * answers.length)];
    bar.nowcast = roll() < 0.5 ? nowcast(of(24, roll() * 8), bar.now - Math.floor(roll() * 3) * 600000) : radar[Math.floor(roll() * radar.length)];
    bar.direct = roll() < 0.4 ? directNowcast(of(12, roll() * 8)) : [null, 403, "", {}, [], [{ data: {} }], [{ data: { run: { soon: "wet" } } }], { error: "Quota exceeded" }][Math.floor(roll() * 8)];
    bar.wifi = roll() < 0.8 ? "connected" : ["disconnected", "connecting", "reconnecting", "unknown", ""][Math.floor(roll() * 5)];
    if (roll() < 0.2) await bar.wheel(Math.floor(roll() * 7) - 3);
    if (roll() < 0.1) await bar.press(roll() < 0.5 ? "ok" : "start");
    await bar.advance(15 * 60000);
    assertSane(bar, "quarter " + quarter);
  }
  // However it went, with the service back the app shows a forecast again.
  bar.forecast = forecast({ at: bar.now, hours: of(48, 1), quarters: of(24, 0.25) });
  bar.nowcast = 500;
  bar.direct = null;
  bar.wifi = "connected";
  await bar.advance(65 * 60000);
  assertSane(bar, "at the end of the week");
  assert.equal(bar.text("head1"), "Rain for the next 2 days");
  assert.equal(bar.text("source"), "KNMI + DWD via Open-Meteo");
  bar.nowcast = nowcast(of(24, 1), bar.now);
  await bar.advance(6 * 60000);
  assert.equal(bar.text("source"), "KNMI radar + DWD via Open-Meteo");
});
