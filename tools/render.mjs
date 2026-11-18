// Writes previews/screens.png: the front display at several windows and in words, and the back display's strip,
// drawn by the app's own functions for the evening the tests share, enlarged, to look at while drawing.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backElements } from "../src/back.js";
import { PALETTE } from "../src/canvas.js";
import { createFront, drawFront } from "../src/front.js";
import { buildSeries } from "../src/rain.js";
import { describe } from "../src/show.js";
import { parseForecast } from "../src/sources.js";
import { AT as now, EVENING } from "../tests/forecast.mjs";
import { encodePng } from "./png.mjs";
import { xpmRows } from "./sim.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const series = buildSeries(now, parseForecast(EVENING));

/** What to show: that evening's rain at 21:14, an hour east of UTC. */
const show = (fields) => describe({ series, version: 1, freshAt: now, now, zone: 60, place: "Utrecht", frame: 3, ...fields });

const SCALE = 5;
const GAP = 6;
const WIDE = 144;
const WINDOWS = [1, 2, 5, 12, 24, 48];
const width = WIDE * SCALE + 2 * GAP;
const height = (WINDOWS.length + 2) * (16 * SCALE + GAP) + GAP;
const image = new Uint8Array(width * height * 4);
for (let i = 0; i < image.length; i += 4) image.set([40, 40, 44, 255], i);

const rgb = {};
for (const key in PALETTE) rgb[key] = [1, 3, 5].map((at) => parseInt(PALETTE[key].slice(at, at + 2), 16));

/** Paints rows of palette characters into row `row` of the sheet. */
function place(rows, row) {
  const top = GAP + row * (16 * SCALE + GAP);
  for (let y = 0; y < rows.length * SCALE; y++) {
    for (let x = 0; x < rows[0].length * SCALE; x++) {
      const c = rgb[rows[Math.floor(y / SCALE)][Math.floor(x / SCALE)]];
      image.set([c[0], c[1], c[2], 255], ((top + y) * width + GAP + x) * 4);
    }
  }
}

/** A canvas as rows of palette characters. */
const rowsOf = (cv) => Array.from({ length: cv.h }, (_, y) => cv.px.slice(y * cv.w, (y + 1) * cv.w));

const front = createFront();
WINDOWS.forEach((hours, row) => {
  drawFront(front, show({ hours, window: hours, version: row, labelled: hours === 5 }));
  place(rowsOf(front), row);
});
drawFront(front, show({ inWords: true }));
place(rowsOf(front), WINDOWS.length);

// The strip is the back display's one bitmap.
const strip = backElements(show({ window: 5 })).find((element) => element.type === "xpmbitmap");
place(xpmRows(strip.data), WINDOWS.length + 1);

mkdirSync(resolve(root, "previews"), { recursive: true });
writeFileSync(resolve(root, "previews/screens.png"), encodePng(width, height, image));
console.log("wrote previews/screens.png");
