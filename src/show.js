// What the displays are asked to show at one moment, as one plain object. The app makes one on every frame;
// the benchmark and the preview tool make them too, so that they draw exactly what the app would.
import { headline } from "./headline.js";

/**
 * Describes what to show. Every field has a value here, so that a display can count on all of them.
 *
 * @param {object} fields - any of:
 *   `series` and its `version`, from the feed; null while there is none.
 *   `problem`, what is in the way of fresh data, if anything: one of the feed's PROBLEMS.
 *   `stale`, whether the first hours are getting old, and `freshAt`, when they are from, in ms.
 *   `now` in ms, and `zone`, the bar's minutes east of UTC.
 *   `hours`, the window's length at this moment, and `window`, the length it has or is sliding to.
 *   `labelled`, whether the window's name is on show.
 *   `inWords`, whether the front shows the headline instead of the timeline.
 *   `language`, and `place`, the name of the spot.
 *   `frame`, which counts the frames, for the shimmer.
 * @returns {object} those fields, and `words`: the headline for the series, null without one.
 */
export function describe(fields) {
  const series = fields.series || null;
  const now = fields.now || 0;
  const zone = fields.zone || 0;
  const language = fields.language || "en";
  // Written out field by field: this runs on every frame, and the bar is slow at walking an object's keys.
  return {
    series,
    version: fields.version || 0,
    problem: fields.problem || null,
    stale: !!fields.stale,
    freshAt: fields.freshAt || 0,
    now,
    zone,
    hours: fields.hours || 2,
    window: fields.window || 2,
    labelled: !!fields.labelled,
    inWords: !!fields.inWords,
    language,
    place: fields.place || "",
    frame: fields.frame || 0,
    words: series ? headline(series, now, zone, language) : null,
  };
}
