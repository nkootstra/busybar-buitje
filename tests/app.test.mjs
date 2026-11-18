// The built app on a pretend bar: what a person sees when they use it, with the forecast service answering
// what each test gives it.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { builtApp, launch } from "../tools/sim.mjs";
import { AT, DRY, EVENING, forecast, of } from "./forecast.mjs";

/** The bar at 21:14 on the evening most tests share: dry, drizzle from 21:45, rain from 23:00. */
const evening = (more = {}) => ({ at: AT, forecast: EVENING, ...more });

const colours = (bar) => new Set(bar.front.join(""));
const rainPixels = (bar) => bar.front.slice(1).join("").replace(/[^rRd]/g, "").length;

let app;
before(async () => {
  app = await builtApp();
});

test("it shows the rain ahead and says what is coming", async () => {
  const bar = await launch(app, evening());
  assert.equal(bar.front.length, 16);
  assert.equal(bar.front[0].length, 72);
  assert.equal(bar.front[0][0], "w", "now is marked on the axis");
  assert.ok(rainPixels(bar) > 20, "rain hangs from the axis");
  // Dry for the first half hour: nothing under the first columns.
  for (let y = 1; y < 16; y++) assert.equal(bar.front[y].slice(0, 18), "n".repeat(18));
  assert.equal(bar.text("head1"), "Drizzle in 30 minutes");
  assert.equal(bar.text("head2"), "Utrecht");
  assert.equal(bar.text("window"), "Next 2 hours on the front");
  assert.equal(bar.text("source"), "KNMI + DWD via Open-Meteo");
  assert.equal(bar.back.map.type, "xpmbitmap");
  assert.deepEqual(bar.errors, []);
});

test("it asks for the forecast once at the start, for the place in the settings, and then every quarter", async () => {
  const place = { mode: "fixed", name: "Groningen", lat: 53.21917, lon: 6.56667 };
  const bar = await launch(app, evening({ settings: { place } }));
  assert.equal(bar.requests.length, 1);
  assert.match(bar.requests[0], /^http:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=53\.22&longitude=6\.57&/);
  assert.match(bar.requests[0], /models=knmi_seamless,icon_d2/);
  assert.equal(bar.text("head2"), "Groningen");
  await bar.advance(14 * 60000);
  assert.equal(bar.requests.length, 1);
  await bar.advance(2 * 60000);
  assert.equal(bar.requests.length, 2);
});

test("without a place it shows Utrecht", async () => {
  const bar = await launch(app, evening());
  assert.match(bar.requests[0], /\?latitude=52\.09&longitude=5\.12&/);
});

test("the wheel sets how far ahead it looks, and says so for a moment", async () => {
  const bar = await launch(app, evening());
  const twoHours = rainPixels(bar);
  await bar.wheel(3);
  assert.match(bar.front.slice(8).join(""), /w/, "the window's name is on the front");
  await bar.advance(2500);
  assert.equal(bar.text("window"), "Next 9 hours on the front");
  assert.doesNotMatch(bar.front.slice(8).join(""), /w/, "and gone again");
  assert.notEqual(rainPixels(bar), twoHours);
  await bar.wheel(20);
  await bar.advance(2500);
  assert.equal(bar.text("window"), "Next 48 hours on the front");
  await bar.wheel(-20);
  await bar.advance(2500);
  assert.equal(bar.text("window"), "Next 1 hour on the front");
});

test("while the wheel turns the front comes first; the back display follows once it rests", async () => {
  const bar = await launch(app, evening());
  const strip = bar.back.map.data;
  await bar.wheel(1);
  await bar.wheel(1);
  await bar.wheel(1);
  assert.equal(bar.text("window"), "Next 2 hours on the front", "not yet");
  assert.equal(bar.back.map.data, strip);
  await bar.advance(1500);
  assert.equal(bar.text("window"), "Next 9 hours on the front");
  assert.notEqual(bar.back.map.data, strip);
});

test("left alone, the window goes back to the one in the settings", async () => {
  const bar = await launch(app, evening({ settings: { zoom: "5" } }));
  assert.equal(bar.text("window"), "Next 5 hours on the front");
  await bar.wheel(2);
  await bar.advance(2500);
  assert.equal(bar.text("window"), "Next 12 hours on the front");
  await bar.advance(35000);
  assert.equal(bar.text("window"), "Next 5 hours on the front");
});

test("OK switches between the timeline and the headline in words", async () => {
  const bar = await launch(app, evening());
  await bar.press("ok");
  assert.doesNotMatch(bar.front[0], /a/, "the timeline and its axis are gone");
  assert.ok(colours(bar).has("w"), "the headline is written");
  const words = bar.front.join("\n");
  await bar.advance(3000);
  assert.equal(bar.front.join("\n"), words, "the headline stands still");
  await bar.press("ok");
  assert.match(bar.front[0], /a/, "the timeline is back");
  // The wheel also brings the timeline back.
  await bar.press("ok");
  await bar.wheel(1);
  await bar.advance(2500);
  assert.match(bar.front[0], /a/);
});

test("the time slides on between two forecasts", async () => {
  const bar = await launch(app, evening());
  assert.equal(bar.text("head1"), "Drizzle in 30 minutes");
  await bar.advance(14 * 60000);
  assert.equal(bar.requests.length, 1, "no new forecast yet");
  assert.equal(bar.text("head1"), "Drizzle in 15 minutes");
});

test("it warns once when rain is about to start", async () => {
  const bar = await launch(app, evening({ settings: { sound: true } }));
  assert.deepEqual(bar.lights, []);
  // Rain in 30 minutes: the alert comes 15 minutes ahead, once.
  await bar.advance(14 * 60000);
  assert.deepEqual(bar.lights, []);
  await bar.advance(4 * 60000);
  assert.equal(bar.lights.length, 1);
  assert.equal(bar.sounds.length, 1);
  await bar.advance(40 * 60000);
  assert.equal(bar.lights.length, 1);
});

test("the alert can be off, and is silent unless asked", async () => {
  const off = await launch(app, evening({ settings: { alert: "0" } }));
  await off.advance(25 * 60000);
  assert.deepEqual(off.lights, []);
  const silent = await launch(app, evening());
  await silent.advance(25 * 60000);
  assert.equal(silent.lights.length, 1);
  assert.deepEqual(silent.sounds, []);
});

test("the alert comes in the headline view as well, where nothing else changes", async () => {
  const bar = await launch(app, evening());
  await bar.press("ok");
  await bar.advance(17 * 60000);
  assert.equal(bar.lights.length, 1);
});

test("an alert the bar refused is sent again, not lost", async () => {
  const bar = await launch(app, evening());
  await bar.advance(14 * 60000);
  bar.broken = ["display/draw"];
  await bar.advance(4 * 60000);
  assert.deepEqual(bar.lights, []);
  bar.broken = [];
  await bar.advance(3000);
  assert.equal(bar.lights.length, 1);
  await bar.advance(60000);
  assert.equal(bar.lights.length, 1, "and only once");
});

test("a window without rain says so; rain later shows when the wheel looks further", async () => {
  const bar = await launch(app, evening({ forecast: forecast({ quarters: of(24, 0), hours: [...of(8, 0), ...of(4, 2), ...of(36, 0)] }), settings: { zoom: "1" } }));
  assert.equal(rainPixels(bar), 0);
  assert.ok(colours(bar).has("k"), "DRY NEXT 1H is written");
  assert.equal(bar.text("head1"), "Dry until tomorrow 5:00");
  await bar.wheel(9);
  await bar.advance(2500);
  assert.ok(rainPixels(bar) > 0);
});

test("dry for two days", async () => {
  const bar = await launch(app, evening({ forecast: DRY }));
  assert.equal(bar.text("head1"), "Dry for the next 2 days");
  assert.equal(rainPixels(bar), 0);
});

test("outside the finer model's reach it shows the forecast by the hour, and credits what that can be", async () => {
  const place = { mode: "fixed", name: "Madrid", lat: 40.42, lon: -3.7 };
  const bar = await launch(app, evening({ forecast: forecast({ hours: [0, 3, ...of(46, 0)] }), settings: { place } }));
  assert.equal(bar.text("source"), "KNMI and others via Open-Meteo");
  // Rain in the hour from 22:00: 46 minutes from now, said to the 5 minutes.
  assert.equal(bar.text("head1"), "Rain in 45 minutes");
  assert.deepEqual(bar.errors, []);
});

test("with a forecast of a few hours it speaks of those, not of 2 days", async () => {
  const bar = await launch(app, evening({ forecast: forecast({ hours: [0, 0, 0] }) }));
  assert.equal(bar.text("head1"), "Dry for the next 3 hours");
  assert.match(bar.front[0], /^w[at]+$/, "at 2 hours the axis, with its hour marks, runs the whole way");
  await bar.wheel(9);
  await bar.advance(2500);
  assert.equal(bar.text("window"), "Next 48 hours on the front");
  assert.match(bar.front[0], /^w[at]*n+$/, "at 48 hours it ends where the forecast does");
  assert.equal(colours(bar).has("k"), false, "and nothing says the 48 hours are dry");
});

test("before the forecast has come it says it is loading, and when it fails that there is no data", async () => {
  const bar = await launch(app, { at: AT, forecast: null });
  assert.equal(rainPixels(bar), 0);
  assert.ok(colours(bar).has("k"));
  assert.equal(bar.text("head1"), "Utrecht");
  assert.equal(bar.text("head2"), "No rain data. Start: try again");
  assert.ok(bar.errors.length > 0, "the failure is reported");
});

test("when the service fails it keeps what it has, marks it as old, and asks again", async () => {
  const bar = await launch(app, evening());
  bar.forecast = null;
  await bar.advance(15.5 * 60000);
  assert.equal(bar.requests.length, 2, "it asked again after a quarter of an hour");
  assert.ok(rainPixels(bar) > 0, "the rain is still shown");
  assert.notEqual(bar.front[15][71], "e", "not old yet");
  await bar.advance(32 * 60000);
  assert.equal(bar.front[15][71], "e", "old now");
  assert.equal(bar.text("window"), "No answer. Data from 21:14");
  assert.equal(bar.text("source"), "KNMI + DWD via Open-Meteo", "the credit stays");
  // The service comes back: fresh data, the mark goes.
  bar.forecast = EVENING;
  await bar.advance(16 * 60000);
  assert.notEqual(bar.front[15][71], "e");
  assert.equal(bar.text("window"), "Next 2 hours on the front");
});

test("a service that does not answer is asked less and less often, and never in bursts", async () => {
  const bar = await launch(app, { at: AT, forecast: null });
  const asked = [bar.requests.length];
  // Again after 1 minute, then 2, 4 and 8; after that at its usual quarter of an hour.
  for (const minutes of [1.1, 2, 4, 8, 15]) {
    await bar.advance(minutes * 60000);
    asked.push(bar.requests.length);
  }
  assert.deepEqual(asked, [1, 2, 3, 4, 5, 6]);
  let before = bar.requests.length;
  for (let minute = 0; minute < 8 * 60; minute++) {
    await bar.advance(60000);
    assert.ok(bar.requests.length - before <= 1, "minute " + minute);
    before = bar.requests.length;
  }
  assert.ok(before < 45, before + " requests in 8 hours");
});

test("Start asks for a fresh forecast", async () => {
  const bar = await launch(app, evening());
  await bar.press("start");
  assert.equal(bar.requests.length, 2);
});

test("without Wi-Fi it says so, asks nothing of the internet, and starts by itself when the Wi-Fi comes", async () => {
  const bar = await launch(app, evening({ wifi: "disconnected" }));
  assert.equal(bar.requests.length, 0);
  assert.equal(rainPixels(bar), 0);
  assert.equal(bar.text("head2"), "The bar is not on Wi-Fi");
  const connecting = (await launch(app, evening({ wifi: "connecting" }))).front.join("");
  await bar.advance(10 * 60000);
  assert.equal(bar.requests.length, 0);
  assert.equal(bar.text("head2"), "The bar is not on Wi-Fi");
  assert.equal(bar.front.join(""), connecting, "the same words whatever the reason the Wi-Fi is not there");

  bar.wifi = "connected";
  await bar.advance(70000);
  assert.equal(bar.text("head1"), "Drizzle in 20 minutes");
  assert.ok(rainPixels(bar) > 0);
});

test("a bar that cannot say whether it is on Wi-Fi is taken to be", async () => {
  for (const wifi of ["unknown", "undefined", "something new"]) {
    const bar = await launch(app, evening({ wifi }));
    assert.equal(bar.requests.length, 1, wifi);
    assert.equal(bar.text("head1"), "Drizzle in 30 minutes", wifi);
  }
});

test("when the connection drops it keeps the picture, says since when, and comes back by itself", async () => {
  const bar = await launch(app, evening());
  bar.wifi = "disconnected";
  await bar.advance(50 * 60000);
  assert.equal(bar.requests.length, 1, "nothing is asked of the internet without Wi-Fi");
  assert.ok(rainPixels(bar) > 0, "the rain it knew of is still shown");
  assert.equal(bar.front[15][71], "e", "marked as old");
  assert.equal(bar.text("window"), "No Wi-Fi. Data from 21:14");
  assert.equal(bar.text("source"), "KNMI + DWD via Open-Meteo", "the credit stays");

  bar.wifi = "connected";
  await bar.advance(2 * 60000);
  assert.equal(bar.text("window"), "Next 2 hours on the front");
  assert.notEqual(bar.front[15][71], "e");
});

test("old data is marked in the headline view too", async () => {
  const bar = await launch(app, evening());
  bar.wifi = "disconnected";
  await bar.advance(50 * 60000);
  await bar.press("ok");
  assert.doesNotMatch(bar.front[0], /a/, "the headline view");
  assert.equal(bar.front[15][71], "e");
});

test("data too old to trust is taken off, rather than left to say it stays dry", async () => {
  const bar = await launch(app, evening());
  bar.wifi = "disconnected";
  await bar.advance(3 * 3600000 + 2 * 60000);
  assert.equal(rainPixels(bar), 0);
  assert.equal(bar.text("head1"), "Utrecht");
  assert.equal(bar.text("head2"), "The bar is not on Wi-Fi");
  // Nothing of the old data is left on the back display either.
  for (const id of ["now", "day", "window", "source"]) assert.equal(bar.text(id), " ", id);
  assert.doesNotMatch(bar.back.map.data.split("\n").slice(-14).join(""), /[^.]/, "the strip is empty");
});

test("the headline can be in Dutch", async () => {
  const bar = await launch(app, evening({ settings: { language: "nl" } }));
  assert.equal(bar.text("head1"), "Motregen over 30 minuten");
  assert.equal(bar.text("window"), "Komende 2 uur op de voorkant");
});

test("it draws slowly while only the rain shimmers, and faster while the window slides", async () => {
  const bar = await launch(app, evening());
  await bar.advance(3000);
  const before = bar.draws;
  await bar.advance(10000);
  const resting = bar.draws - before;
  assert.ok(resting >= 15 && resting <= 22, "about 2 frames a second at rest, got " + resting / 10);
  const start = bar.draws;
  await bar.wheel(1);
  await bar.advance(500);
  assert.ok(bar.draws - start >= 4, "the slide is drawn in steps");
});

test("Back quits: no timer or listener is left behind", async () => {
  const bar = await launch(app, evening());
  assert.equal(bar.alive, true);
  await bar.press("back");
  assert.equal(bar.alive, false);
  const draws = bar.draws;
  await bar.advance(10 * 60000);
  assert.equal(bar.draws, draws);
});
