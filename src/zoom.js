// The window: how far ahead the timeline looks. The wheel steps it through fixed lengths, it slides from one to
// the next, and left alone it goes back to the length it started with.

/**
 * The lengths the wheel steps through, in hours. At 2 hours a quarter of an hour is exactly 9 columns. The
 * `zoom` setting in src/appmeta/settings.json offers the same lengths; a test holds the two together.
 */
export const ZOOMS = [1, 2, 3, 5, 9, 12, 18, 24, 36, 48];

/** How long the window slides to a new length, its name stays on show, and the wheel may rest before it goes back. */
const SLIDE_MS = 750;
const LABEL_MS = 1500;
const IDLE_MS = 30000;

/**
 * A window that starts, and rests, at step `home` of ZOOMS.
 *
 * @returns {{
 *   hours: () => number,
 *   length: (now: number) => number,
 *   turn: (clicks: number, now: number) => void,
 *   rest: (now: number) => void,
 *   sliding: (now: number) => boolean,
 *   labelled: (now: number) => boolean,
 * }}
 *   `hours` is the length the window has or is sliding to, `length` its length at this moment of the slide.
 *   `turn` is the wheel; `rest`, called on every frame, takes the window home once the wheel has been left
 *   alone. `labelled` is whether the window's name is on show, just after the wheel moved.
 */
export function createZoom(home) {
  let step = home;
  /** The slide: from the length the window had when it began, since `slidAt`. */
  let from = ZOOMS[home];
  let slidAt = 0;
  /** When the wheel was last turned; 0 when the window is where it rests. */
  let turnedAt = 0;

  const length = (now) => {
    const to = ZOOMS[step];
    const p = (now - slidAt) / SLIDE_MS;
    if (p >= 1) return to;
    // Halfway between 2 and 8 hours is 4, not 5: each moment of the slide changes the length by the same factor.
    return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * p);
  };

  const go = (to, now) => {
    const next = Math.max(0, Math.min(ZOOMS.length - 1, to));
    if (next === step) return;
    from = length(now);
    slidAt = now;
    step = next;
  };

  return {
    hours: () => ZOOMS[step],
    length,
    turn(clicks, now) {
      // Only a whole number of clicks moves the window: anything else would leave it without a length.
      if (typeof clicks !== "number" || clicks !== Math.round(clicks)) return;
      go(step + Math.max(-ZOOMS.length, Math.min(ZOOMS.length, clicks)), now);
      turnedAt = now;
    },
    rest(now) {
      if (!turnedAt || now - turnedAt <= IDLE_MS) return;
      go(home, now);
      turnedAt = 0;
    },
    sliding: (now) => now - slidAt < SLIDE_MS,
    labelled: (now) => turnedAt > 0 && now - turnedAt < LABEL_MS,
  };
}
