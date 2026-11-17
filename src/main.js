// Buitje: the rain ahead for one spot. A timeline on the front display, the overview on the back.
//
// The wheel sets how far ahead the timeline looks, from 1 hour to 48. OK switches between the timeline and the
// headline in words, Start asks for fresh data and Back quits. One timer paints frames; the same timer starts
// the requests for new data when they are due.
import manifest from "./appmeta/manifest.json";
import { backText, bitmap, draw, loadSettings, loadTime, playSound } from "./bar.js";
import { createCanvas, toXpm } from "./canvas.js";
import { headline } from "./headline.js";
import { STEP_MS, buildSeries, sampleColumns } from "./rain.js";
import { MAP_W, drawChart, drawHeadline, drawMessage, mapXpm } from "./screens.js";
import { loadModel, loadNowcast } from "./sources.js";

const APP = manifest.id;

/** The windows the wheel steps through, in hours. At 2 hours a step of the radar is exactly 3 columns. */
const ZOOMS = [1, 2, 3, 5, 9, 12, 18, 24, 36, 48];
/** A frame while something moves, and while only the rain shimmers. */
const FAST_MS = 125;
const SLOW_MS = 500;
/** How long the window slides to its new length, its label stays, and the wheel may rest before it goes back. */
const ZOOM_MS = 750;
const LABEL_MS = 1500;
const IDLE_MS = 30000;

/** How often each source is asked, how soon again after a failure, and when data counts as old. */
const NOWCAST_MS = 5 * 60000;
const MODEL_MS = 60 * 60000;
const QUARTERS_MS = 15 * 60000;
const RETRY_MS = 60000;
const STALE_MS = 20 * 60000;
const TIME_MS = 30 * 60000;
/** One alert per shower: none again within this long. */
const ALERT_REST_MS = 60 * 60000;
const ALERT_SOUND = "shared/sounds/calendar_event_starts.snd";
const ALERT_LIGHT = "#5B7BFFFF";

/** The back display: its left edge, and its three greys. */
const LEFT = 4;
const WHITE = "#FFFFFFFF";
const LIGHT = "#C8C8C8FF";
const GREY = "#808080FF";
/** How many characters of the back display's font fit beside each other. */
const LINE = 34;

const TEXTS = {
  en: {
    loading: "LOADING",
    none: "NO DATA",
    next: (hours) => "NEXT " + hours + "H",
    dry: (hours) => "DRY NEXT " + hours + "H",
    window: (hours) => "Next " + hours + (hours === 1 ? " hour" : " hours") + " on the front",
    waiting: "Asking for the rain...",
    failed: "No rain data. Start: try again",
    now: "now",
    tomorrow: "tomorrow",
  },
  nl: {
    loading: "LADEN",
    none: "GEEN DATA",
    next: (hours) => "KOMENDE " + hours + "U",
    dry: (hours) => "DROOG KOMENDE " + hours + "U",
    window: (hours) => "Komende " + hours + " uur op de voorkant",
    waiting: "Regen wordt opgehaald...",
    failed: "Geen regendata. Start: opnieuw",
    now: "nu",
    tomorrow: "morgen",
  },
};

// --------------------------------------------------------------------------------------------------- state

const front = createCanvas(72, 16);
const columns = new Uint8Array(72);

/** Where the rain is shown when no place is set: the middle of the Netherlands. */
const HOME = { name: "Utrecht", lat: 52.09, lon: 5.12 };

let settings = { lat: HOME.lat, lon: HOME.lon, place: HOME.name, zoom: 1, alert: 15, sound: false, language: "en" };
let texts = TEXTS.en;
/** The bar's zone, minutes east of UTC, and when it was last asked. */
let offset = 0;
let offsetAt = 0;

/** What the sources last gave, and the series made of them. `nowcast` is false where there is no radar. */
let nowcast = null;
let model = null;
let series = null;
/** Counts up with every new series, so that pictures made from the old one are painted anew. */
let version = 0;
/** When each source was last asked and last answered, and how many requests are under way. */
let nowcastAskedAt = 0;
let modelAskedAt = 0;
let answeredAt = 0;
let asking = 0;
let failed = false;

/** The window: its step in ZOOMS, and the slide from the length it had (`zoomFrom`) since `zoomAt`. */
let zoom = 1;
let zoomFrom = 2;
let zoomAt = 0;
let touchedAt = 0;
/** Whether the front shows the headline instead of the timeline. */
let inWords = false;
/** The picture the columns were last worked out for, and whether any of them has rain. */
let sampledFor = "";
let rainInWindow = false;

let alertedAt = 0;
let light = null;
let startedAt = 0;
let stopped = false;
let timer = 0;
let sending = false;
let shownFront = null;
let shownBack = null;
let unbind = null;

function report(err) {
  console.error(APP + ": " + (err && err.message ? err.message : String(err)));
}

// ---------------------------------------------------------------------------------------------------- data

function rebuild(now) {
  series = buildSeries(now, offset, nowcast || null, model);
  version++;
}

/** Asks the sources that are due. A failure keeps what there is and tries again a minute later. */
function refresh(now) {
  if (now - nowcastAskedAt >= NOWCAST_MS && nowcast !== false) {
    nowcastAskedAt = now;
    asking++;
    loadNowcast(settings.lat, settings.lon)
      .then(
        (answer) => {
          nowcast = answer;
          answeredAt = Date.now();
          failed = false;
          // No radar here: the model's quarters stand in, so ask it for them now.
          if (answer === false) modelAskedAt = 0;
          rebuild(Date.now());
        },
        (err) => {
          report(err);
          failed = true;
          nowcastAskedAt = Date.now() - NOWCAST_MS + RETRY_MS;
        },
      )
      .then(() => asking--);
  }
  const every = nowcast === false ? QUARTERS_MS : MODEL_MS;
  if (now - modelAskedAt >= every) {
    modelAskedAt = now;
    asking++;
    loadModel(settings.lat, settings.lon, nowcast === false)
      .then(
        (answer) => {
          model = answer;
          if (nowcast === false) answeredAt = Date.now();
          failed = false;
          rebuild(Date.now());
        },
        (err) => {
          report(err);
          failed = true;
          modelAskedAt = Date.now() - every + RETRY_MS;
        },
      )
      .then(() => asking--);
  }
}

/** Warns once when rain is about to start: the status light, and a sound if wanted. */
function watch(now, words) {
  if (!settings.alert || words.startsIn < 0 || words.startsIn > settings.alert) return;
  if (alertedAt && now - alertedAt < ALERT_REST_MS) return;
  alertedAt = now;
  light = ALERT_LIGHT;
  if (settings.sound) playSound(APP, ALERT_SOUND).catch(report);
}

// -------------------------------------------------------------------------------------------------- frames

/** The length of the window now, in hours: it slides from the old length to the new one. */
function windowHours(now) {
  const to = ZOOMS[zoom];
  const p = (now - zoomAt) / ZOOM_MS;
  if (p >= 1) return to;
  // Halfway between 2 and 8 hours is 4, not 5: each step of the slide is the same factor.
  return Math.exp(Math.log(zoomFrom) + (Math.log(to) - Math.log(zoomFrom)) * p);
}

function moving(now) {
  return now - zoomAt < ZOOM_MS || now - touchedAt < LABEL_MS;
}

function paintFront(now, words) {
  if (!series) {
    drawMessage(front, failed && !asking ? texts.none : texts.loading);
    return;
  }
  if (inWords) {
    drawHeadline(front, words.top, words.bottom, words.wet || words.startsIn >= 0);
    return;
  }
  const hours = windowHours(now);
  // The picture is the same until now has moved on by a column, the data changed or the window did.
  const column = Math.floor(now / ((hours * 3600000) / 72));
  const key = version + "|" + hours.toFixed(2) + "|" + column;
  const local = now + offset * 60000;
  if (key !== sampledFor) {
    sampledFor = key;
    sampleColumns(series, now, hours, columns);
    rainInWindow = false;
    for (let c = 0; c < 72 && !rainInWindow; c++) rainInWindow = columns[c] >= 70;
  }
  drawChart(front, key, columns, hours, (local / 60000) % 1440, Math.floor((now - startedAt) / SLOW_MS), {
    label: now - touchedAt < LABEL_MS ? texts.next(ZOOMS[zoom]) : "",
    dry: rainInWindow ? "" : texts.dry(ZOOMS[zoom]),
    stale: now - answeredAt > STALE_MS,
  });
}

/** A sentence over at most two lines of the back display. */
function wrap(sentence) {
  if (sentence.length <= LINE) return [sentence, ""];
  const cut = sentence.lastIndexOf(" ", LINE);
  return [sentence.slice(0, cut), sentence.slice(cut + 1)];
}

function line(id, value, y, color, x) {
  return backText(id, value || " ", x || LEFT, y, color);
}

/** The back display's elements, or none when it already shows them. */
function backElements(now, words) {
  if (!series) {
    const message = failed && !asking ? texts.failed : texts.waiting;
    if (message === shownBack) return [];
    shownBack = message;
    return [line("head1", settings.place, 6, WHITE), line("head2", message, 20, LIGHT)];
  }
  // It follows the window the wheel chose, not every step of the slide, and the quarter of an hour.
  const quarter = Math.floor(now / (15 * 60000));
  const key = version + "|" + zoom + "|" + words.full + "|" + quarter;
  if (key === shownBack) return [];
  shownBack = key;

  const lines = wrap(words.full);
  // Where the strip crosses midnight, the next day is named.
  const toMidnight = 1440 - (Math.floor((now + offset * 60000) / 60000) % 1440);
  const midnight = LEFT + Math.round((MAP_W * toMidnight) / 2880);
  return [
    line("head1", lines[0], 4, WHITE),
    line("head2", lines[1] || settings.place, 15, lines[1] ? WHITE : GREY),
    bitmap("map", mapXpm(series, now, ZOOMS[zoom], version + "|" + quarter), LEFT, 29, "back"),
    line("now", midnight > LEFT + 24 ? texts.now : " ", 45, GREY),
    line("day", texts.tomorrow, 45, GREY, midnight),
    line("window", texts.window(ZOOMS[zoom]), 57, LIGHT),
    line("source", series.radar ? "Buienradar + KNMI via Open-Meteo" : "Open-Meteo", 69, GREY),
  ];
}

function frame(now) {
  const words = series ? headline(series, now, offset, settings.language) : null;
  if (words) watch(now, words);
  paintFront(now, words);
  const elements = [];
  const xpm = toXpm(front);
  if (xpm !== shownFront) {
    shownFront = xpm;
    elements.push(bitmap("front", xpm, 0, 0, "front"));
  }
  const back = backElements(now, words);
  for (let i = 0; i < back.length; i++) elements.push(back[i]);
  return elements;
}

/** Sends a frame. One the bar refuses is forgotten, so that the next is sent whole. */
function send(elements) {
  const blink = light;
  light = null;
  return draw(APP, elements, blink).then(
    (taken) => {
      if (!taken) shownFront = shownBack = null;
    },
    (err) => {
      shownFront = shownBack = null;
      report(err);
    },
  );
}

function tick() {
  timer = 0;
  if (stopped) return;
  const started = Date.now();
  if (started - offsetAt > TIME_MS) {
    offsetAt = started;
    loadTime().then((stamp) => (offset = zoneOf(stamp)), report);
  }
  refresh(started);
  // The wheel left alone: back to the window the settings name.
  if (touchedAt && started - touchedAt > IDLE_MS && zoom !== settings.zoom) setZoom(settings.zoom, started, false);

  let pending = null;
  if (!sending) {
    const elements = frame(started);
    if (elements.length) {
      sending = true;
      pending = send(elements).then(() => (sending = false));
    }
  }
  const schedule = () => {
    if (stopped) return;
    const every = moving(Date.now()) ? FAST_MS : SLOW_MS;
    timer = setTimeout(tick, Math.max(10, every - (Date.now() - started)));
  };
  if (pending) pending.then(schedule);
  else schedule();
}

// --------------------------------------------------------------------------------------------------- input

/** Minutes east of UTC from an ISO 8601 time such as 2026-12-07T08:15:00+01:00. */
function zoneOf(stamp) {
  const m = /([+-])(\d\d):?(\d\d)$/.exec(String(stamp));
  if (!m) return 0;
  const minutes = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
  return m[1] === "-" ? -minutes : minutes;
}

function setZoom(step, now, byHand) {
  const next = Math.max(0, Math.min(ZOOMS.length - 1, step));
  if (next !== zoom) {
    zoomFrom = windowHours(now);
    zoomAt = now;
    zoom = next;
  }
  touchedAt = byHand ? now : 0;
  // The next frame is due at once, not after the slow wait.
  if (timer) {
    clearTimeout(timer);
    timer = setTimeout(tick, 0);
  }
}

function quit() {
  stopped = true;
  if (timer) clearTimeout(timer);
  // The listener is the last thing keeping the app alive: let this handler return before it goes.
  setTimeout(() => unbind && unbind(), 0);
}

function onInput(event) {
  if (stopped) return;
  const now = Date.now();
  if (event.key === "encoder") {
    inWords = false;
    setZoom(zoom + event.delta, now, true);
  } else if (event.action !== "short") return;
  else if (event.key === "ok") inWords = !inWords;
  else if (event.key === "start") nowcastAskedAt = modelAskedAt = 0;
  else if (event.key === "back") quit();
}

/** The settings as the app uses them; anything missing or odd falls back to the default. */
function readSettings(values) {
  const place = values.place || {};
  const fixed = typeof place.lat === "number" && typeof place.lon === "number";
  const zoomAt = ZOOMS.indexOf(parseInt(values.zoom, 10));
  const lead = parseInt(values.alert, 10);
  return {
    lat: fixed ? place.lat : HOME.lat,
    lon: fixed ? place.lon : HOME.lon,
    place: fixed && place.name ? String(place.name) : HOME.name,
    zoom: zoomAt < 0 ? 1 : zoomAt,
    alert: values.alert === undefined ? 15 : lead > 0 ? lead : 0,
    sound: values.sound === true,
    language: values.language === "nl" ? "nl" : "en",
  };
}

function main() {
  unbind = listen("input", onInput);
  startedAt = Date.now();
  // Without its settings the app runs on the defaults; without the bar's zone, on UTC.
  const stored = loadSettings(APP).catch((err) => {
    report(err);
    return {};
  });
  const zone = loadTime().then(zoneOf, (err) => {
    report(err);
    return 0;
  });
  Promise.all([stored, zone]).then(([values, minutes]) => {
    settings = readSettings(values);
    texts = TEXTS[settings.language];
    zoom = settings.zoom;
    zoomFrom = ZOOMS[zoom];
    offset = minutes;
    offsetAt = Date.now();
    tick();
  }, report);
}

main();
