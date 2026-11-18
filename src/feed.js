// The rain data as the app has it: when each source is asked, what is done when the connection or a service
// fails, and the series made of their latest answers.
import { loadWifi } from "./bar.js";
import { NOWCAST_KEEP_MS, STEP_MS, buildSeries } from "./rain.js";
import { inRadarReach, loadForecast, loadNowcast, loadNowcastDirect } from "./sources.js";

/** How often the forecast is asked for: its finest values are a quarter of an hour apart. */
const FORECAST_MS = 15 * 60000;
/** How often the radar's nowcast is asked for: a new one comes every 5 minutes. */
const NOWCAST_MS = 5 * 60000;
/**
 * When the relay does not answer, KNMI itself is asked, but no more often than this: what it gives is 10
 * minutes apart, and its quota is shared by everyone who asks it.
 */
const DIRECT_MS = 10 * 60000;
/** Where the radar turned out to have no data, it is asked again after this long: its reach does not move. */
const NO_RADAR_MS = 6 * 60 * 60000;
/**
 * After a failure the forecast is asked again after a minute, then 2, then 4, and so on up to its usual pace:
 * no sooner, because the bar has better things to do. Without Wi-Fi nothing is asked at all, and the Wi-Fi is
 * looked at again every minute.
 */
const RETRY_MS = 60000;
/** However often Start is pressed, a source is not asked again within this long. */
const REFRESH_GAP_MS = 10000;
/** When the data counts as old (three forecasts missed), and when as too old to show. */
const STALE_MS = 3 * FORECAST_MS;
const EXPIRED_MS = 3 * 60 * 60000;

/** The states of the bar's Wi-Fi in which it has no connection. Any other answer is taken as connected. */
const NOT_CONNECTED = ["disconnected", "connecting", "reconnecting", "disconnecting"];

/** What can be in the way of fresh data. texts.js has words for each; a test holds the two together. */
export const PROBLEMS = ["offline", "unreachable"];

/**
 * The feed for one place.
 *
 * The forecast is what the app cannot do without: `freshAt`, `problem` and `stale` speak of it alone. The
 * radar's nowcast makes the first 2 hours better where there is one; when it fails or grows old the series is
 * made without it, and nothing is said.
 *
 * @param {{ lat: number, lon: number }} place
 * @param {(err: unknown) => void} report - told of every request that fails.
 * @returns {{
 *   series: object | null,
 *   version: number,
 *   problem: string | null,
 *   freshAt: number,
 *   poll: () => void,
 *   refresh: () => void,
 *   stop: () => void,
 *   stale: (now: number) => boolean,
 * }}
 *   `series` is what buildSeries gives: null until the forecast has come, and again once what there is has run
 *   out or is too old to show. `version` counts up whenever it changes. `problem` is one of PROBLEMS when
 *   something is in the way of a fresh forecast: the bar is not on Wi-Fi ("offline"), or it is and the service
 *   does not answer ("unreachable"). `freshAt` is when the forecast last came, 0 for never. `poll`, called on
 *   every frame, asks for what is due; `refresh` makes both sources due; after `stop` nothing more is asked.
 */
export function createFeed(place, report) {
  /** The latest answer of each source, when each is next due, and when it was last asked. */
  let forecast = null;
  let nowcast = null;
  let forecastDue = 0;
  let nowcastDue = inRadarReach(place) ? 0 : Infinity;
  let forecastAsked = -Infinity;
  let nowcastAsked = -Infinity;
  let directAsked = -Infinity;
  /** How many times in a row asking for the forecast has failed. */
  let failures = 0;
  /** Whether the bar's Wi-Fi was down when last looked at, and whether a look or a request is under way. */
  let offline = false;
  let busy = false;
  let stopped = false;

  const feed = {
    series: null,
    version: 0,
    freshAt: 0,
    get problem() {
      return offline ? "offline" : failures > 0 ? "unreachable" : null;
    },
    poll() {
      const now = Date.now();
      expire(now);
      if (stopped || busy) return;
      // One request at a time, the forecast first: without it there is nothing to show.
      const ask = now >= forecastDue ? askForecast : now >= nowcastDue ? askNowcast : null;
      if (!ask) return;
      busy = true;
      loadWifi()
        // A bar that cannot say whether it is on Wi-Fi is taken to be: the request will tell.
        .catch((err) => {
          report(err);
          return "connected";
        })
        .then((state) => {
          offline = NOT_CONNECTED.indexOf(state) >= 0;
          if (offline) {
            // Looked at again in a minute; the radar waits for the forecast.
            forecastDue = Math.max(forecastDue, Date.now() + RETRY_MS);
            nowcastDue = Math.max(nowcastDue, forecastDue);
          }
          // Nothing is asked of the internet once the app has been told to stop.
          else if (!stopped) return ask();
        })
        // Whatever went wrong with what was made of an answer, the feed is free again.
        .catch(report)
        .then(() => (busy = false));
    },
    refresh() {
      const now = Date.now();
      if (now - forecastAsked >= REFRESH_GAP_MS) forecastDue = 0;
      if (nowcastDue !== Infinity && now - nowcastAsked >= REFRESH_GAP_MS) nowcastDue = 0;
    },
    stop() {
      stopped = true;
    },
    stale: (now) => feed.freshAt > 0 && now - feed.freshAt > STALE_MS,
  };

  function put(series) {
    feed.series = series;
    feed.version++;
  }

  /**
   * Takes the series off when it has nothing ahead of now any more, or the forecast has not come for too long;
   * makes it anew, without the radar, when the radar's nowcast has grown too old to show.
   */
  function expire(now) {
    const series = feed.series;
    if (!series) return;
    if (now >= series.base + series.known * STEP_MS || now - feed.freshAt > EXPIRED_MS) put(null);
    else if (series.made === "radar" && !(nowcast && now - nowcast.firstEnds <= NOWCAST_KEEP_MS)) {
      put(buildSeries(now, forecast, null));
    }
  }

  function askForecast() {
    forecastAsked = Date.now();
    return loadForecast(place).then(
      (answer) => {
        const now = Date.now();
        failures = 0;
        forecastDue = now + FORECAST_MS;
        feed.freshAt = now;
        forecast = answer;
        put(buildSeries(now, forecast, nowcast));
      },
      // A failure keeps what there is.
      (err) => {
        report(err);
        // Doubling stops well before the number would outgrow what the bar counts in.
        forecastDue = Date.now() + Math.min(FORECAST_MS, RETRY_MS * Math.pow(2, Math.min(failures, 6)));
        failures++;
      },
    );
  }

  function askNowcast() {
    nowcastAsked = Date.now();
    return loadNowcast(place)
      .catch((err) => {
        report(err);
        // The relay does not answer: KNMI itself, when it was not asked just now and the app is still wanted.
        const now = Date.now();
        if (stopped || now - directAsked < DIRECT_MS) throw err;
        directAsked = now;
        // That KNMI has nothing for the place is not taken from this way: the relay is asked again as usual.
        return loadNowcastDirect(place, now).then((answer) => {
          if (!answer) throw err;
          return answer;
        });
      })
      .then(
        (answer) => {
          const now = Date.now();
          nowcast = answer;
          nowcastDue = now + (answer ? NOWCAST_MS : NO_RADAR_MS);
          // Without a forecast there is no series yet; it takes the nowcast in when it comes.
          if (answer && forecast && feed.series) put(buildSeries(now, forecast, nowcast));
        },
        // The app does without: the series stays as it is until the radar's part of it has grown old.
        (err) => {
          report(err);
          nowcastDue = Date.now() + NOWCAST_MS;
        },
      );
  }

  return feed;
}
