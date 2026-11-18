// The front display, 72 by 16 pixels in colour: the rain timeline, or the headline in two lines, or a message
// while there is nothing to show.
import { createCanvas, rect, rnd, set, sprite, text, textWidth } from "./canvas.js";
import { FAINT, STEP_MS, reachOf, sampleColumns } from "./rain.js";
import { textsFor } from "./texts.js";

const W = 72;
const H = 16;
/** Rows a bar of rain can hang down from the axis. */
const ROWS = H - 1;

/**
 * For every rain level, how far its bar reaches and how dense its grain is: looked up while painting, since the
 * bar is slow at the divisions behind them. Density 0 is for levels too faint to draw.
 */
const REACH = new Uint8Array(256);
const DENSITY = new Uint8Array(256);
for (let level = 0; level < 256; level++) {
  REACH[level] = reachOf(level, ROWS);
  DENSITY[level] = REACH[level] ? Math.min(242, 70 + Math.floor(((level - FAINT) * 17) / 5)) : 0;
}

/**
 * The grain of the rain: a fixed number from 0 to 255 for every pixel a bar can cover. A pixel is lit when its
 * number is below the rain's density, so drizzle is a sparse sprinkle and a downpour nearly solid.
 */
const GRAIN = new Uint8Array(W * ROWS);
for (let i = 0; i < GRAIN.length; i++) GRAIN[i] = Math.floor(rnd(i * 7 + 3) * 256);

/** The display with nothing on it but the night and the axis along the top. Every picture starts as a copy. */
const EMPTY = [];
for (let i = 0; i < W * H; i++) EMPTY.push(i < W ? "a" : "n");

/**
 * The picture on show, painted once and copied into every frame after: a copy costs the bar far less than
 * painting it again. `picture.of` names what it shows; the rest is what the frames drawn over it need to know.
 */
const picture = {
  of: "",
  px: EMPTY,
  /** The rain in each column of the timeline, and how far each bar reaches: the shimmer plays inside them. */
  columns: new Uint8Array(W),
  reach: new Uint8Array(W),
  /** Whether the timeline has any rain, and whether the forecast reaches the end of its window. */
  anyRain: false,
  complete: true,
};

/**
 * Starts a frame on `cv` from the picture named `name`, which `paint(cv)` makes from an empty display when it
 * is not the one on show.
 */
function startFrom(cv, name, paint) {
  if (name !== picture.of) {
    cv.px = EMPTY.slice();
    paint(cv);
    picture.px = cv.px;
    picture.of = name;
  }
  cv.px = picture.px.slice();
}

/** A canvas the size of the front display. */
export function createFront() {
  return createCanvas(W, H);
}

/** The hour marks on the axis: every hour up to a 5-hour window, every 3 up to 18, then every 6. */
function tickEvery(hours) {
  return hours <= 5 ? 60 : hours <= 18 ? 180 : 360;
}

/** The window's name as last painted: its text, its width, and where its lit pixels are, worked out once. */
const label = { text: "", width: 0, lit: [] };

/** The rows a bar may reach where the window's name stands under it, in the bottom-right corner. */
const ABOVE_LABEL = 7;

/**
 * Makes `str` the window's name and returns the column its corner starts at. The name is painted on every
 * frame of the slide, so its letters' pixels are found once for each name, and the rain is kept out of its
 * corner instead of being painted and then covered.
 */
function labelFrom(str) {
  if (str !== label.text) {
    const scratch = createCanvas(textWidth(str), 5);
    text(scratch, 0, 0, str, "w");
    label.text = str;
    label.width = scratch.w;
    label.lit = [];
    for (let i = 0; i < scratch.px.length; i++) {
      if (scratch.px[i] === "w") label.lit.push(Math.floor(i / scratch.w) * W + (i % scratch.w));
    }
  }
  return W - label.width - 4;
}

function paintLabel(cv, corner) {
  const origin = 10 * W + corner + 2;
  for (let i = 0; i < label.lit.length; i++) cv.px[origin + label.lit[i]] = "w";
}

function paintTimeline(cv, show, texts) {
  const hours = show.hours;
  const series = show.series;
  // A tick at every hour mark in the window; midnight stands out.
  const dayMinutes = ((show.now + show.zone * 60000) / 60000) % 1440;
  const span = (hours * 60) / W;
  const every = tickEvery(hours);
  for (let mark = Math.ceil(dayMinutes / every) * every; mark - dayMinutes < hours * 60; mark += every) {
    set(cv, Math.floor((mark - dayMinutes) / span), 0, mark % 1440 === 0 ? "w" : "t");
  }
  // The axis ends where the forecast does: what lies past it is not known, which is not the same as dry.
  const knownFor = (series.base + series.known * STEP_MS - show.now) / 60000;
  const knownColumns = Math.max(0, Math.min(W, Math.floor(knownFor / span)));
  picture.complete = knownColumns === W;
  rect(cv, knownColumns, 0, W - knownColumns, 1, "n");

  sampleColumns(series, show.now, hours, picture.columns);
  picture.anyRain = false;
  const corner = show.labelled ? labelFrom(texts.window(show.window)) : W;
  const px = cv.px;
  for (let c = 0; c < W; c++) {
    const level = picture.columns[c];
    let rows = c < knownColumns ? REACH[level] : 0;
    if (c >= corner && rows > ABOVE_LABEL) rows = ABOVE_LABEL;
    picture.reach[c] = rows;
    if (!rows) continue;
    picture.anyRain = true;
    const density = DENSITY[level];
    for (let r = 0; r < rows; r++) {
      const grain = GRAIN[c * ROWS + r];
      if (grain >= density) continue;
      // Bright specks in the body of the rain, a darker fringe where it ends.
      px[(1 + r) * W + c] = grain * 5 < density ? "R" : r >= rows - 2 && grain * 5 > density * 3 ? "d" : "r";
    }
  }
  set(cv, 0, 0, "w");

  if (show.labelled) paintLabel(cv, corner);
  else if (!picture.anyRain && picture.complete) centred(cv, 6, texts.dryWindow(show.window), "k");
}

function centred(cv, y, str, color) {
  text(cv, (W - textWidth(str)) >> 1, y, str, color);
}

/** Rain hangs down from the time axis, from now at the left to `show.hours` later at the right. */
function drawTimeline(cv, show, texts) {
  // The picture stays as it is until now has moved on by a column, the data changed, the window did or its
  // name came or went.
  const column = Math.floor(show.now / ((show.hours * 3600000) / W));
  const name = "timeline" + show.version + "|" + show.hours.toFixed(2) + "|" + column + "|" + show.labelled + "|" + show.language;
  startFrom(cv, name, (bg) => paintTimeline(bg, show, texts));

  // The rain shimmers: a few pixels in the bars go out or light up on every frame.
  for (let k = 0; k < 5; k++) {
    const c = Math.floor(rnd(show.frame * 5 + k) * W);
    if (!picture.reach[c]) continue;
    const at = (1 + Math.floor(rnd(show.frame * 11 + k * 3) * picture.reach[c])) * W + c;
    cv.px[at] = cv.px[at] === "n" ? "r" : "n";
  }
}

const DROP = ["  #  ", "  #  ", " ### ", "#####", "#####", " ### "];
const DROP_RAIN = DROP.map((row) => row.replace(/#/g, "r"));
const DROP_DRY = DROP.map((row) => row.replace(/#/g, "k"));

/** The headline as two short lines beside a drop: blue when it rains or soon will, dim when it stays dry. */
function drawWords(cv, words) {
  const rainy = words.wet || words.startsIn >= 0;
  startFrom(cv, "words" + words.top + "|" + words.bottom + rainy, (bg) => {
    rect(bg, 0, 0, W, 1, "n");
    sprite(bg, 4, 5, rainy ? DROP_RAIN : DROP_DRY);
    if (rainy) set(bg, 5, 8, "R");
    text(bg, 14, 2, words.top, rainy ? "R" : "l");
    text(bg, 14, 9, words.bottom, "w");
  });
}

/** A word or two under the axis: loading, or what is in the way. */
function drawMessage(cv, message) {
  startFrom(cv, "message" + message, (bg) => centred(bg, 6, message, "k"));
}

/**
 * Paints the front display for `show`, a description from show.js: a message while there is no series, the
 * headline when the app is `inWords`, the timeline otherwise. Old data gets a red mark in the corner.
 */
export function drawFront(cv, show) {
  const texts = textsFor(show.language);
  if (!show.series) {
    drawMessage(cv, show.problem ? texts.problem[show.problem] : texts.loading);
    return;
  }
  if (show.inWords) drawWords(cv, show.words);
  else drawTimeline(cv, show, texts);
  if (show.stale) set(cv, W - 1, H - 1, "e");
}
