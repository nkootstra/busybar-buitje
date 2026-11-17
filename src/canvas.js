/** The colours of every drawing: one character per colour, as the XPM2 bitmap sent to the bar wants them. */
export const PALETTE = {
  ".": "#000000",
  // The front display: the night behind the chart, its time axis and the hour ticks on it.
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
export const PALETTE_KEYS = Object.keys(PALETTE);
export const XPM_COLORS = PALETTE_KEYS.map((k) => k + " c " + PALETTE[k]).join("\n");
export function createCanvas(w, h) {
  const px = new Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = ".";
  return {
    w,
    h,
    px
  };
}
export function fill(cv, c) {
  const px = cv.px;
  for (let i = 0; i < px.length; i++) px[i] = c;
}
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
export function disc(cv, cx, cy, r, c) {
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r * 0.6) set(cv, cx + i, cy + j, c);
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
/** Copies a horizontal slice [x0, x1) of `src` onto `dst`, shifted by dx. Pixels pushed off the edge are dropped. */
export function blitSlice(dst, src, x0, x1, dx) {
  const w = src.w;
  const from = Math.max(x0, -dx);
  const to = Math.min(x1, w - dx);
  for (let y = 0; y < src.h; y++) {
    const row = y * w;
    for (let x = from; x < to; x++) dst.px[row + x + dx] = src.px[row + x];
  }
}
/** The first lines of an XPM2 bitmap of `w` by `h` pixels: its size and the palette. */
export function xpmHeader(w, h) {
  return "! XPM2\n" + w + " " + h + " " + PALETTE_KEYS.length + " 1\n" + XPM_COLORS;
}

/**
 * Appends the canvas to `rows`, a string per row. One join over the whole canvas and a substring per row: the
 * bar's runtime is slow at allocating, and this allocates the least.
 */
export function xpmRows(cv, rows) {
  const all = cv.px.join("");
  for (let y = 0; y < cv.h; y++) rows.push(all.substring(y * cv.w, (y + 1) * cv.w));
  return rows;
}

/** The canvas as an XPM2 bitmap for an `xpmbitmap` display element. */
export function toXpm(cv) {
  return xpmRows(cv, [xpmHeader(cv.w, cv.h)]).join("\n");
}
let layer = null;
let layerKey = "";
/**
 * Starts a frame on `cv` from a backdrop that is painted once. `paint(bg)` runs only when `key` differs from the
 * last call's; every call after that copies the stored backdrop, which costs the bar far less than repainting it.
 * One backdrop is kept at a time: it is whatever the front display shows now.
 */
export function backdrop(cv, key, paint) {
  if (key !== layerKey) {
    if (!layer) layer = createCanvas(cv.w, cv.h);
    paint(layer);
    layerKey = key;
  }
  cv.px = layer.px.slice();
}
export const GLYPHS = {
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
  "/": "..#|..#|.#.|#..|#.."
};
export const FONT = {};
for (const ch in GLYPHS) FONT[ch] = GLYPHS[ch].split("|");
/** Width in pixels of `str` at `scale`. */
export function textWidth(str, scale = 1) {
  let w = 0;
  for (let i = 0; i < str.length; i++) {
    const g = FONT[str[i]] || FONT["?"];
    w += (g[0].length + 1) * scale;
  }
  return Math.max(0, w - scale);
}
/** Draws `str` with its top-left at (x, y). `color` may be a function of the letter index. */
export function text(cv, x, y, str, color, scale = 1) {
  let cx = x;
  for (let n = 0; n < str.length; n++) {
    const g = FONT[str[n]] || FONT["?"];
    const c = typeof color === "function" ? color(n) : color;
    for (let j = 0; j < 5; j++) for (let i = 0; i < g[j].length; i++) if (g[j][i] === "#") rect(cv, cx + i * scale, y + j * scale, scale, scale, c);
    cx += (g[0].length + 1) * scale;
  }
  return cx;
}
/** `str` as a sprite in one colour, or in the colour `color(n)` gives for letter n: for text drawn on every frame. */
export function textSprite(str, color) {
  const rows = ["", "", "", "", ""];
  for (let n = 0; n < str.length; n++) {
    const g = FONT[str[n]] || FONT["?"];
    const c = typeof color === "function" ? color(n) : color;
    for (let j = 0; j < 5; j++) rows[j] += (n ? " " : "") + g[j].replace(/#/g, c).replace(/\./g, " ");
  }
  return rows;
}
/**
 * A sine wave in whole numbers: SINE[i] is the sine of i/64 of a turn, times 16. The bar's runtime allocates
 * memory for every fraction it computes, so animations that run on every frame count in whole numbers.
 */
export const SINE = [];
for (let i = 0; i < 64; i++) SINE.push(Math.round(Math.sin((i * Math.PI) / 32) * 16));
/** A repeatable pseudo-random number in [0, 1) for an integer seed. */
export function rnd(i) {
  return (Math.imul(i + 1, 2654435761) >>> 0) % 9973 / 9973;
}
