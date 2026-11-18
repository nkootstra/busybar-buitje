// The back display, 160 by 80 pixels in grey: the headline as a sentence, the place, the hours ahead as a
// strip with a frame around what the front shows, and where the data comes from.
import { backText, bitmap } from "./bar.js";
import { xpmHeader } from "./canvas.js";
import { HEAVY, HOURS, STEP_MS, reachOf, sampleColumns } from "./rain.js";
import { CREDIT } from "./sources.js";
import { clock, textsFor } from "./texts.js";

/** The layout: the left edge, and the row each line starts at. The firmware's status bar has the right 12 pixels. */
const LEFT = 4;
const ROW = { head: 4, second: 15, strip: 29, days: 45, window: 57, credit: 69 };
const WHITE = "#FFFFFFFF";
const LIGHT = "#C8C8C8FF";
const GREY = "#808080FF";
/** How many characters of the `small` font fit on a line. */
const LINE = 34;

/** The strip: 144 pixels for all the hours ahead, 20 minutes a pixel, and 12 rows of rain inside its frame. */
const STRIP_W = 144;
const STRIP_ROWS = 12;
const STRIP_H = STRIP_ROWS + 2;
const QUARTER_MS = 15 * 60000;

/** The strip's rows of rain as text, once with the lit ground inside the frame and once with the dark outside. */
const stripColumns = new Uint8Array(STRIP_W);
let stripFor = "";
let inside = [];
let outside = [];
const EDGE = new Array(STRIP_W + 1).join("w");
const DARK = new Array(STRIP_W + 1).join(".");

/** For every rain level, how far its bar reaches in the strip: looked up, since this is asked for every pixel. */
const STRIP_REACH = new Uint8Array(256);
for (let level = 0; level < 256; level++) STRIP_REACH[level] = reachOf(level, STRIP_ROWS);

function paintStrip(series, now) {
  sampleColumns(series, now, HOURS, stripColumns);
  // Past what the forecast knows the strip is left dark, also inside the frame.
  const known = Math.floor(((series.base + series.known * STEP_MS - now) / (HOURS * 3600000)) * STRIP_W);
  inside = [];
  outside = [];
  // Rain hangs from the top, so a row is the row above it with some bars ended. The top row is made column by
  // column, noting for each bar the row it ends at; every row after only puts ground where bars end.
  const row = new Array(STRIP_W);
  const endsAt = [];
  for (let y = 0; y <= STRIP_ROWS; y++) endsAt.push([]);
  for (let x = 0; x < STRIP_W; x++) {
    const level = stripColumns[x];
    const reach = x < known ? STRIP_REACH[level] : 0;
    row[x] = x >= known ? "." : reach ? (level >= HEAVY ? "l" : "K") : "G";
    if (reach) endsAt[reach].push(x);
  }
  for (let y = 0; y < STRIP_ROWS; y++) {
    for (let i = 0; i < endsAt[y].length; i++) row[endsAt[y][i]] = "G";
    const lit = row.join("");
    inside.push(lit);
    // Outside the frame the ground is dark: the same row without its lit ground.
    outside.push(lit.replace(/G/g, "."));
  }
}

/**
 * The hours ahead as an XPM2 bitmap: rain hangs down as on the front, and a frame marks the window the front
 * shows. The rain is worked out once for each series and quarter of an hour; another window only moves the
 * frame, which is a matter of cutting those rows of text.
 */
function stripXpm(show) {
  const key = show.version + "|" + Math.floor(show.now / QUARTER_MS);
  if (key !== stripFor) {
    stripFor = key;
    paintStrip(show.series, show.now);
  }
  const frame = Math.max(3, Math.round((STRIP_W * show.window) / HOURS));
  const edge = EDGE.slice(0, frame) + DARK.slice(frame);
  const rows = [xpmHeader(STRIP_W, STRIP_H), edge];
  for (let y = 0; y < STRIP_ROWS; y++) rows.push("w" + inside[y].slice(1, frame - 1) + "w" + outside[y].slice(frame));
  rows.push(edge);
  return rows.join("\n");
}

/** The strip with nothing on it, for when there is no data. */
function emptyStripXpm() {
  const rows = [xpmHeader(STRIP_W, STRIP_H)];
  for (let y = 0; y < STRIP_H; y++) rows.push(DARK);
  return rows.join("\n");
}

/** A sentence over at most two lines. */
function wrap(sentence) {
  if (sentence.length <= LINE) return [sentence, ""];
  const cut = sentence.lastIndexOf(" ", LINE);
  return [sentence.slice(0, cut), sentence.slice(cut + 1)];
}

/**
 * A line of text, cut to what fits. An empty one is sent as a space: the bar keeps an element until another
 * with its id comes, so a line that has nothing to say any more still has to be sent, to wipe what stood there.
 */
function line(id, value, row, color, x) {
  return backText(id, value ? value.slice(0, LINE) : " ", x || LEFT, row, color);
}

/**
 * What the back display shows changes with this: the data, the window the wheel chose, the headline, the
 * quarter of an hour, and what is in the way of fresh data. Compare it before asking for the elements, which
 * cost the bar a tenth of a second.
 */
export function backKey(show) {
  if (!show.series) return "none|" + show.problem + "|" + show.language;
  const trouble = show.stale ? show.problem : null;
  return [show.version, show.window, show.words.full, Math.floor(show.now / QUARTER_MS), trouble].join("|");
}

/** The back display's elements for `show`, a description from show.js. The same ids are sent whatever it shows. */
export function backElements(show) {
  const texts = textsFor(show.language);
  if (!show.series) {
    return [
      line("head1", show.place, ROW.head, WHITE),
      line("head2", show.problem ? texts.problemLine[show.problem] : texts.waiting, ROW.second, LIGHT),
      bitmap("map", emptyStripXpm(), LEFT, ROW.strip, "back"),
      line("now", "", ROW.days, GREY),
      line("day", "", ROW.days, GREY),
      line("window", "", ROW.window, LIGHT),
      line("source", "", ROW.credit, GREY),
    ];
  }
  const sentence = wrap(show.words.full);
  // Where the strip crosses midnight the next day is named, and "now" makes way when that is close by.
  const toMidnight = 1440 - (Math.floor((show.now + show.zone * 60000) / 60000) % 1440);
  const midnight = LEFT + Math.round((STRIP_W * toMidnight) / (HOURS * 60));
  // Old data with nothing fresh coming: say what is wrong and when it is from, where the window's name stood.
  const trouble = show.stale && show.problem ? texts.dataFrom[show.problem](clock(show.freshAt, show.zone)) : "";
  return [
    line("head1", sentence[0], ROW.head, WHITE),
    line("head2", sentence[1] || show.place, ROW.second, sentence[1] ? WHITE : GREY),
    bitmap("map", stripXpm(show), LEFT, ROW.strip, "back"),
    line("now", midnight > LEFT + 24 ? texts.now : "", ROW.days, GREY),
    line("day", texts.tomorrow, ROW.days, GREY, midnight),
    line("window", trouble || texts.windowOnFront(show.window), ROW.window, LIGHT),
    line("source", show.series.radar ? CREDIT.radar : CREDIT.model, ROW.credit, GREY),
  ];
}
