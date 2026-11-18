// Writes the app's two icons into src/appmeta: 8x8 in colour for the front display, 11x11 in grey for the back.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE } from "../src/canvas.js";
import { encodePng } from "./png.mjs";

const appmeta = resolve(dirname(fileURLToPath(import.meta.url)), "../src/appmeta");

/** A raindrop in the rain's own colours, lit from the left. Spaces are transparent. */
const FRONT = [
  "   rr   ",
  "   rr   ",
  "  rRrr  ",
  "  rRrr  ",
  " rRrrrr ",
  " rRrrrd ",
  " rrrrdd ",
  "  rrdd  ",
];
const BACK = [
  "     w     ",
  "     w     ",
  "    www    ",
  "    www    ",
  "   wwwww   ",
  "   wwwww   ",
  "  wwwwwww  ",
  "  wwwwwww  ",
  "  wwwwwww  ",
  "   wwwww   ",
  "    www    ",
];

function write(name, rows) {
  const size = rows.length;
  const rgba = new Uint8Array(size * size * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < size; x++) {
      if (row[x] === " ") continue;
      const hex = PALETTE[row[x]];
      rgba.set([1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).concat(255), (y * size + x) * 4);
    }
  });
  writeFileSync(resolve(appmeta, name), encodePng(size, size, rgba));
  console.log("wrote src/appmeta/" + name);
}

write("icon_front_8x8.png", FRONT);
write("icon_back_11x11.png", BACK);
