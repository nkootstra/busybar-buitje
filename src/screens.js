// What the two displays show: the rain timeline, the headline and messages on the front, the overview on the back.
import { backdrop, fill, rect, rnd, set, sprite, text, textWidth, xpmHeader } from "./canvas.js";
import { HEAVY, WET, sampleColumns } from "./rain.js";

const W = 72;
const H = 16;
/** Rows a bar of rain can hang down from the axis. */
const ROWS = H - 1;
/** Fainter than rain you would notice, but still drawn: the edge of a shower. */
const FAINT = WET - 7;

/**
 * The grain of the rain: a fixed number from 0 to 255 for every pixel a bar can cover. A pixel is lit when its
 * number is below the rain's density, so drizzle is a sparse sprinkle and a downpour nearly solid.
 */
const GRAIN = new Uint8Array(W * ROWS);
for (let i = 0; i < GRAIN.length; i++) GRAIN[i] = Math.floor(rnd(i * 7 + 3) * 256);

/** How far down the bar of each column reaches, as last painted: the shimmer plays inside them. */
const reach = new Uint8Array(W);

/** How many rows rain of this level hangs down: 1 for the faintest, all 15 from 10 mm an hour. */
function rowsFor(level, rows) {
  if (level < FAINT) return 0;
  return Math.max(1, Math.min(rows, Math.floor(((level - FAINT + 4) * rows) / 75)));
}

/**
 * For every rain level, how far its bar reaches on the front and how dense its grain is: looked up while
 * painting, since the bar is slow at the divisions behind them.
 */
const REACH = new Uint8Array(256);
const DENSITY = new Uint8Array(256);
for (let level = 0; level < 256; level++) {
  REACH[level] = rowsFor(level, ROWS);
  DENSITY[level] = level < FAINT ? 0 : Math.min(242, 70 + Math.floor(((level - FAINT) * 17) / 5));
}

/** The hour marks on the axis: every hour up to a 5-hour window, every 3 up to 18, then every 6. */
function tickEvery(hours) {
  return hours <= 5 ? 60 : hours <= 18 ? 180 : 360;
}

/** The timeline with nothing on it: the night, and the axis along the top. Every picture starts as a copy. */
const EMPTY = [];
for (let i = 0; i < W * H; i++) EMPTY.push(i < W ? "a" : "n");

function paintChart(cv, columns, hours, nowMinutes) {
  cv.px = EMPTY.slice();
  // A tick at every hour mark in the window; midnight stands out.
  const span = (hours * 60) / W;
  const every = tickEvery(hours);
  for (let mark = Math.ceil(nowMinutes / every) * every; mark - nowMinutes < hours * 60; mark += every) {
    set(cv, Math.floor((mark - nowMinutes) / span), 0, mark % 1440 === 0 ? "w" : "t");
  }

  for (let c = 0; c < W; c++) {
    const level = columns[c];
    const rows = REACH[level];
    reach[c] = rows;
    if (!rows) continue;
    const density = DENSITY[level];
    const px = cv.px;
    for (let r = 0; r < rows; r++) {
      const grain = GRAIN[c * ROWS + r];
      if (grain >= density) continue;
      // Bright specks in the body of the rain, a darker fringe where it ends.
      px[(1 + r) * W + c] = grain * 5 < density ? "R" : r >= rows - 2 && grain * 5 > density * 3 ? "d" : "r";
    }
  }
  set(cv, 0, 0, "w");
}

/** Text in the middle of the display. */
function centred(cv, y, str, color) {
  text(cv, (W - textWidth(str)) >> 1, y, str, color);
}

/**
 * The timeline: rain hangs down from the time axis, from now at the left to `hours` later at the right.
 *
 * @param {object} cv - the front canvas.
 * @param {string} key - changes when the picture must be painted anew: other data, another window, a later now.
 * @param {Uint8Array} columns - the rain level of each of the 72 columns.
 * @param {number} hours - the length of the window.
 * @param {number} nowMinutes - now as minutes of the local day, for the hour marks.
 * @param {number} t - the frame, for the shimmer.
 * @param {{ label: string, dry: string, stale: boolean }} notes - `label` names the window just after the wheel
 *   moved, `dry` is what to say when the window has no rain, `stale` marks data that is getting old.
 */
export function drawChart(cv, key, columns, hours, nowMinutes, t, notes) {
  backdrop(cv, "chart" + key, (bg) => paintChart(bg, columns, hours, nowMinutes));

  // The rain shimmers: a few pixels in the bars go out or light up on every frame.
  for (let k = 0; k < 5; k++) {
    const c = Math.floor(rnd(t * 5 + k) * W);
    if (!reach[c]) continue;
    const at = (1 + Math.floor(rnd(t * 11 + k * 3) * reach[c])) * W + c;
    cv.px[at] = cv.px[at] === "n" ? "r" : "n";
  }

  if (notes.label) {
    const width = textWidth(notes.label);
    rect(cv, W - width - 4, 8, width + 4, 8, ".");
    text(cv, W - width - 2, 10, notes.label, "w");
  } else if (notes.dry) {
    centred(cv, 6, notes.dry, "k");
  }
  if (notes.stale) set(cv, W - 1, H - 1, "e");
}

const DROP = ["  #  ", "  #  ", " ### ", "#####", "#####", " ### "];

/** The headline as two short lines beside a drop: blue when it is or will soon be wet, dim when dry. */
export function drawHeadline(cv, top, bottom, wet) {
  backdrop(cv, "headline" + top + "|" + bottom + wet, (bg) => {
    fill(bg, "n");
    sprite(
      bg,
      4,
      5,
      DROP.map((row) => row.replace(/#/g, wet ? "r" : "k")),
    );
    if (wet) set(bg, 5, 8, "R");
    text(bg, 14, 2, top, wet ? "R" : "l");
    text(bg, 14, 9, bottom, "w");
  });
}

/** A word or two in the middle of the display: loading, or no data. */
export function drawMessage(cv, message) {
  backdrop(cv, "message" + message, (bg) => {
    fill(bg, "n");
    rect(bg, 0, 0, W, 1, "a");
    centred(bg, 6, message, "k");
  });
}

// ------------------------------------------------------------------------------------- the back display's map

export const MAP_W = 144;
const MAP_H = 14;
const MAP_ROWS = MAP_H - 2;
const mapColumns = new Uint8Array(MAP_W);

/** The strip's rows of rain as text, once with the lit ground inside the frame and once with the dark outside. */
let mapFor = "";
let mapInside = [];
let mapOutside = [];
const MAP_EDGE = new Array(MAP_W + 1).join("w");
const MAP_DARK = new Array(MAP_W + 1).join(".");

function paintMap(series, now) {
  sampleColumns(series, now, 48, mapColumns);
  mapInside = [];
  mapOutside = [];
  for (let y = 0; y < MAP_ROWS; y++) {
    const inside = [];
    const outside = [];
    for (let x = 0; x < MAP_W; x++) {
      const rain = y < rowsFor(mapColumns[x], MAP_ROWS) ? (mapColumns[x] >= HEAVY ? "l" : "K") : "";
      inside.push(rain || "G");
      outside.push(rain || ".");
    }
    mapInside.push(inside.join(""));
    mapOutside.push(outside.join(""));
  }
}

/**
 * The 48 hours ahead as a strip for the back display, an XPM2 bitmap: rain hangs down as on the front, and a
 * frame marks the `hours` the front shows. The rain is worked out once for each `key` (new data, or a later
 * now); another window only moves the frame, which is a matter of cutting those rows of text.
 */
export function mapXpm(series, now, hours, key) {
  if (key !== mapFor) {
    mapFor = key;
    paintMap(series, now);
  }
  const frame = Math.max(3, Math.round((MAP_W * hours) / 48));
  const edge = MAP_EDGE.slice(0, frame) + MAP_DARK.slice(frame);
  const rows = [xpmHeader(MAP_W, MAP_H), edge];
  for (let y = 0; y < MAP_ROWS; y++) rows.push("w" + mapInside[y].slice(1, frame - 1) + "w" + mapOutside[y].slice(frame));
  rows.push(edge);
  return rows.join("\n");
}
