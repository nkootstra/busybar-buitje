// Writes docs/screenshots: the screenshots in screenshots/ as they look on the bar, for the README.
//
// The front display is a matrix of LEDs: round lights with dark between them, not the flat squares a screenshot
// has. Each pixel of a front screenshot becomes one such light. The back display is a screen, and is only
// enlarged. The catalog takes the screenshots themselves, at the displays' own size.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "screenshots");
const to = resolve(root, "docs/screenshots");

/** The size of one LED with the dark around it, the radius of its light, and the space around the matrix. */
const CELL = 16;
const RADIUS = 6.2;
const MARGIN = 14;
/** The bar's face between the lights, and a light that is off: just visible, as on the bar. */
const FACE = [8, 8, 10];
const OFF = [22, 23, 30];
/** How far a light's glow reaches past its edge, and how strong it is there. */
const GLOW = 5;
const GLOW_STRENGTH = 0.22;
/** How many times the back display is enlarged. */
const BACK_SCALE = 4;

/** A front screenshot as LEDs. */
function leds({ width, height, rgba }) {
  const w = width * CELL + 2 * MARGIN;
  const h = height * CELL + 2 * MARGIN;
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < out.length; i += 4) out.set([FACE[0], FACE[1], FACE[2], 255], i);

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const at = (py * width + px) * 4;
      // The display's darkest colours are LEDs that are off or all but off.
      const lit = rgba[at] + rgba[at + 1] + rgba[at + 2] > 90;
      const colour = lit ? [rgba[at], rgba[at + 1], rgba[at + 2]] : OFF;
      const cx = MARGIN + px * CELL + CELL / 2;
      const cy = MARGIN + py * CELL + CELL / 2;
      const reach = Math.ceil(RADIUS + (lit ? GLOW : 1));
      for (let y = Math.floor(cy - reach); y <= cy + reach; y++) {
        for (let x = Math.floor(cx - reach); x <= cx + reach; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          // Full inside the light, a soft edge one pixel wide, and for a lit one a glow that fades beyond it.
          let share = Math.max(0, Math.min(1, RADIUS + 0.5 - distance));
          if (lit && distance > RADIUS) share = Math.max(share, GLOW_STRENGTH * Math.max(0, 1 - (distance - RADIUS) / GLOW));
          if (!share) continue;
          const o = (y * w + x) * 4;
          // Light adds up: where two glows meet it is brighter, never darker.
          for (let k = 0; k < 3; k++) out[o + k] = Math.min(255, Math.max(out[o + k], Math.round(FACE[k] + (colour[k] - FACE[k]) * share)));
        }
      }
    }
  }
  return encodePng(w, h, out);
}

/** A back screenshot enlarged, every pixel a square. */
function enlarged({ width, height, rgba }, scale) {
  const out = new Uint8Array(width * scale * height * scale * 4);
  for (let y = 0; y < height * scale; y++) {
    for (let x = 0; x < width * scale; x++) {
      const source = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
      out.set(rgba.subarray(source, source + 4), (y * width * scale + x) * 4);
    }
  }
  return encodePng(width * scale, height * scale, out);
}

mkdirSync(to, { recursive: true });
for (const name of readdirSync(from).filter((file) => file.endsWith(".png"))) {
  const picture = decodePng(readFileSync(resolve(from, name)));
  if (name.startsWith("front-")) writeFileSync(resolve(to, name), leds(picture));
  else if (name.startsWith("back-")) writeFileSync(resolve(to, name), enlarged(picture, BACK_SCALE));
}
console.log("wrote " + to);
