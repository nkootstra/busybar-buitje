// Where the rain comes from: KNMI's rain radar for the first 2 hours where it reaches, and weather models,
// through Open-Meteo, for everything else. Everything about the two services is here: their addresses, what
// their answers look like, how those become levels (see rain.js), and the credit the data asks for.
import { HOURS, WET, levelOf } from "./rain.js";

/**
 * The radar nowcast: where the showers the radar sees now will be in the next 2 hours, for one square
 * kilometre. KNMI publishes it as a picture of the whole country every 5 minutes; a relay made for this app
 * reads those and answers with the numbers for one place. Over HTTPS, at the cost of a handshake: plain HTTP
 * is answered there with a redirect, and the bar follows none.
 */
const NOWCAST = "https://buitje.kootstra.io/v1/rain";
/**
 * The same nowcast straight from KNMI, for when the relay does not answer: its map service, which anyone may
 * ask without a key. It is the lesser way: its quota of 1000 requests an hour is shared by everyone who uses
 * it, and it answers right only for moments 10 minutes apart of a run that is named ("current" is the newest),
 * so it gives half the detail.
 */
const NOWCAST_DIRECT =
  "https://anonymous.api.dataplatform.knmi.nl/wms/adaguc-server?DATASET=radar_forecast_2.0a&SERVICE=WMS&VERSION=1.1.1" +
  "&request=GetFeatureInfo&LAYERS=precipitation_nowcast&QUERY_LAYERS=precipitation_nowcast&INFO_FORMAT=application/json" +
  "&SRS=EPSG:4326&WIDTH=3&HEIGHT=3&X=1&Y=1&DIM_REFERENCE_TIME=current";
const DIRECT_STEP_MS = 10 * 60000;
/** The moments asked for: 2 hours of them. */
const DIRECT_STEPS = 12;
/** What the radar's picture covers: the Netherlands, Belgium and a strip around them. Elsewhere it is not asked. */
const RADAR = { south: 48.9, north: 55.97, west: 0, east: 10.85 };
/**
 * The least the radar can count is 0.12 mm an hour, and on its own, with dry before and after, it is as often
 * a speck as a drop: one place in six with any rain in its 2 hours has nothing but these. Such a value is
 * shown, faintly, but is not rain to speak of or to sound an alert for.
 */
const SPECK_BELOW = 0.2;
const SPECK_LEVEL = WET - 1;

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
 * it, and gives the app its finer first hours there. It does not replace the hours: see buildSeries.
 */
const BY_THE_HOUR = "knmi_seamless";
const BY_THE_QUARTER = "icon_d2";
/** How many quarters are asked for: the first 6 hours. */
const QUARTERS = 24;

/**
 * The credit for the data on show, by what a series is made of (its `made`): with the radar, with the finer
 * model's first hours, or with neither. The data's licences ask for it (Open-Meteo, KNMI and DWD: CC BY 4.0):
 * it stays on the back display whatever else is there. Without the finer model the hours are KNMI's where its
 * model reaches and another's elsewhere, which the answer does not say.
 */
export const CREDIT = {
  radar: "KNMI radar + DWD via Open-Meteo",
  fine: "KNMI + DWD via Open-Meteo",
  coarse: "KNMI and others via Open-Meteo",
};

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

/** Whether the radar's picture covers a place. Near its edge the relay may still say it has nothing. */
export function inRadarReach(place) {
  return place.lat > RADAR.south && place.lat < RADAR.north && place.lon > RADAR.west && place.lon < RADAR.east;
}

/**
 * Reads the relay's answer: { run, step, rain }, with `run` the unix time of the first value, `step` the
 * seconds between values, and `rain` mm an hour for each; `rain` is null where the radar has no data.
 * Returns a block as buildSeries takes it, null where the radar has no data, and undefined when the answer is
 * not one.
 */
export function parseNowcast(json) {
  if (!json || !(json.run > 0) || !(json.step > 0)) return undefined;
  if (json.rain === null) return null;
  if (!json.rain || !json.rain.length) return undefined;
  const rain = json.rain;
  for (let i = 0; i < rain.length; i++) if (typeof rain[i] !== "number") return undefined;
  return { firstEnds: json.run * 1000, span: json.step * 1000, levels: radarLevels(rain) };
}

/** The radar's mm an hour as levels, with a least count on its own made a speck. */
function radarLevels(rain) {
  const levels = [];
  for (let i = 0; i < rain.length; i++) {
    const alone = !(rain[i - 1] > 0) && !(rain[i + 1] > 0);
    levels.push(alone && rain[i] > 0 && rain[i] < SPECK_BELOW ? SPECK_LEVEL : levelOf(rain[i]));
  }
  return levels;
}

const two = (n) => (n < 10 ? "0" : "") + n;

/** A moment as KNMI's map service names it: 2026-11-18T12:10:00Z. */
function stampOf(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + "-" + two(d.getUTCMonth() + 1) + "-" + two(d.getUTCDate()) + "T" + two(d.getUTCHours()) + ":" + two(d.getUTCMinutes()) + ":00Z";
}

/** The moments to ask the map service for at `now`: every 10 minutes from the one `now` is in. */
function directMoments(now) {
  const first = Math.floor(now / DIRECT_STEP_MS) * DIRECT_STEP_MS;
  const moments = [];
  for (let i = 0; i <= DIRECT_STEPS; i++) moments.push(first + i * DIRECT_STEP_MS);
  return moments;
}

/**
 * Reads the map service's answer for the `moments` that were asked: [{ data: { <run>: { <moment>: "0.12" } } }],
 * mm an hour as text, each the rate at its moment. A moment before the run's start is left out of the answer.
 * Returns a block as buildSeries takes it, each value standing for the 10 minutes around its moment; null
 * where the radar has no data; undefined when the answer is not one.
 */
export function parseDirectNowcast(json, moments) {
  const data = json && json[0] && json[0].data;
  if (!data || typeof data !== "object") return undefined;
  let values = null;
  for (const run in data) values = data[run];
  if (!values) return null;
  const rain = [];
  let first = 0;
  for (let i = 0; i < moments.length; i++) {
    const value = parseFloat(values[stampOf(moments[i])]);
    if (value >= 0) {
      if (!rain.length) first = moments[i];
      rain.push(value);
    } else if (rain.length) break;
  }
  if (!rain.length) return undefined;
  return { firstEnds: first + DIRECT_STEP_MS / 2, span: DIRECT_STEP_MS, levels: radarLevels(rain) };
}

/**
 * The radar nowcast for a place. Resolves to a block, or to null where the radar has no data; rejects when the
 * request fails or the answer is not one.
 */
export function loadNowcast(place) {
  return fetch(NOWCAST + "?lat=" + coordinate(place.lat) + "&lon=" + coordinate(place.lon)).then((res) => {
    if (!res.ok) throw new Error("nowcast: HTTP " + res.status);
    return res.json().then((json) => {
      const nowcast = parseNowcast(json);
      if (nowcast === undefined) throw new Error("nowcast: none in the answer");
      return nowcast;
    });
  });
}

/**
 * The radar nowcast for a place straight from KNMI's map service, at moment `now` in ms. Resolves and rejects
 * as loadNowcast does.
 */
export function loadNowcastDirect(place, now) {
  const moments = directMoments(now);
  const lat = Math.round(place.lat * 100) / 100;
  const lon = Math.round(place.lon * 100) / 100;
  // The service answers for the middle of a small map around the place.
  const box = [lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01].map((edge) => edge.toFixed(2)).join(",");
  return fetch(NOWCAST_DIRECT + "&BBOX=" + box + "&TIME=" + moments.map(stampOf).join(",")).then((res) => {
    if (!res.ok) throw new Error("nowcast, direct: HTTP " + res.status);
    return res.json().then((json) => {
      const nowcast = parseDirectNowcast(json, moments);
      if (nowcast === undefined) throw new Error("nowcast, direct: none in the answer");
      return nowcast;
    });
  });
}
