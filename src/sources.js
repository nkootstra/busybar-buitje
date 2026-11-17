// Where the rain comes from: the radar nowcast for the next 2 hours and a weather model for the 2 days after.
import { parseModel, parseNowcast } from "./rain.js";

/**
 * Buienradar's nowcast for one spot, the Netherlands and Belgium only. HTTPS, because the plain address answers
 * with a redirect and the bar follows none.
 */
const RADAR = "https://gpsgadget.buienradar.nl/data/raintext";
/** Open-Meteo, with KNMI's HARMONIE model where it reaches. Plain HTTP: the bar takes 1.5 s for a TLS handshake. */
const MODEL = "http://api.open-meteo.com/v1/forecast";

/** Two decimals are 1 km: as fine as the data is. */
function spot(value) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * The radar nowcast for a place. Resolves to what parseNowcast gives, or to `false` where the radar does not
 * reach; rejects when the request fails or the answer is not a nowcast.
 */
export function loadNowcast(lat, lon) {
  return fetch(RADAR + "?lat=" + spot(lat) + "&lon=" + spot(lon)).then((res) =>
    res.text().then((text) => {
      if (res.status === 404) return false;
      if (!res.ok) throw new Error("radar: HTTP " + res.status);
      const nowcast = parseNowcast(text);
      if (!nowcast) throw new Error("radar: not a nowcast");
      return nowcast;
    }),
  );
}

/**
 * The model's forecast for a place: 48 hours by the hour, and with `quarters` the first 3 hours by the quarter,
 * for places without radar. Resolves to what parseModel gives; rejects when the request or the answer fails.
 */
export function loadModel(lat, lon, quarters) {
  const url =
    MODEL +
    "?latitude=" +
    spot(lat) +
    "&longitude=" +
    spot(lon) +
    "&hourly=precipitation&models=knmi_seamless&forecast_hours=49&timeformat=unixtime" +
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
