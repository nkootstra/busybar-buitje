// Writes previews/screens.png: the timeline at several windows, the headline and the back display's strip,
// from the fixtures in tests/fixtures, enlarged, to look at while drawing.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE, createCanvas } from "../src/canvas.js";
import { headline } from "../src/headline.js";
import { buildSeries, parseModel, parseNowcast, sampleColumns } from "../src/rain.js";
import { drawChart, drawHeadline, mapXpm } from "../src/screens.js";
import { encodePng } from "./png.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => readFileSync(resolve(root, "tests/fixtures", name), "utf8");
const now = Number(fixture("taken-at.txt")) * 1000;
const offset = 60;
const series = buildSeries(now, offset, parseNowcast(fixture("raintext-amsterdam.txt")), parseModel(JSON.parse(fixture("model-amsterdam.json"))));

const SCALE = 5;
const GAP = 6;
const WINDOWS = [1, 2, 5, 12, 24, 48];
const rows = WINDOWS.length + 2;
const width = 144 * SCALE + 2 * GAP;
const height = rows * (16 * SCALE + GAP) + GAP;
const image = new Uint8Array(width * height * 4);
for (let i = 0; i < image.length; i += 4) image.set([40, 40, 44, 255], i);

const rgb = {};
for (const key in PALETTE) rgb[key] = [1, 3, 5].map((at) => parseInt(PALETTE[key].slice(at, at + 2), 16));

/** Paints rows of palette characters into the sheet. */
function place(pixels, w, h, row) {
  const top = GAP + row * (16 * SCALE + GAP);
  for (let y = 0; y < h * SCALE; y++) {
    for (let x = 0; x < w * SCALE; x++) {
      const c = rgb[pixels[Math.floor(y / SCALE) * w + Math.floor(x / SCALE)]];
      image.set([c[0], c[1], c[2], 255], ((top + y) * width + GAP + x) * 4);
    }
  }
}

const cv = createCanvas(72, 16);
const columns = new Uint8Array(72);
WINDOWS.forEach((hours, row) => {
  sampleColumns(series, now, hours, columns);
  const minutes = ((now + offset * 60000) / 60000) % 1440;
  drawChart(cv, "preview" + hours, columns, hours, minutes, 3, { label: row === 2 ? "NEXT " + hours + "H" : "", dry: "", stale: false });
  place(cv.px, 72, 16, row);
});

const words = headline(series, now, offset, "en");
drawHeadline(cv, words.top, words.bottom, words.wet || words.startsIn >= 0);
place(cv.px, 72, 16, WINDOWS.length);

const map = mapXpm(series, now, 5).split("\n");
const strip = map.slice(map.length - 14).join("").split("");
place(strip, 144, 14, WINDOWS.length + 1);

mkdirSync(resolve(root, "previews"), { recursive: true });
writeFileSync(resolve(root, "previews/screens.png"), encodePng(width, height, image));
console.log(words.full + " | wrote previews/screens.png");
