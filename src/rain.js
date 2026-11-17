// The rain ahead as one series: 48 hours in steps of 5 minutes, from the radar nowcast and the weather model.
//
// Everything is kept as a "level", a whole number from 0 to 255 on a logarithmic scale: 0 is dry and
// 10^((level - 109) / 32) is the rain in mm an hour. That is the scale the radar feed uses, and it lets the
// drawing compare whole numbers instead of computing with fractions on every frame, which the bar is slow at.

/** One step of the series, and how many of them there are: 48 hours. */
export const STEP_MS = 5 * 60000;
export const STEPS = 576;

/** Levels that matter: rain you would notice (0.1 mm/h), where drizzle ends (0.5) and where heavy rain starts (4). */
export const WET = 77;
export const RAIN = 100;
export const HEAVY = 129;

/** The radar nowcast reaches 2 hours; over the hour after it the series fades into the model. */
const NOWCAST_STEPS = 24;
const FADE_STEPS = 12;

/** Rain in mm an hour as a level. */
export function levelOf(mmPerHour) {
  if (!(mmPerHour > 0)) return 0;
  return Math.max(1, Math.min(255, Math.round(109 + (32 * Math.log(mmPerHour)) / Math.LN10)));
}

/** A level as rain in mm an hour. */
export function mmPerHour(level) {
  return level > 0 ? Math.pow(10, (level - 109) / 32) : 0;
}

/**
 * Reads the radar nowcast: lines of "077|21:45", a level and a clock time in the Netherlands, 5 minutes apart.
 * Returns { minutes, levels }: the first line's time as minutes of the day, and the levels in order.
 * Returns null when the text is something else, such as the answer for a place the radar does not cover.
 */
export function parseNowcast(text) {
  const levels = [];
  let minutes = -1;
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d{1,3})\|(\d\d):(\d\d)/.exec(lines[i]);
    if (!m) continue;
    if (minutes < 0) minutes = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    levels.push(Math.min(255, parseInt(m[1], 10)));
  }
  return levels.length ? { minutes, levels } : null;
}

/**
 * Reads the model's forecast (Open-Meteo, times as unix seconds). An hourly value is the rain that fell in the
 * hour before its time, a quarterly value in the 15 minutes before.
 * Returns { hours: { end, levels }, quarters: { end, levels } } with `end` the first value's time in ms, or null.
 */
export function parseModel(json) {
  const read = (block, perHour) => {
    if (!block || !block.time || !block.precipitation || !block.time.length) return null;
    const levels = [];
    for (let i = 0; i < block.time.length; i++) levels.push(levelOf(block.precipitation[i] * perHour));
    return { end: block.time[0] * 1000, levels };
  };
  const hours = read(json && json.hourly, 1);
  if (!hours) return null;
  return { hours, quarters: read(json.minutely_15, 4) };
}

/** The level at moment `at` from values that each cover the `span` ms before their time; -1 outside them. */
function levelAt(values, span, at) {
  const index = Math.floor((at - values.end) / span) + 1;
  return index >= 0 && index < values.levels.length ? values.levels[index] : -1;
}

/**
 * Joins the sources into one series that starts at the 5-minute step `now` falls in.
 *
 * @param {number} now - the moment, in ms.
 * @param {number} offsetMin - the zone the nowcast's clock times are in, minutes east of UTC.
 * @param {{minutes: number, levels: number[]} | null} nowcast - from parseNowcast; null where there is no radar.
 * @param {object | null} model - from parseModel.
 * @returns {{ base: number, levels: Uint8Array, radar: boolean } | null} null when there is nothing to show.
 */
export function buildSeries(now, offsetMin, nowcast, model) {
  if (!nowcast && !model) return null;
  const base = Math.floor(now / STEP_MS) * STEP_MS;
  const levels = new Uint8Array(STEPS);

  if (model) {
    for (let i = 0; i < STEPS; i++) {
      // The middle of the step decides which hour or quarter it belongs to.
      const at = base + i * STEP_MS + STEP_MS / 2;
      let level = model.quarters && !nowcast ? levelAt(model.quarters, 15 * 60000, at) : -1;
      if (level < 0) level = levelAt(model.hours, 3600000, at);
      levels[i] = level < 0 ? 0 : level;
    }
  }

  if (nowcast) {
    // The nowcast names clock times, not dates: its first line is the step nearest to now with that time.
    const baseMinutes = Math.floor((base + offsetMin * 60000) / 60000) % 1440;
    let ahead = ((nowcast.minutes - baseMinutes + 2160) % 1440) - 720;
    if (ahead < -60 || ahead > 60) ahead = 0;
    const first = Math.round(ahead / 5);
    let last = -1;
    for (let i = 0; i < nowcast.levels.length && i < NOWCAST_STEPS + 2; i++) {
      const step = first + i;
      if (step < 0 || step >= STEPS) continue;
      levels[step] = nowcast.levels[i];
      last = step;
    }
    // Radar and model seldom agree at the seam: fade from the one into the other.
    if (model && last >= 0) {
      const from = levels[last];
      for (let k = 1; k <= FADE_STEPS && last + k < STEPS; k++) {
        const to = levels[last + k];
        levels[last + k] = Math.round(from + ((to - from) * k) / (FADE_STEPS + 1));
      }
    }
    // The radar may start a step ahead of now: the steps before it are as the first one.
    for (let step = 0; step < first && step < STEPS; step++) levels[step] = nowcast.levels[0];
  }
  return { base, levels, radar: !!nowcast };
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
