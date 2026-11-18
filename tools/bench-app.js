// The app the benchmark runs on the bar: it paints and sends frames with the functions Buitje itself uses, with
// rain made up here instead of fetched, and logs how long a frame takes. tools/bench.mjs builds it next to the
// real sources, under an id of its own, and reads the log.
import manifest from "./appmeta/manifest.json";
import { backElements } from "./back.js";
import { bitmap, draw } from "./bar.js";
import { toXpm } from "./canvas.js";
import { createFront, drawFront } from "./front.js";
import { STEPS, buildSeries } from "./rain.js";
import { describe } from "./show.js";

const APP = manifest.id;
const FRAMES = 10;
const front = createFront();
const start = Date.now();

/** Two days with a fair amount of rain in them: showers of every strength, and dry spells between. */
const rainy = { base: start, levels: new Uint8Array(STEPS), known: STEPS, radar: true };
for (let i = 0; i < STEPS; i++) {
  const wave = (i * 7) % 96;
  rainy.levels[i] = wave < 40 ? 75 + ((wave * 3 + i) % 70) : 0;
}

/** Two dry days with one shower at the very end: the headline has to look all the way to find it. */
const dry = { base: start, levels: new Uint8Array(STEPS), known: STEPS, radar: true };
dry.levels.fill(110, STEPS - 6);

/** Answers of the two sources as the parsers give them: 2 hours of radar, 49 hours of model. */
const NOWCAST = { minute: 15, levels: [] };
for (let i = 0; i < 24; i++) NOWCAST.levels.push(i % 7 < 3 ? 90 + i : 0);
const MODEL = { hours: { end: start, span: 3600000, levels: [] }, quarters: null };
for (let i = 0; i < 49; i++) MODEL.hours.levels.push(i % 5 < 2 ? 100 + i : 0);

/** What to show at frame `t`: `series` in a window of `hours`, an hour east of UTC. */
function show(series, version, hours, t, labelled) {
  // While it slides the window is named for the length it is sliding to, which the wheel chose: 48 here.
  const window = labelled ? 48 : Math.round(hours);
  return describe({ series, version, freshAt: start, now: start + t, zone: 60, hours, window, labelled, place: "Utrecht", frame: t });
}

function frontOf(what) {
  drawFront(front, what);
  return [bitmap("front", toXpm(front), 0, 0, "front")];
}

/** The kinds of frame the app draws, and how each is made. `unsent` ones time the app's own work alone. */
const SCREENS = [
  // At rest only the shimmer moves: the picture is copied, not painted.
  { name: "rest2h", frame: (t) => frontOf(show(rainy, 1, 2, t)) },
  { name: "rest48h", frame: (t) => frontOf(show(rainy, 1, 48, t)) },
  { name: "restdry", frame: (t) => frontOf(show(dry, 2, 48, t)) },
  // While the window slides every frame is a new picture, with the window's name on it.
  { name: "slide", frame: (t) => frontOf(show(rainy, 1, 2 * Math.pow(1.4, t), t, true)) },
  // The name stays on show for a moment after the slide.
  { name: "label", frame: (t) => frontOf(show(rainy, 1, 9, t, true)) },
  // New data or a settled turn of the wheel: both displays.
  { name: "both", frame: (t) => frontOf(show(rainy, 3, 5 + (t % 3), t)).concat(backElements(show(rainy, 3, 5 + (t % 3), t))) },
  { name: "restjs", unsent: true, frame: (t) => frontOf(show(rainy, 1, 2, t)) },
  { name: "slidejs", unsent: true, frame: (t) => frontOf(show(rainy, 1, 3 * Math.pow(1.4, t), t)) },
  // Joining fresh answers of the sources into a series: twice every 5 minutes.
  { name: "joinjs", unsent: true, frame: () => buildSeries(start, NOWCAST, MODEL) },
];

let total = 0;
function run(index) {
  if (index === SCREENS.length) {
    // The mean is of what a person sees: the frames that are sent.
    console.log("bench frame_ms " + (total / SCREENS.filter((screen) => !screen.unsent).length).toFixed(1));
    return;
  }
  const screen = SCREENS[index];
  const started = Date.now();
  const step = (t) => {
    if (t === FRAMES) {
      const frame = (Date.now() - started) / FRAMES;
      if (!screen.unsent) total += frame;
      console.log("bench " + screen.name + " " + frame.toFixed(1));
      setTimeout(() => run(index + 1), 0);
      return;
    }
    const elements = screen.frame(t);
    if (screen.unsent) setTimeout(() => step(t + 1), 0);
    else draw(APP, elements).then(() => step(t + 1));
  };
  step(0);
}

run(0);
