// Where the rain comes from: weather models, through Open-Meteo. Everything about the service is here: its
// address, what its answers look like, how those become levels (see rain.js), and the credit the data asks for.
import { HOURS, levelOf } from "./rain.js";

/** Open-Meteo's forecast for one spot. Plain HTTP: the bar takes 1.5 s for a TLS handshake. */
const FORECAST = "http://api.open-meteo.com/v1/forecast";

/**
 * The two models asked for, in one request.
 *
 * `knmi_seamless` is the forecast by the hour, for any place in the world: KNMI's HARMONIE where it reaches
 * (2 km in the Netherlands and Belgium, 5.5 km in central and northern Europe), other models elsewhere.
 *
 * `icon_d2`, of Germany's DWD, has rain by the quarter of an hour: real values, where KNMI's quarters are its
 * hours cut in four. It reaches central Europe, the Netherlands, Belgium, Denmark and southern England among
 * it, and gives the app its finer first hours there.
 */
const BY_THE_HOUR = "knmi_seamless";
const BY_THE_QUARTER = "icon_d2";
/** How many quarters are asked for: the first 6 hours. */
const QUARTERS = 24;

/**
 * The credit for the data on show, with and without the finer first hours. The data's licences ask for it
 * (Open-Meteo, KNMI and DWD: CC BY 4.0): it stays on the back display whatever else is there. Without the
 * finer model the hours are KNMI's where its model reaches and another's elsewhere, which the answer does not
 * say.
 */
export const CREDIT = { fine: "KNMI + DWD via Open-Meteo", coarse: "KNMI and others via Open-Meteo" };

/**
 * A block of the answer as buildSeries takes it: { firstEnds, span, levels }. Each value is the rain that fell in
 * the `span` ms before its time; times are unix seconds. The block stops at the first value that is missing:
 * past it nothing is known, which is not the same as dry. Null when there is no value at all.
 */
function read(times, values, span) {
  if (!times || !values || !(times[0] > 0)) return null;
  const levels = [];
  for (let i = 0; i < times.length && typeof values[i] === "number" && values[i] === values[i]; i++) {
    levels.push(levelOf((values[i] * 3600000) / span));
  }
  return levels.length ? { firstEnds: times[0] * 1000, span, levels } : null;
}

/**
 * Reads Open-Meteo's answer. Where both models reach, each value has its model's name behind it
 * (`precipitation_icon_d2`); where only one does, the values are plain `precipitation`, and they are that
 * model's hours, also under the quarters.
 * Returns { hours, quarters }; `quarters` is null where the finer model does not reach. Returns null when
 * there is no forecast in the answer.
 */
export function parseForecast(json) {
  const hourly = (json && json.hourly) || {};
  const quarterly = (json && json.minutely_15) || {};
  const hours = read(hourly.time, hourly["precipitation_" + BY_THE_HOUR] || hourly.precipitation, 3600000);
  if (!hours) return null;
  return { hours, quarters: read(quarterly.time, quarterly["precipitation_" + BY_THE_QUARTER], 15 * 60000) };
}

/** A coordinate to two decimals, which is 1 km: as fine as the data is. */
function coordinate(value) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * The forecast for a place. Resolves to what parseForecast gives; rejects when the request fails or the answer
 * has no forecast in it.
 */
export function loadForecast(place) {
  const url =
    FORECAST +
    "?latitude=" +
    coordinate(place.lat) +
    "&longitude=" +
    coordinate(place.lon) +
    "&timeformat=unixtime&models=" +
    BY_THE_HOUR +
    "," +
    BY_THE_QUARTER +
    // One hour more than the app looks ahead: the first value is the hour that has just passed.
    "&hourly=precipitation&forecast_hours=" +
    (HOURS + 1) +
    "&minutely_15=precipitation&forecast_minutely_15=" +
    QUARTERS;
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error("forecast: HTTP " + res.status);
    return res.json().then((json) => {
      const forecast = parseForecast(json);
      if (!forecast) throw new Error("forecast: none in the answer");
      return forecast;
    });
  });
}
