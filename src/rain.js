// The rain ahead as one series: 48 hours in steps of 5 minutes, made from a forecast by the hour and, where
// there is one, a finer forecast by the quarter for the first hours.
//
// Everything is kept as a "level", a whole number from 0 to 255 on a logarithmic scale: 0 is dry and
// 10^((level - 109) / 32) is the rain in mm an hour. A byte holds drizzle and cloudbursts alike that way, and
// the drawing can compare whole numbers instead of computing with fractions on every frame, which the bar is
// slow at.

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

/** Where the quarters end the series takes an hour to fade from them into the hours. */
const FADE_STEPS = 12;
/** How old the radar's nowcast may be and still be shown: a new one comes every 5 minutes. */
export const NOWCAST_KEEP_MS = 20 * 60000;

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
 * starts at `base`: a step takes the value its middle falls in, or with `over` keeps its own when that is
 * the stronger rain. Returns the step after the last one written.
 */
function fillFrom(block, base, levels, over) {
  // The step whose middle is the first at or after moment `at`.
  const stepAt = (at) => Math.max(0, Math.min(STEPS, Math.ceil((at - base - STEP_MS / 2) / STEP_MS)));
  let end = 0;
  for (let k = 0; k < block.levels.length; k++) {
    const from = stepAt(block.firstEnds + (k - 1) * block.span);
    end = stepAt(block.firstEnds + k * block.span);
    const level = block.levels[k];
    if (!over) levels.fill(level, from, end);
    else for (let i = from; i < end; i++) if (level > levels[i]) levels[i] = level;
  }
  return end;
}

/** Fades the series from the level of step `end - 1` into what follows it, where that is weaker rain. */
function fadeAfter(levels, end, known) {
  const from = levels[end - 1];
  for (let k = 0; k < FADE_STEPS && end + k < known; k++) {
    const to = levels[end + k];
    if (from > to) levels[end + k] = Math.round(from + ((to - from) * (k + 1)) / (FADE_STEPS + 1));
  }
}

/**
 * Makes a forecast, and the radar nowcast where there is one, into one series that starts at the 5-minute step
 * `now` falls in.
 *
 * @param {number} now - the moment, in ms.
 * @param {{ hours: object, quarters: object | null } | null} forecast - levels by the hour and, where the finer
 *   model reaches, by the quarter. Each is a block { firstEnds, span, levels }: every value covers the `span` ms
 *   before its time, and `firstEnds` is the first value's time, in ms.
 * @param {object | null} [nowcast] - the radar's block for the next 2 hours, where the radar reaches.
 * @returns {{ base: number, levels: Uint8Array, known: number, made: string } | null}
 *   `levels` has a level for each step from `base` on. Only the first `known` of them are known: past that the
 *   forecast said nothing, which is not the same as dry. `made` is what the first hours are made of: "radar",
 *   "fine" for the finer model's quarters, or "coarse" for the hours alone.
 *   Null when there is no forecast.
 */
export function buildSeries(now, forecast, nowcast) {
  if (!forecast) return null;
  const base = Math.floor(now / STEP_MS) * STEP_MS;
  const levels = new Uint8Array(STEPS);
  let known = fillFrom(forecast.hours, base, levels, false);
  // The two models often disagree, and neither is always right: a step shows the stronger rain of the two.
  // Rain that is shown and does not come costs less than rain that comes unannounced.
  const quartersEnd = forecast.quarters ? fillFrom(forecast.quarters, base, levels, true) : 0;
  // Where the quarters end, rain only they had fades out rather than stops at a line.
  if (quartersEnd > 0 && quartersEnd < known) fadeAfter(levels, quartersEnd, known);
  known = Math.max(known, quartersEnd);
  // The radar sees the showers there are, where a model works out where they should be: for as long as it
  // reaches, the radar is what is shown, also where it says dry and a model says rain. One that has grown old
  // is not used: its showers have moved on.
  const radarEnd = nowcast && now - nowcast.firstEnds <= NOWCAST_KEEP_MS ? fillFrom(nowcast, base, levels, false) : 0;
  if (radarEnd > 0 && radarEnd < known) fadeAfter(levels, radarEnd, known);
  known = Math.max(known, radarEnd);
  return { base, levels, known, made: radarEnd > 0 ? "radar" : quartersEnd > 0 ? "fine" : "coarse" };
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
