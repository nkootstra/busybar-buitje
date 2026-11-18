// The settings are described twice: for the bar in src/appmeta/settings.json, and for the app in the code.
// These hold the two together.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PROBLEMS } from "../src/feed.js";
import { DEFAULTS, HOME, readSettings } from "../src/settings.js";
import { TEXTS } from "../src/texts.js";
import { ZOOMS } from "../src/zoom.js";

const fields = JSON.parse(readFileSync(new URL("../src/appmeta/settings.json", import.meta.url), "utf8")).fields;
const values = (field) => field.options.map((option) => option.value);
/** What the bar gives the app when nobody has set anything: every field's default. */
const untouched = Object.fromEntries(Object.entries(fields).map(([id, field]) => [id, field.default]));

test("the window setting offers exactly the lengths the wheel steps through", () => {
  assert.deepEqual(values(fields.zoom).map(Number), ZOOMS);
});

test("the language setting offers exactly the languages the app speaks", () => {
  assert.deepEqual(values(fields.language).sort(), Object.keys(TEXTS).sort());
});

test("the settings file's defaults are the app's own", () => {
  assert.deepEqual(readSettings(untouched), DEFAULTS);
  assert.deepEqual(readSettings({}), DEFAULTS);
  assert.deepEqual({ name: fields.place.default.name, lat: fields.place.default.lat, lon: fields.place.default.lon }, HOME);
});

test("every choice the settings file offers is one the app takes", () => {
  for (const zoom of values(fields.zoom)) assert.equal(ZOOMS[readSettings({ zoom }).zoom], Number(zoom));
  for (const alert of values(fields.alert)) assert.equal(readSettings({ alert }).alert, Number(alert));
  for (const language of values(fields.language)) assert.equal(readSettings({ language }).language, language);
});

test("a place is taken with its name; odd values fall back to the defaults", () => {
  const place = { mode: "fixed", name: "Borne, Overijssel, The Netherlands", lat: 52.3, lon: 6.75 };
  assert.deepEqual(readSettings({ place }).place, { name: place.name, lat: 52.3, lon: 6.75 });
  assert.deepEqual(readSettings({ place: { mode: "auto", name: "Here" } }).place, HOME);
  assert.deepEqual(readSettings({ zoom: "7", alert: "soon", sound: "yes", language: "fr" }), DEFAULTS);
});

test("a place's name becomes text the bar can show; a place off the map is no place", () => {
  const named = (name) => readSettings({ place: { name, lat: 53.1, lon: 5.8 } }).place.name;
  assert.equal(named("S\u00fadwest-Frysl\u00e2n"), "Sudwest-Fryslan");
  assert.equal(named("\u2019s-Hertogenbosch"), "'s-Hertogenbosch");
  assert.equal(named("  Li\u00e8ge \n Belgi\u00eb  "), "Liege Belgie");
  assert.equal(named("\u6771\u4eac"), "");
  assert.equal(named(undefined), "");
  for (const place of [{ lat: 91, lon: 5 }, { lat: 52, lon: 181 }, { lat: NaN, lon: 5 }, { lat: "52", lon: "5" }, null]) {
    assert.deepEqual(readSettings({ place }).place, HOME, JSON.stringify(place));
  }
});

test("every problem the feed can have has its words in every language", () => {
  for (const language of Object.keys(TEXTS)) {
    for (const problem of PROBLEMS) {
      const texts = TEXTS[language];
      assert.match(texts.problem[problem], /^[A-Z -]+$/, language + " " + problem);
      assert.ok(texts.problemLine[problem].length <= 34, texts.problemLine[problem]);
      assert.ok(texts.dataFrom[problem]("23:59").length <= 34, texts.dataFrom[problem]("23:59"));
    }
  }
});
