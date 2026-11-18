// Pictures for the bar's displays: a canvas of palette characters, a small font, and the XPM2 text the bar
// takes a bitmap as.

/** The colours of every drawing: one character per colour, as XPM2 wants them. A bitmap takes 32 at most. */
export const PALETTE = {
  ".": "#000000",
  // The front display: the night behind the timeline, its time axis and the hour ticks on it.
  n: "#101118",
  a: "#2B2F4A",
  t: "#8088C8",
  // Rain, from its shadow to its highlight.
  d: "#3B4290",
  r: "#6E7BEA",
  R: "#9AA6FF",
  // Text: white, light and dim.
  w: "#FFFFFF",
  l: "#C8CCE8",
  k: "#4A5080",
  // The mark for data that is getting old.
  e: "#C81E28",
  // Greys for the back display.
  K: "#8A8A9A",
  G: "#3C3C46",
};
const PALETTE_KEYS = Object.keys(PALETTE);
const XPM_COLORS = PALETTE_KEYS.map((key) => key + " c " + PALETTE[key]).join("\n");

/** A canvas of `w` by `h` pixels, black. `px` holds a palette character per pixel, row after row. */
export function createCanvas(w, h) {
  const px = new Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = ".";
  return { w, h, px };
}

/** Sets one pixel; outside the canvas it does nothing. */
export function set(cv, x, y, c) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  cv.px[(y | 0) * cv.w + (x | 0)] = c;
}

/** Fills a rectangle; the part outside the canvas is dropped. */
export function rect(cv, x, y, w, h, c) {
  const x0 = Math.max(0, x);
  const x1 = Math.min(cv.w, x + w);
  const y1 = Math.min(cv.h, y + h);
  for (let j = Math.max(0, y); j < y1; j++) {
    const row = j * cv.w;
    for (let i = x0; i < x1; i++) cv.px[row + i] = c;
  }
}

/** Draws rows of palette characters; spaces are transparent, and the part outside the canvas is dropped. */
export function sprite(cv, x, y, rows) {
  const first = Math.max(0, -x);
  for (let j = Math.max(0, -y); j < rows.length && y + j < cv.h; j++) {
    const row = rows[j];
    const at = (y + j) * cv.w + x;
    const end = Math.min(row.length, cv.w - x);
    for (let i = first; i < end; i++) {
      const c = row[i];
      if (c !== " ") cv.px[at + i] = c;
    }
  }
}

/** The first lines of an XPM2 bitmap of `w` by `h` pixels: its size and the palette. Its rows of pixels follow. */
export function xpmHeader(w, h) {
  return "! XPM2\n" + w + " " + h + " " + PALETTE_KEYS.length + " 1\n" + XPM_COLORS;
}

/**
 * The canvas as an XPM2 bitmap for an `xpmbitmap` display element. One join over the whole canvas and a
 * substring per row: the bar's runtime is slow at allocating, and this allocates the least.
 */
export function toXpm(cv) {
  const all = cv.px.join("");
  const rows = [xpmHeader(cv.w, cv.h)];
  for (let y = 0; y < cv.h; y++) rows.push(all.substring(y * cv.w, (y + 1) * cv.w));
  return rows.join("\n");
}

/** A font of capitals, digits and a few signs, 5 pixels high: each glyph as rows of # and . between bars. */
const GLYPHS = {
  0: "###|#.#|#.#|#.#|###",
  1: ".#.|##.|.#.|.#.|###",
  2: "###|..#|###|#..|###",
  3: "###|..#|.##|..#|###",
  4: "#.#|#.#|###|..#|..#",
  5: "###|#..|###|..#|###",
  6: "###|#..|###|#.#|###",
  7: "###|..#|..#|.#.|.#.",
  8: "###|#.#|###|#.#|###",
  9: "###|#.#|###|..#|###",
  A: ".#.|#.#|###|#.#|#.#",
  B: "##.|#.#|##.|#.#|##.",
  C: ".##|#..|#..|#..|.##",
  D: "##.|#.#|#.#|#.#|##.",
  E: "###|#..|##.|#..|###",
  F: "###|#..|##.|#..|#..",
  G: ".##|#..|#.#|#.#|.##",
  H: "#.#|#.#|###|#.#|#.#",
  I: "###|.#.|.#.|.#.|###",
  J: "..#|..#|..#|#.#|.#.",
  K: "#.#|#.#|##.|#.#|#.#",
  L: "#..|#..|#..|#..|###",
  M: "#...#|##.##|#.#.#|#...#|#...#",
  N: "#..#|##.#|#.##|#..#|#..#",
  O: ".#.|#.#|#.#|#.#|.#.",
  P: "##.|#.#|##.|#..|#..",
  Q: ".#.|#.#|#.#|##.|.##",
  R: "##.|#.#|##.|#.#|#.#",
  S: ".##|#..|.#.|..#|##.",
  T: "###|.#.|.#.|.#.|.#.",
  U: "#.#|#.#|#.#|#.#|###",
  V: "#.#|#.#|#.#|#.#|.#.",
  W: "#...#|#...#|#.#.#|##.##|#...#",
  X: "#.#|#.#|.#.|#.#|#.#",
  Y: "#.#|#.#|.#.|.#.|.#.",
  Z: "###|..#|.#.|#..|###",
  " ": "..|..|..|..|..",
  "!": "#|#|#|.|#",
  ".": ".|.|.|.|#",
  ":": ".|#|.|#|.",
  "-": "...|...|###|...|...",
  "?": "##.|..#|.#.|...|.#.",
  "/": "..#|..#|.#.|#..|#..",
};
const FONT = {};
for (const ch in GLYPHS) FONT[ch] = GLYPHS[ch].split("|");

/** A character the font does not have is drawn as a question mark. */
function glyph(ch) {
  return FONT[ch] || FONT["?"];
}

/** Width in pixels of `str`. */
export function textWidth(str) {
  let w = 0;
  for (let i = 0; i < str.length; i++) w += glyph(str[i])[0].length + 1;
  return Math.max(0, w - 1);
}

/** Draws `str` with its top-left at (x, y). */
export function text(cv, x, y, str, color) {
  let cx = x;
  for (let n = 0; n < str.length; n++) {
    const g = glyph(str[n]);
    for (let j = 0; j < 5; j++) for (let i = 0; i < g[j].length; i++) if (g[j][i] === "#") set(cv, cx + i, y + j, color);
    cx += g[0].length + 1;
  }
}

/** A repeatable pseudo-random number in [0, 1) for an integer seed. */
export function rnd(i) {
  return ((Math.imul(i + 1, 2654435761) >>> 0) % 9973) / 9973;
}
