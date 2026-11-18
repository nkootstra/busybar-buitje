// Buitje: the rain ahead for one spot. A timeline on the front display, the overview on the back.
//
// The wheel sets how far ahead the timeline looks, from 1 hour to 48. OK switches between the timeline and the
// headline in words, Start asks for fresh data and Back quits.
//
// This file is the app's loop and its buttons. One timer makes frames; on each it lets the feed ask for data
// that is due, describes what to show, and sends what changed. What the displays look like is in front.js and
// back.js, what has to be sent in screen.js, where the rain comes from in feed.js and sources.js.
import manifest from "./appmeta/manifest.json";
import { draw, loadSettings, loadZone, playSound } from "./bar.js";
import { createFeed } from "./feed.js";
import { createScreen } from "./screen.js";
import { DEFAULTS, readSettings } from "./settings.js";
import { describe } from "./show.js";
import { createZoom } from "./zoom.js";

const APP = manifest.id;

/** A frame while something moves, and while only the rain shimmers. */
const FAST_MS = 125;
const SLOW_MS = 500;
/** The bar's zone changes with daylight saving: ask again this often. */
const ZONE_MS = 30 * 60000;
/** One alert per shower: none again within this long. */
const ALERT_REST_MS = 60 * 60000;
const ALERT_SOUND = "shared/sounds/calendar_event_starts.snd";
const ALERT_LIGHT = "#5B7BFFFF";

const screen = createScreen();

let settings = DEFAULTS;
let feed = null;
let zoom = null;
/** The bar's zone, minutes east of UTC, and when it was last asked. */
let zone = 0;
let zoneAt = 0;
/** Whether the front shows the headline instead of the timeline. */
let inWords = false;
/** When the alert last went off, and the colour the status light still has to blink in. */
let alertedAt = 0;
let light = null;

let startedAt = 0;
let stopped = false;
let timer = 0;
let sending = false;
let unbind = null;

function report(err) {
  console.error(APP + ": " + (err && err.message ? err.message : String(err)));
}

function showAt(now) {
  return describe({
    series: feed.series,
    version: feed.version,
    problem: feed.problem,
    stale: feed.stale(now),
    freshAt: feed.freshAt,
    now,
    zone,
    hours: zoom.length(now),
    window: zoom.hours(),
    labelled: zoom.labelled(now),
    inWords,
    language: settings.language,
    place: settings.place.name,
    frame: Math.floor((now - startedAt) / SLOW_MS),
  });
}

/** Warns once when rain is about to start: the status light, and a sound if wanted. Not on the word of old data. */
function warnOfRain(show) {
  if (!settings.alert || !show.words || show.stale) return;
  const startsIn = show.words.startsIn;
  if (startsIn < 0 || startsIn > settings.alert) return;
  if (alertedAt && show.now - alertedAt < ALERT_REST_MS) return;
  alertedAt = show.now;
  light = ALERT_LIGHT;
  if (settings.sound) playSound(APP, ALERT_SOUND).catch(report);
}

/** The elements that differ from what the displays show. */
function frame(now) {
  const show = showAt(now);
  warnOfRain(show);
  // The status light blinks only with a frame: when a blink is due and nothing changed, the front display is
  // sent once more as it is.
  return screen.changes(show, !zoom.sliding(now), !!light);
}

/** Sends a frame. One the bar refuses is forgotten, so that the next is sent whole, the light with it. */
function send(elements) {
  const blink = light;
  return draw(APP, elements, blink).then(
    (taken) => {
      if (taken && light === blink) light = null;
      if (!taken) screen.forget();
    },
    (err) => {
      screen.forget();
      report(err);
    },
  );
}

function tick() {
  timer = 0;
  if (stopped) return;
  const started = Date.now();
  if (started - zoneAt > ZONE_MS) {
    zoneAt = started;
    loadZone().then((minutes) => (zone = minutes), report);
  }
  let pending = null;
  // Whatever goes wrong in one frame, the next one is still made: a display that froze would be worse.
  try {
    feed.poll();
    zoom.rest(started);
    if (!sending) {
      const elements = frame(started);
      if (elements.length) {
        sending = true;
        pending = send(elements).then(() => (sending = false));
      }
    }
  } catch (err) {
    report(err);
  }
  const schedule = () => {
    if (stopped) return;
    const now = Date.now();
    const every = zoom.sliding(now) || zoom.labelled(now) ? FAST_MS : SLOW_MS;
    // Never at once, even when a frame overran: the bar needs room for its own work.
    timer = setTimeout(tick, Math.max(10, every - (now - started)));
  };
  if (pending) pending.then(schedule);
  else schedule();
}

/** Brings the next frame forward: a button or the wheel should not wait out the slow half second. */
function wake() {
  if (!timer) return;
  clearTimeout(timer);
  timer = setTimeout(tick, 0);
}

function quit() {
  stopped = true;
  if (timer) clearTimeout(timer);
  if (feed) feed.stop();
  // The listener is the last thing keeping the app alive: let this handler return before it goes.
  setTimeout(() => unbind && unbind(), 0);
}

function onInput(event) {
  if (stopped || !event) return;
  // Back works from the first moment, also while the settings are still being read.
  if (event.key === "back" && event.action === "short") quit();
  if (stopped || !feed) return;
  if (event.key === "encoder") {
    inWords = false;
    zoom.turn(event.delta, Date.now());
  } else if (event.action !== "short") return;
  else if (event.key === "ok") inWords = !inWords;
  else if (event.key === "start") feed.refresh();
  else return;
  wake();
}

function main() {
  unbind = listen("input", onInput);
  startedAt = Date.now();
  // Without its settings the app runs on the defaults; without the bar's zone, on UTC.
  const stored = loadSettings(APP).then(readSettings, (err) => {
    report(err);
    return DEFAULTS;
  });
  const zoned = loadZone().catch((err) => {
    report(err);
    return 0;
  });
  Promise.all([stored, zoned]).then(([read, minutes]) => {
    if (stopped) return;
    settings = read;
    zone = minutes;
    zoneAt = Date.now();
    feed = createFeed(settings.place, report);
    zoom = createZoom(settings.zoomStep);
    tick();
  }, report);
}

main();
