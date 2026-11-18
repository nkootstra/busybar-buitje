// Forecasts for the tests, in the shape Open-Meteo answers in, and one evening of weather most of them share.

/** The moment the tests take as now: Tuesday 17 November 2026, 21:14 in the Netherlands. */
export const AT = Date.UTC(2026, 10, 17, 20, 14);

/**
 * An answer of the forecast service, asked at moment `at`.
 *
 * @param {object} [given]
 * @param {number[]} [given.hours] - mm of rain in each hour ahead, the first being the hour `at` is in.
 * @param {number[] | null} [given.quarters] - mm of rain in each quarter of an hour ahead, the first being the
 *   quarter `at` is in; null for a place the finer model does not reach.
 * @param {number} [given.at]
 */
export function forecast({ hours = [], quarters = null, at = AT } = {}) {
  // The service starts each list with the hour or the quarter that has just passed: a value covers the time
  // before its moment.
  const lead = (values, span) => {
    const first = Math.floor(at / span) * span;
    return { time: [0].concat(values).map((_, i) => (first + i * span) / 1000), values: [0].concat(values) };
  };
  const hourly = lead(hours, 3600000);
  if (!quarters) {
    // Where only the model by the hour reaches, its values are not named after it, and its quarters are its
    // hours cut in four.
    const cut = lead(hours.slice(0, 6).flatMap((mm) => [mm / 4, mm / 4, mm / 4, mm / 4]), 900000);
    return { hourly: { time: hourly.time, precipitation: hourly.values }, minutely_15: { time: cut.time, precipitation: cut.values } };
  }
  const quarterly = lead(quarters, 900000);
  return {
    hourly: { time: hourly.time, precipitation_knmi_seamless: hourly.values, precipitation_icon_d2: hourly.values },
    minutely_15: { time: quarterly.time, precipitation_knmi_seamless: quarterly.values.map(() => 0), precipitation_icon_d2: quarterly.values },
  };
}

/** `count` values of `mm`. */
export const of = (count, mm) => new Array(count).fill(mm);

/**
 * The evening most tests share, seen from 21:14: dry until 21:45, then 45 minutes of drizzle, a dry spell, and
 * rain from 23:00 that the hours carry on with through the night.
 */
export const EVENING = forecast({
  quarters: [...of(3, 0), ...of(3, 0.075), ...of(2, 0), ...of(4, 0.5), ...of(12, 0)],
  hours: [0, 0, 2, ...of(3, 0), ...of(4, 1.5), ...of(38, 0)],
});

/** Two days without rain. */
export const DRY = forecast({ quarters: of(24, 0), hours: of(48, 0) });

/**
 * An answer of the radar's relay, asked at moment `at`.
 *
 * @param {number[]} rain - mm an hour for each 5 minutes ahead, the first being the 5 minutes `at` is in; what
 *   is left of the 2 hours is dry.
 * @param {number} [at]
 */
export function nowcast(rain = [], at = AT) {
  // A run starts with what the radar measured in the 5 minutes before it, and has 24 forecasts after that.
  const run = Math.floor(at / 300000) * 300;
  return { run, step: 300, rain: [0].concat(rain, of(24, 0)).slice(0, 25) };
}

/**
 * KNMI's own map service, as the pretend bar's `direct`: answers the moments an address asks for, 10 minutes
 * apart, with `rain` in mm an hour for each in turn and dry after that. The first moment asked is before the
 * newest run's start, so it is left out, as the service does.
 */
export function directNowcast(rain = []) {
  return (url) => {
    const moments = decodeURIComponent(url.split("&TIME=")[1].split("&")[0]).split(",");
    const values = {};
    moments.slice(1).forEach((moment, i) => (values[moment] = (rain[i] || 0).toFixed(6)));
    return [{ name: "precipitation_nowcast", units: "mm/hr", dims: ["reference_time", "time"], data: { [moments[0].slice(0, 15) + "5:00Z"]: values } }];
  };
}
