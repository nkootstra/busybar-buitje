// The rain data as the app has it: which source is asked when, what is done when the connection or a source
// fails, and the series made of their latest answers.
import { loadWifi } from "./bar.js";
import { STEP_MS, buildSeries } from "./rain.js";
import { NO_RADAR, loadModel, loadNowcast } from "./sources.js";

/** How often the radar and the model are asked, and the model where it stands in for the radar. */
const RADAR_MS = 5 * 60000;
const MODEL_MS = 60 * 60000;
const MODEL_ALONE_MS = 15 * 60000;
/**
 * After a failure a source is asked again after a minute, then 2, then 4, and so on up to its usual pace: no
 * sooner, because every request costs the bar a second and a half. Without Wi-Fi nothing is asked at all, and
 * the Wi-Fi is looked at again every minute.
 */
const RETRY_MS = 60000;
const MOST_DOUBLINGS = 6;
/** A radar answer is used for this long: older, and its clock times can no longer be placed. */
const RADAR_KEEP_MS = 15 * 60000;
/** When the first hours count as old, and when the whole series is too old to show. */
const STALE_MS = 20 * 60000;
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
 *   stale: (now: number) => boolean,
 * }}
 *   `series` is what buildSeries gives: null until a source has answered, and again once what there is has run
 *   out or is too old to show. `version` counts up whenever it changes. `problem` is one of PROBLEMS when
 *   something is in the way of fresh data: the bar is not on Wi-Fi ("offline"), or it is and the source of the
 *   first hours does not answer ("unreachable"). `freshAt` is when that source last answered, 0 for never.
 *   `poll`, called on every frame, asks what is due; `refresh` makes everything due.
 */
export function createFeed(place, report) {
  /** Each source: when it is next due, whether it is being asked, its last answer and when that came, and its failures in a row. */
  const radar = { dueAt: 0, asking: false, answer: null, answeredAt: 0, failures: 0 };
  const model = { dueAt: 0, asking: false, answer: null, answeredAt: 0, failures: 0 };
  /**
   * False once the radar has said it does not reach this place; the model's quarters then stand in for it.
   * That answer is final for as long as the app runs: the place does not move.
   */
  let covered = true;
  let offline = false;
  let checking = false;

  const feed = {
    series: null,
    version: 0,
    freshAt: 0,
    get problem() {
      if (offline) return "offline";
      const first = covered ? radar : model;
      return first.failures > 0 || (!feed.series && model.failures > 0) ? "unreachable" : null;
    },
    poll() {
      const now = Date.now();
      expire(now);
      const due = [];
      if (covered && !radar.asking && now >= radar.dueAt) due.push(radar);
      if (!model.asking && now >= model.dueAt) due.push(model);
      if (checking || !due.length) return;
      checking = true;
      loadWifi()
        // A bar that cannot say whether it is on Wi-Fi is taken to be: the requests will tell.
        .catch((err) => {
          report(err);
          return "connected";
        })
        .then((state) => {
          checking = false;
          offline = NOT_CONNECTED.indexOf(state) >= 0;
          for (const source of due) {
            if (offline) source.dueAt = Date.now() + RETRY_MS;
            else if (source === radar) ask(radar, RADAR_MS, loadNowcast(place));
            else ask(model, covered ? MODEL_MS : MODEL_ALONE_MS, loadModel(place, !covered));
          }
        });
    },
    refresh() {
      radar.dueAt = model.dueAt = 0;
    },
    stale: (now) => feed.freshAt > 0 && now - feed.freshAt > STALE_MS,
  };

  function show(series) {
    feed.series = series;
    feed.version++;
  }

  /** Takes the series off when it has nothing ahead of now any more, or nothing has answered for too long. */
  function expire(now) {
    const series = feed.series;
    if (!series) return;
    const ranOut = now >= series.base + series.known * STEP_MS;
    if (ranOut || now - Math.max(radar.answeredAt, model.answeredAt) > EXPIRED_MS) show(null);
  }

  /** Makes the series anew from the latest answers. */
  function join(now) {
    const nowcast = covered && now - radar.answeredAt < RADAR_KEEP_MS ? radar.answer : null;
    feed.freshAt = nowcast ? radar.answeredAt : model.answeredAt;
    show(buildSeries(now, nowcast, model.answer));
  }

  /** Takes a source's answer when it comes; a failure keeps what there is. */
  function ask(source, every, request) {
    source.asking = true;
    source.dueAt = Date.now() + every;
    request
      .then(
        (answer) => {
          const now = Date.now();
          source.failures = 0;
          if (answer === NO_RADAR) {
            // Ask the model again at once, for its quarters.
            covered = false;
            model.dueAt = 0;
          } else {
            source.answer = answer;
            source.answeredAt = now;
          }
          join(now);
        },
        (err) => {
          report(err);
          source.dueAt = Date.now() + Math.min(every, RETRY_MS * Math.pow(2, Math.min(source.failures, MOST_DOUBLINGS)));
          source.failures++;
        },
      )
      .then(() => (source.asking = false));
  }

  return feed;
}
