// The app's settings as the app uses them. They are described for the bar in src/appmeta/settings.json; a test
// holds the defaults and choices there together with the ones here.
import { TEXTS, plain } from "./texts.js";
import { ZOOMS } from "./zoom.js";

/** Where the rain is shown when no place is set: the middle of the Netherlands. */
export const HOME = { name: "Utrecht", lat: 52.09, lon: 5.12 };

/** The values the app runs on until the person sets their own. */
export const DEFAULTS = { place: HOME, zoomStep: ZOOMS.indexOf(2), alert: 15, sound: false, language: "en" };

/**
 * The longest alert the app takes, in minutes. The settings offer half an hour at most; past 2 hours the
 * headline no longer says how soon rain comes, so a longer alert could never go off.
 */
const LONGEST_ALERT = 120;

/** Whether `value` is a number from `low` to `high`. */
function within(value, low, high) {
  return typeof value === "number" && value >= low && value <= high;
}

/**
 * Reads the values the bar stored. Anything missing or odd falls back to its default: a setting the app
 * cannot use must not stop it.
 *
 * @returns {{ place: { name: string, lat: number, lon: number }, zoomStep: number, alert: number, sound: boolean, language: string }}
 *   `place.name` is plain text the displays can show. `zoomStep` is the step of ZOOMS for the window the
 *   setting names in hours; `alert` the minutes ahead of rain to warn, 0 for never.
 */
export function readSettings(values) {
  const stored = values || {};
  const place = stored.place || {};
  const placed = within(place.lat, -90, 90) && within(place.lon, -180, 180);
  const zoomStep = ZOOMS.indexOf(parseInt(stored.zoom, 10));
  const alert = parseInt(stored.alert, 10);
  return {
    place: placed ? { name: plain(place.name), lat: place.lat, lon: place.lon } : HOME,
    zoomStep: zoomStep < 0 ? DEFAULTS.zoomStep : zoomStep,
    alert: within(alert, 0, LONGEST_ALERT) ? alert : DEFAULTS.alert,
    sound: stored.sound === true,
    language: typeof stored.language === "string" && TEXTS[stored.language] ? stored.language : DEFAULTS.language,
  };
}
