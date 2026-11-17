// The app the benchmark runs on the bar: it paints and sends frames the way Buitje does, with rain made up here
// instead of fetched, and logs how long a frame takes. tools/bench.mjs builds it next to the real sources and
// reads the log.
import { backText, bitmap, draw } from "./bar.js";
import { createCanvas, toXpm } from "./canvas.js";
import { headline } from "./headline.js";
import { STEPS, sampleColumns } from "./rain.js";
import { drawChart, mapXpm } from "./screens.js";

const APP = "io.kootstra.buitje.bench";
const FRAMES = 10;
const front = createCanvas(72, 16);
const columns = new Uint8Array(72);

/** Two days with a fair amount of rain in them: showers of every strength, and dry spells between. */
const series = { base: Date.now(), levels: new Uint8Array(STEPS), radar: true };
for (let i = 0; i < STEPS; i++) {
  const wave = (i * 7) % 96;
  series.levels[i] = wave < 40 ? 75 + ((wave * 3 + i) % 70) : 0;
}

/** One frame of the timeline, as the app paints it: `key` says whether the picture is new. */
function chart(hours, key, t) {
  const now = series.base;
  if (key !== chart.sampled) {
    chart.sampled = key;
    sampleColumns(series, now, hours, columns);
  }
  drawChart(front, key, columns, hours, 1274, t, { label: "", dry: "", stale: false });
  return [bitmap("front", toXpm(front), 0, 0, "front")];
}

/** What the app sends when the data or the window changes: the front, and the whole back display. */
function everything(t) {
  const words = headline(series, series.base, 60, "en");
  return chart(5, "all" + t, t).concat([
    backText("head1", words.full, 4, 4, "#FFFFFFFF"),
    backText("head2", "Utrecht", 4, 15, "#808080FF"),
    bitmap("map", mapXpm(series, series.base, 5 + (t % 3), "bench"), 4, 29, "back"),
    backText("window", "Next 5 hours on the front", 4, 57, "#C8C8C8FF"),
  ]);
}

/** The kinds of frame the app draws, and how each is made. */
const SCREENS = [
  // At rest only the shimmer moves: the picture is copied, not painted.
  { name: "rest2h", frame: (t) => chart(2, "rest2", t) },
  { name: "rest48h", frame: (t) => chart(48, "rest48", t) },
  // While the window slides every frame is a new picture.
  { name: "slide", frame: (t) => chart(2 * Math.pow(1.4, t), "slide" + t, t) },
  // New data or a turn of the wheel: both displays.
  { name: "both", frame: (t) => everything(t) },
];

let total = 0;
function run(index) {
  if (index === SCREENS.length) {
    console.log("bench frame_ms " + (total / SCREENS.length).toFixed(1));
    return;
  }
  const screen = SCREENS[index];
  const started = Date.now();
  const step = (t) => {
    if (t === FRAMES) {
      const frame = (Date.now() - started) / FRAMES;
      total += frame;
      console.log("bench " + screen.name + " " + frame.toFixed(1));
      setTimeout(() => run(index + 1), 0);
      return;
    }
    draw(APP, screen.frame(t)).then(() => step(t + 1));
  };
  step(0);
}

run(0);
