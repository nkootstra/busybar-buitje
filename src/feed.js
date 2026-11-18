// The rain data as the app has it: when the forecast is asked for, what is done when the connection or the
// service fails, and the series made of its latest answer.
import { loadWifi } from "./bar.js";
import { STEP_MS, buildSeries } from "./rain.js";
import { loadForecast } from "./sources.js";

/** How often the forecast is asked for: its finest values are a quarter of an hour apart. */
const EVERY_MS = 15 * 60000;
/**
 * After a failure it is asked again after a minute, then 2, then 4, and so on up to its usual pace: no sooner,
 * because the bar has better things to do. Without Wi-Fi nothing is asked at all, and the Wi-Fi is looked at
 * again every minute.
 */
const RETRY_MS = 60000;
/** When the data counts as old (three answers missed), and when as too old to show. */
const STALE_MS = 3 * EVERY_MS;
const EXPIRED_MS = 3 * 60 * 60000;

/** The states of the bar's Wi-Fi in which it has no connection. Any other answer is taken as connected. */
const NOT_CONNECTED = ["disconnected", "connecting", "reconnecting", "disconnecting"];

/** What can be in the way of fresh data. texts.js has words for each; a test holds the two together. */
export const PROBLEMS = ["offline", "unreachable"];

/**
 * The feed for one place.
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
 *   something is in the way of fresh data: the bar is not on Wi-Fi ("offline"), or it is and the service does
 *   not answer ("unreachable"). `freshAt` is when the forecast last came, 0 for never. `poll`, called on every
 *   frame, asks for it when it is due; `refresh` makes it due; after `stop` nothing more is asked.
 */
export function createFeed(place, report) {
  /** When the forecast is next due, and how many times in a row asking for it has failed. */
  let dueAt = 0;
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
      if (stopped || busy || now < dueAt) return;
      busy = true;
      loadWifi()
        // A bar that cannot say whether it is on Wi-Fi is taken to be: the request will tell.
        .catch((err) => {
          report(err);
          return "connected";
        })
        .then((state) => {
          offline = NOT_CONNECTED.indexOf(state) >= 0;
          if (offline) dueAt = Date.now() + RETRY_MS;
          // Nothing is asked of the internet once the app has been told to stop.
          else if (!stopped) return loadForecast(place).then(take);
        })
        // Whatever went wrong, with the request or with what was made of its answer, the feed is free again.
        .catch(fail)
        .then(() => (busy = false));
    },
    refresh() {
      dueAt = 0;
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

  /** Takes the series off when it has nothing ahead of now any more, or the forecast has not come for too long. */
  function expire(now) {
    const series = feed.series;
    if (!series) return;
    if (now >= series.base + series.known * STEP_MS || now - feed.freshAt > EXPIRED_MS) put(null);
  }

  function take(forecast) {
    const now = Date.now();
    failures = 0;
    dueAt = now + EVERY_MS;
    feed.freshAt = now;
    put(buildSeries(now, forecast));
  }

  /** A failure keeps what there is. */
  function fail(err) {
    report(err);
    // Doubling stops well before the number would outgrow what the bar counts in.
    dueAt = Date.now() + Math.min(EVERY_MS, RETRY_MS * Math.pow(2, Math.min(failures, 6)));
    failures++;
  }

  return feed;
}
