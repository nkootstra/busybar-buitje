// The app the benchmark runs on the bar: it makes and sends frames through the same screen.js Buitje itself
// uses, with rain made up here instead of fetched, and logs how long a frame takes.
//
// This file is not run from here. tools/bench.mjs copies src/ aside, puts this file in as its main.js, builds
// that as an app of its own and reads its log: the imports below are of the modules it then sits among.
import manifest from "./appmeta/manifest.json";
import { draw } from "./bar.js";
import { STEPS, buildSeries } from "./rain.js";
import { createScreen } from "./screen.js";
import { describe } from "./show.js";

const APP = manifest.id;
const FRAMES = 10;
const screen = createScreen();
const start = Date.now();

/** Two days with a fair amount of rain in them: showers of every strength, and dry spells between. */
const rainy = { base: start, levels: new Uint8Array(STEPS), known: STEPS, fine: true };
for (let i = 0; i < STEPS; i++) {
  const wave = (i * 7) % 96;
  rainy.levels[i] = wave < 40 ? 75 + ((wave * 3 + i) % 70) : 0;
}

/** Two dry days with one shower at the very end: the headline has to look all the way to find it. */
const dry = { base: start, levels: new Uint8Array(STEPS), known: STEPS, fine: true };
dry.levels.fill(110, STEPS - 6);

/** A forecast as the parser gives it: 49 hours, and the first 6 of them by the quarter. */
const FORECAST = { hours: { firstEnds: start, span: 3600000, levels: [] }, quarters: { firstEnds: start, span: 900000, levels: [] } };
for (let i = 0; i < 49; i++) FORECAST.hours.levels.push(i % 5 < 2 ? 100 + i : 0);
for (let i = 0; i < 24; i++) FORECAST.quarters.levels.push(i % 7 < 3 ? 90 + i : 0);

/** What to show at frame `t`: `series` in a window of `hours`, an hour east of UTC. */
function show(series, version, hours, t, labelled) {
  // While it slides the window is named for the length it is sliding to, which the wheel chose: 48 here.
  const window = labelled ? 48 : Math.round(hours);
  return describe({ series, version, freshAt: start, now: start + t, zone: 60, hours, window, labelled, place: "Utrecht", frame: t });
}

/**
 * The kinds of frame the app makes, and how each is made. `unsent` ones time the app's own work alone.
 * Every kind is made once before it is timed, so that what is timed is the frame and not the change of scene.
 */
const SCREENS = [
  // At rest only the shimmer moves: the picture is copied, not painted.
  { name: "rest2h", frame: (t) => screen.changes(show(rainy, 1, 2, t), true, false) },
  { name: "rest48h", frame: (t) => screen.changes(show(rainy, 1, 48, t), true, false) },
  { name: "restdry", frame: (t) => screen.changes(show(dry, 2, 48, t), true, false) },
  // While the window slides every frame is a new picture with the window's name on it, and the back waits.
  { name: "slide", frame: (t) => screen.changes(show(rainy, 1, 2 * Math.pow(1.4, t), t, true), false, false) },
  // The name stays on show for a moment after the slide.
  { name: "label", frame: (t) => screen.changes(show(rainy, 1, 9, t, true), true, false) },
  // New data: both displays, whole.
  { name: "both", frame: (t) => screen.changes(show(rainy, 10 + t, 5, t), true, false) },
  { name: "restjs", unsent: true, frame: (t) => screen.changes(show(rainy, 1, 2, t), true, false) },
  { name: "slidejs", unsent: true, frame: (t) => screen.changes(show(rainy, 1, 3 * Math.pow(1.4, t), t, true), false, false) },
  // Making a fresh forecast into a series: every quarter of an hour.
  { name: "joinjs", unsent: true, frame: () => buildSeries(start, FORECAST) },
];

let total = 0;
function run(index) {
  if (index === SCREENS.length) {
    // The mean is of what a person sees: the frames that are sent.
    console.log("bench frame_ms " + (total / SCREENS.filter((kind) => !kind.unsent).length).toFixed(1));
    return;
  }
  const kind = SCREENS[index];
  kind.frame(0);
  const started = Date.now();
  const step = (t) => {
    if (t > FRAMES) {
      const frame = (Date.now() - started) / FRAMES;
      if (!kind.unsent) total += frame;
      console.log("bench " + kind.name + " " + frame.toFixed(1));
      setTimeout(() => run(index + 1), 0);
      return;
    }
    const elements = kind.frame(t);
    if (kind.unsent || !elements.length) setTimeout(() => step(t + 1), 0);
    else draw(APP, elements).then(() => step(t + 1));
  };
  step(1);
}

run(0);
