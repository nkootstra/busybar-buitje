// Where the rain comes from: the radar nowcast for the next 2 hours and a weather model for the 2 days after.
// Everything about the two services is here: their addresses, what their answers look like, how those become
// levels (see rain.js), and the credit their data asks for.
import { HOURS, levelOf } from "./rain.js";

/**
 * Buienradar's nowcast for one spot, the Netherlands and Belgium only. HTTPS, because the plain address answers
 * with a redirect and the bar follows none.
 */
const RADAR = "https://gpsgadget.buienradar.nl/data/raintext";
/** Open-Meteo, with KNMI's HARMONIE model where it reaches. Plain HTTP: the bar takes 1.5 s for a TLS handshake. */
const MODEL = "http://api.open-meteo.com/v1/forecast";

/** The radar's answer for a place it does not cover. */
const NOT_COVERED = 404;

/** What loadNowcast resolves to where the radar does not reach. */
export const NO_RADAR = "no radar";

/**
 * The credit for the data on show, with the radar's and with the model's alone. The data's licences ask for
 * it (KNMI and Open-Meteo: CC BY 4.0): it stays on the back display whatever else is there.
 */
export const CREDIT = { radar: "Buienradar + KNMI via Open-Meteo", model: "KNMI via Open-Meteo" };

/**
 * Reads the radar nowcast: lines of "077|21:45", a level and a clock time, 5 minutes apart. The levels are
 * already on the scale the app uses.
 * Returns { minute, levels }: the minute of the hour of the first line, and the levels in order; or null when
 * the text is something else.
 */
export function parseNowcast(text) {
  const levels = [];
  let minute = -1;
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d{1,3})\|\d\d:(\d\d)/.exec(lines[i]);
    if (!m) continue;
    if (minute < 0) minute = parseInt(m[2], 10);
    levels.push(Math.min(255, parseInt(m[1], 10)));
  }
  return levels.length ? { minute, levels } : null;
}

/**
 * Reads the model's forecast, with times as unix seconds. A value is the rain that fell in the hour, or the
 * quarter of an hour, before its time.
 * Returns { hours, quarters }, each a block { end, span, levels } as buildSeries takes them; `quarters` is null
 * when they were not asked for. Returns null when there is no forecast in the answer.
 */
export function parseModel(json) {
  const read = (block, span) => {
    if (!block || !block.time || !block.precipitation || !(block.time[0] > 0)) return null;
    const levels = [];
    for (let i = 0; i < block.time.length; i++) levels.push(levelOf((block.precipitation[i] * 3600000) / span));
    return { end: block.time[0] * 1000, span, levels };
  };
  const hours = read(json && json.hourly, 3600000);
  if (!hours) return null;
  return { hours, quarters: read(json.minutely_15, 15 * 60000) };
}

/** Two decimals are 1 km: as fine as the data is. */
function spot(value) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * The radar nowcast for a place. Resolves to what parseNowcast gives, or to NO_RADAR where the radar does not
 * reach; rejects when the request fails or the answer is not a nowcast.
 */
export function loadNowcast(place) {
  return fetch(RADAR + "?lat=" + spot(place.lat) + "&lon=" + spot(place.lon)).then((res) =>
    res.text().then((text) => {
      if (res.status === NOT_COVERED) return NO_RADAR;
      if (!res.ok) throw new Error("radar: HTTP " + res.status);
      const nowcast = parseNowcast(text);
      if (!nowcast) throw new Error("radar: not a nowcast");
      return nowcast;
    }),
  );
}

/**
 * The model's forecast for a place: by the hour as far as the app looks, and with `quarters` the first 3 hours
 * by the quarter, for places without radar. Resolves to what parseModel gives; rejects when the request or the
 * answer fails.
 */
export function loadModel(place, quarters) {
  const url =
    MODEL +
    "?latitude=" +
    spot(place.lat) +
    "&longitude=" +
    spot(place.lon) +
    // One hour more than the app looks ahead: the first value is the hour that has just passed.
    "&hourly=precipitation&models=knmi_seamless&timeformat=unixtime&forecast_hours=" +
    (HOURS + 1) +
    (quarters ? "&minutely_15=precipitation&forecast_minutely_15=12" : "");
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error("model: HTTP " + res.status);
    return res.json().then((json) => {
      const model = parseModel(json);
      if (!model) throw new Error("model: no forecast in the answer");
      return model;
    });
  });
}
