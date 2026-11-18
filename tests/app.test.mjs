// The built app on a pretend bar: what a person sees when they use it, with the sources answering from fixtures.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { builtApp, launch } from "../tools/sim.mjs";

const fixture = (name) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
/** The fixtures were taken at 21:14 on 17 November 2026: dry, drizzle from 21:45, a shower at 23:00. */
const TAKEN = Number(fixture("taken-at.txt")) * 1000;
const RADAR = fixture("raintext-amsterdam.txt");
const MODEL = JSON.parse(fixture("model-amsterdam.json"));
const live = (more = {}) => ({ at: TAKEN, radar: RADAR, model: MODEL, ...more });

/** A radar answer of 24 lines from 21:15 on, with `level` from line `from` to line `to`. */
function radar(level, from = 0, to = 24) {
  const lines = [];
  for (let i = 0; i < 24; i++) {
    const minutes = 21 * 60 + 15 + i * 5;
    const time = String(Math.floor(minutes / 60) % 24).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
    lines.push(String(i >= from && i < to ? level : 0).padStart(3, "0") + "|" + time);
  }
  return lines.join("\r\n") + "\r\n";
}
/** A model answer that is dry for the two days. */
const dryModel = () => ({ hourly: { time: MODEL.hourly.time, precipitation: MODEL.hourly.time.map(() => 0) } });

const colours = (bar) => new Set(bar.front.join(""));
const rainPixels = (bar) => bar.front.slice(1).join("").replace(/[^rRd]/g, "").length;

let app;
before(async () => {
  app = await builtApp();
});

test("it shows the rain ahead and says what is coming", async () => {
  const bar = await launch(app, live());
  assert.equal(bar.front.length, 16);
  assert.equal(bar.front[0].length, 72);
  assert.equal(bar.front[0][0], "w", "now is marked on the axis");
  assert.ok(rainPixels(bar) > 20, "rain hangs from the axis");
  // Dry for the first half hour: nothing under the first columns.
  for (let y = 1; y < 16; y++) assert.equal(bar.front[y].slice(0, 18), "n".repeat(18));
  assert.equal(bar.text("head1"), "Drizzle in 30 minutes");
  assert.equal(bar.text("head2"), "Utrecht");
  assert.match(bar.requests[0], /\?lat=52\.09&lon=5\.12$/, "without a place it asks for Utrecht");
  assert.equal(bar.text("window"), "Next 2 hours on the front");
  assert.equal(bar.text("source"), "Buienradar + KNMI via Open-Meteo");
  assert.equal(bar.back.map.type, "xpmbitmap");
  assert.deepEqual(bar.errors, []);
});

test("it asks each source once at the start, for the place in the settings", async () => {
  const place = { mode: "fixed", name: "Groningen", lat: 53.21917, lon: 6.56667 };
  const bar = await launch(app, live({ settings: { place } }));
  assert.equal(bar.requests.length, 2);
  assert.match(bar.requests[0], /^https:\/\/gpsgadget\.buienradar\.nl\/data\/raintext\?lat=53\.22&lon=6\.57$/);
  assert.match(bar.requests[1], /^http:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=53\.22&longitude=6\.57&/);
  assert.equal(bar.text("head2"), "Groningen");
});

test("the wheel sets how far ahead it looks, and says so for a moment", async () => {
  const bar = await launch(app, live());
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
  const bar = await launch(app, live());
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
  const bar = await launch(app, live({ settings: { zoom: "5" } }));
  assert.equal(bar.text("window"), "Next 5 hours on the front");
  await bar.wheel(2);
  await bar.advance(2500);
  assert.equal(bar.text("window"), "Next 12 hours on the front");
  await bar.advance(35000);
  assert.equal(bar.text("window"), "Next 5 hours on the front");
});

test("OK switches between the timeline and the headline in words", async () => {
  const bar = await launch(app, live());
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

test("the time slides on between two fetches", async () => {
  const bar = await launch(app, live());
  assert.equal(bar.text("head1"), "Drizzle in 30 minutes");
  bar.radar = bar.model = null;
  await bar.advance(16 * 60000);
  assert.equal(bar.text("head1"), "Drizzle in 15 minutes");
});

test("it warns once when rain is about to start", async () => {
  const bar = await launch(app, live({ settings: { sound: true } }));
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
  const off = await launch(app, live({ settings: { alert: "0" } }));
  await off.advance(25 * 60000);
  assert.deepEqual(off.lights, []);
  const silent = await launch(app, live());
  await silent.advance(25 * 60000);
  assert.equal(silent.lights.length, 1);
  assert.deepEqual(silent.sounds, []);
});

test("a window without rain says so; rain later shows when the wheel looks further", async () => {
  const bar = await launch(app, live({ radar: radar(0), model: MODEL, settings: { zoom: "1" } }));
  assert.equal(rainPixels(bar), 0);
  assert.ok(colours(bar).has("k"), "DRY NEXT 1H is written");
  await bar.wheel(9);
  await bar.advance(2500);
  assert.ok(rainPixels(bar) > 0);
});

test("dry for two days", async () => {
  const bar = await launch(app, live({ radar: radar(0), model: dryModel() }));
  assert.equal(bar.text("head1"), "Dry for the next 2 days");
  assert.equal(rainPixels(bar), 0);
});

test("before the first answer it says it is loading, not that it is dry", async () => {
  const bar = await launch(app, { at: TAKEN, radar: null, model: null });
  assert.equal(rainPixels(bar), 0);
  assert.ok(colours(bar).has("k"));
  assert.notEqual(bar.text("head1"), "Dry for the next 2 days");
  assert.equal(bar.text("head2"), "No rain data. Start: try again");
  assert.ok(bar.errors.length > 0, "the failures are reported");
});

test("when the sources fail it keeps what it has, marks it as old, and asks again", async () => {
  const bar = await launch(app, live());
  const asked = bar.requests.length;
  bar.radar = bar.model = null;
  await bar.advance(6 * 60000);
  assert.ok(bar.requests.length > asked, "it asked again after 5 minutes");
  assert.ok(rainPixels(bar) > 0, "the rain is still shown");
  assert.equal(bar.front[15][71] === "e", false, "not old yet");
  await bar.advance(20 * 60000);
  assert.equal(bar.front[15][71], "e", "old now");
  // The sources come back: fresh data, the mark goes.
  bar.radar = RADAR;
  bar.model = MODEL;
  await bar.advance(2 * 60000);
  assert.notEqual(bar.front[15][71], "e");
});

test("a failed request is tried again after a minute, not at once", async () => {
  const bar = await launch(app, { at: TAKEN, radar: null, model: null });
  assert.equal(bar.requests.length, 2);
  await bar.advance(30000);
  assert.equal(bar.requests.length, 2);
  await bar.advance(45000);
  assert.equal(bar.requests.length, 4);
});

test("without Wi-Fi it says so, asks nothing of the internet, and starts by itself when the Wi-Fi comes", async () => {
  const bar = await launch(app, live({ wifi: "disconnected" }));
  assert.equal(bar.requests.length, 0);
  assert.equal(rainPixels(bar), 0);
  assert.equal(bar.text("head2"), "The bar is not on Wi-Fi");
  const connecting = (await launch(app, live({ wifi: "connecting" }))).front.join("");
  await bar.advance(10 * 60000);
  assert.equal(bar.requests.length, 0);
  assert.equal(bar.text("head2"), "The bar is not on Wi-Fi");
  assert.equal(bar.front.join(""), connecting, "the same words whatever the reason the Wi-Fi is not there");

  bar.wifi = "connected";
  await bar.advance(70000);
  assert.equal(bar.text("head1"), "Drizzle in 20 minutes");
  assert.ok(rainPixels(bar) > 0);
});

test("when the connection drops it keeps the picture, says since when, and comes back by itself", async () => {
  const bar = await launch(app, live());
  const asked = bar.requests.length;
  bar.wifi = "disconnected";
  await bar.advance(25 * 60000);
  assert.equal(bar.requests.length, asked, "nothing is asked of the internet without Wi-Fi");
  assert.ok(rainPixels(bar) > 0, "the rain it knew of is still shown");
  assert.equal(bar.front[15][71], "e", "marked as old");
  assert.equal(bar.text("window"), "No Wi-Fi. Data from 21:14");
  assert.equal(bar.text("source"), "Buienradar + KNMI via Open-Meteo", "the credit stays");

  bar.wifi = "connected";
  await bar.advance(2 * 60000);
  assert.equal(bar.text("window"), "Next 2 hours on the front");
  assert.notEqual(bar.front[15][71], "e");
});

test("sources that do not answer are asked less and less often", async () => {
  const bar = await launch(app, { at: TAKEN, radar: null, model: null });
  const asked = [bar.requests.length];
  // Again after 1 minute, then 2, then 4; after that the radar at its usual 5 and the model later still.
  for (const minutes of [1.1, 2, 4, 5]) {
    await bar.advance(minutes * 60000);
    asked.push(bar.requests.length);
  }
  assert.deepEqual(asked, [2, 4, 6, 8, 9]);
});

test("data too old to trust is taken off, rather than left to say it stays dry", async () => {
  const bar = await launch(app, live());
  bar.wifi = "disconnected";
  await bar.advance(3 * 3600000 + 2 * 60000);
  assert.equal(rainPixels(bar), 0);
  assert.equal(bar.text("head1"), "Utrecht");
  assert.equal(bar.text("head2"), "The bar is not on Wi-Fi");
  // Nothing of the old data is left on the back display either.
  for (const id of ["now", "day", "window", "source"]) assert.equal(bar.text(id), " ", id);
  assert.doesNotMatch(bar.back.map.data.split("\n").slice(-14).join(""), /[^.]/, "the strip is empty");
});

test("a radar answer from long ago is not used again when only the model answers", async () => {
  const bar = await launch(app, live());
  assert.equal(bar.text("source"), "Buienradar + KNMI via Open-Meteo");
  bar.radar = null;
  // An hour on the model is asked again and answers; the radar has failed all that time.
  await bar.advance(62 * 60000);
  assert.notEqual(bar.text("source"), "Buienradar + KNMI via Open-Meteo");
  assert.notEqual(bar.text("head1"), null);
});

test("with only the radar answering it speaks of the 2 hours it knows, not of 2 days", async () => {
  const bar = await launch(app, live({ radar: radar(0), model: null }));
  assert.equal(bar.text("head1"), "Dry for the next 2 hours");
  assert.match(bar.front[0], /^w[at]+$/, "at 2 hours the axis, with its hour marks, runs the whole way");
  await bar.wheel(9);
  await bar.advance(2500);
  assert.equal(bar.text("window"), "Next 48 hours on the front");
  assert.match(bar.front[0], /^w[at]*n+$/, "at 48 hours it ends where the radar does");
  assert.equal(colours(bar).has("k"), false, "and nothing says the 48 hours are dry");
});

test("a bar that cannot say whether it is on Wi-Fi is taken to be", async () => {
  for (const wifi of ["unknown", "undefined", "something new"]) {
    const bar = await launch(app, live({ wifi }));
    assert.equal(bar.requests.length, 2, wifi);
    assert.equal(bar.text("head1"), "Drizzle in 30 minutes", wifi);
  }
});

test("old data is marked in the headline view too", async () => {
  const bar = await launch(app, live());
  bar.wifi = "disconnected";
  await bar.advance(25 * 60000);
  await bar.press("ok");
  assert.doesNotMatch(bar.front[0], /a/, "the headline view");
  assert.equal(bar.front[15][71], "e");
});

test("the alert comes in the headline view as well, where nothing else changes", async () => {
  const bar = await launch(app, live());
  await bar.press("ok");
  await bar.advance(17 * 60000);
  assert.equal(bar.lights.length, 1);
});

test("an alert the bar refused is sent again, not lost", async () => {
  const bar = await launch(app, live());
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

test("through a long outage the sources are never asked in bursts", async () => {
  const bar = await launch(app, { at: TAKEN, radar: null, model: null });
  let asked = bar.requests.length;
  for (let minute = 0; minute < 8 * 60; minute++) {
    await bar.advance(60000);
    assert.ok(bar.requests.length - asked <= 2, "minute " + minute + ": " + (bar.requests.length - asked) + " requests");
    asked = bar.requests.length;
  }
  assert.ok(asked < 130, asked + " requests in 8 hours");
});

test("Start asks for fresh data", async () => {
  const bar = await launch(app, live());
  await bar.press("start");
  assert.equal(bar.requests.length, 4);
});

test("outside the radar's reach the weather model stands in", async () => {
  const place = { mode: "fixed", name: "Berlin", lat: 52.52, lon: 13.4 };
  const bar = await launch(app, live({ radar: 404, settings: { place } }));
  assert.equal(bar.text("source"), "Open-Meteo (KNMI, ECMWF)");
  assert.match(bar.requests[bar.requests.length - 1], /minutely_15=precipitation/);
  assert.notEqual(bar.text("head1"), null);
  assert.deepEqual(bar.errors, []);
  // The radar is not asked again; the model every quarter of an hour.
  const asked = bar.requests.length;
  await bar.advance(16 * 60000);
  assert.equal(bar.requests.length, asked + 1);
  assert.match(bar.requests[asked], /open-meteo/);
});

test("the headline can be in Dutch", async () => {
  const bar = await launch(app, live({ settings: { language: "nl" } }));
  assert.equal(bar.text("head1"), "Motregen over 30 minuten");
  assert.equal(bar.text("window"), "Komende 2 uur op de voorkant");
});

test("it draws slowly while only the rain shimmers, and faster while the window slides", async () => {
  const bar = await launch(app, live());
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
  const bar = await launch(app, live());
  assert.equal(bar.alive, true);
  await bar.press("back");
  assert.equal(bar.alive, false);
  const draws = bar.draws;
  await bar.advance(10 * 60000);
  assert.equal(bar.draws, draws);
});
