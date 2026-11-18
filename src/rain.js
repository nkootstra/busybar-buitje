// The rain ahead as one series: 48 hours in steps of 5 minutes, from the radar nowcast and the weather model.
//
// Everything is kept as a "level", a whole number from 0 to 255 on a logarithmic scale: 0 is dry and
// 10^((level - 109) / 32) is the rain in mm an hour. That is the scale the radar feed uses, and it lets the
// drawing compare whole numbers instead of computing with fractions on every frame, which the bar is slow at.

/** How far ahead the app looks, the length of one step of the series, and how many steps that makes. */
export const HOURS = 48;
export const STEP_MS = 5 * 60000;
export const STEPS = (HOURS * 3600000) / STEP_MS;

/** Levels that matter: rain you would notice (0.1 mm/h), where drizzle ends (0.5) and where heavy rain starts (4). */
export const WET = 77;
export const RAIN = 100;
export const HEAVY = 129;
/** Fainter than rain you would notice, but still drawn: the edge of a shower. */
export const FAINT = WET - 7;

/** The radar nowcast reaches 2 hours; over the hour after it the series fades into the model. */
const NOWCAST_STEPS = 24;
const FADE_STEPS = 12;

/** Rain in mm an hour as a level. */
export function levelOf(mmPerHour) {
  if (!(mmPerHour > 0)) return 0;
  return Math.max(1, Math.min(255, Math.round(109 + (32 * Math.log(mmPerHour)) / Math.LN10)));
}

/**
 * How many of `rows` rows rain of this level hangs down when it is drawn: 1 for the faintest, all of them from
 * 10 mm an hour. Both displays draw rain by this rule.
 */
export function reachOf(level, rows) {
  if (level < FAINT) return 0;
  return Math.max(1, Math.min(rows, Math.floor(((level - FAINT + 4) * rows) / 75)));
}

/**
 * Writes a block of values, each covering the `span` ms before its time, into the steps of a series that
 * starts at `base`: a step takes the value its middle falls in. Returns the step after the last one written.
 */
function fillFrom(block, base, levels) {
  // The step whose middle is the first at or after moment `at`.
  const stepAt = (at) => Math.max(0, Math.min(STEPS, Math.ceil((at - base - STEP_MS / 2) / STEP_MS)));
  let end = 0;
  for (let k = 0; k < block.levels.length; k++) {
    const from = stepAt(block.end + (k - 1) * block.span);
    end = stepAt(block.end + k * block.span);
    if (end > from) levels.fill(block.levels[k], from, end);
  }
  return end;
}

/**
 * Joins the sources into one series that starts at the 5-minute step `now` falls in.
 *
 * @param {number} now - the moment, in ms.
 * @param {{ minute: number, levels: number[] } | null} nowcast - the radar's levels, 5 minutes apart, and the
 *   minute of the hour of the first; null where there is no radar.
 * @param {{ hours: object, quarters: object | null } | null} model - levels by the hour and by the quarter,
 *   each a block { end, span, levels }: every value covers the `span` ms before its time, and `end` is the
 *   first value's time, in ms.
 * @returns {{ base: number, levels: Uint8Array, known: number, radar: boolean } | null}
 *   `levels` has a level for each step from `base` on. Only the first `known` of them are known: past that the
 *   sources said nothing, which is not the same as dry. `radar` is whether the first hours are the radar's.
 *   Null when there is nothing to show.
 */
export function buildSeries(now, nowcast, model) {
  if (!nowcast && !model) return null;
  const base = Math.floor(now / STEP_MS) * STEP_MS;
  const levels = new Uint8Array(STEPS);
  let known = 0;

  if (model) {
    known = fillFrom(model.hours, base, levels);
    // Without radar the model's quarters are the finer picture of the first hours.
    if (model.quarters && !nowcast) known = Math.max(known, fillFrom(model.quarters, base, levels));
  }

  if (nowcast) {
    // The radar's first line is within a few steps of now, so the minute of the hour places it; and since the
    // minute is the same in every zone a whole number of hours apart, the bar's own zone does not come into it.
    const baseMinute = Math.floor(base / 60000) % 60;
    const first = Math.round((((nowcast.minute - baseMinute + 90) % 60) - 30) / 5);
    let last = -1;
    for (let i = 0; i < nowcast.levels.length && i < NOWCAST_STEPS + 2; i++) {
      const step = first + i;
      if (step < 0 || step >= STEPS) continue;
      levels[step] = nowcast.levels[i];
      last = step;
    }
    // Radar and model seldom agree at the seam: fade from the one into the other.
    if (last >= 0 && last + 1 < known) {
      const from = levels[last];
      for (let k = 1; k <= FADE_STEPS && last + k < known; k++) {
        const to = levels[last + k];
        levels[last + k] = Math.round(from + ((to - from) * k) / (FADE_STEPS + 1));
      }
    }
    // The radar may start a step ahead of now: the steps before it are as the first one.
    for (let step = 0; step < first && step < STEPS; step++) levels[step] = nowcast.levels[0];
    known = Math.max(known, last + 1);
  }
  return { base, levels, known, radar: !!nowcast };
}

/**
 * The strongest rain in each of `out.length` columns that together show the `hours` after `now`.
 * The strongest, not the average: a short shower must not vanish when the window is wide.
 */
export function sampleColumns(series, now, hours, out) {
  const columns = out.length;
  const span = (hours * 60) / columns / 5;
  const start = (now - series.base) / STEP_MS;
  for (let c = 0; c < columns; c++) {
    const from = Math.floor(start + c * span);
    // A hair off the end, so that a column ending exactly on a step does not take the next one in.
    const to = Math.max(from, Math.ceil(start + (c + 1) * span - 1e-6) - 1);
    let top = 0;
    for (let i = Math.max(0, from); i <= to && i < STEPS; i++) if (series.levels[i] > top) top = series.levels[i];
    out[c] = top;
  }
  return out;
}
