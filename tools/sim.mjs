// A pretend BUSY Bar for tests: runs the built app (dist/*.tgz) with the bar's globals replaced by fakes,
// a clock that only moves when a test says so, and the forecast service and the radar's relay answering what
// the test gives.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "http://localhost/api/";
const FORECAST = "http://api.open-meteo.com/";
const NOWCAST = "/v1/rain?";
const DIRECT = "https://anonymous.api.dataplatform.knmi.nl/";
/** What the radar's relay answers for a place the radar has no data for. */
export const NO_RADAR = { run: 1, step: 300, rain: null };
const flush = () => new Promise((done) => setImmediate(done));

/**
 * The code of the built app as one script. The package is unpacked and its `scripts/main.js` joined with the
 * modules it imports, so the tests run what `busy-cli build` produced, not the sources.
 */
export async function builtApp() {
  const dist = join(root, "dist");
  const archive = existsSync(dist) && readdirSync(dist).find((name) => name.endsWith(".tgz"));
  if (!archive) throw new Error("no package in dist/: run `npm run build` first");
  const dir = mkdtempSync(join(tmpdir(), "buitje-sim-"));
  try {
    execFileSync("tar", ["xzf", join(dist, archive), "-C", dir]);
    return await bundle(join(dir, readdirSync(dir)[0], "scripts", "main.js"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pad = (n) => String(n).padStart(2, "0");

/** An XPM2 bitmap as rows of palette characters. */
export function xpmRows(data) {
  const lines = data.split("\n");
  const [, height, colors] = lines[1].split(" ").map(Number);
  return lines.slice(2 + colors, 2 + colors + height);
}

/**
 * Starts `code` on a pretend bar.
 * @param {string} code - the app as one script, from `builtApp()`.
 * @param {object} [options]
 * @param {number} [options.at] - the moment the bar's clock starts at, in ms.
 * @param {number} [options.offsetMin] - the bar's zone, minutes east of UTC.
 * @param {object} [options.settings] - values of the app's settings.
 * @param {string} [options.wifi] - the state of the bar's Wi-Fi; "connected" unless given.
 * @param {object | string | number | null} [options.forecast] - what the forecast service answers: its JSON,
 *   some other text, an HTTP status, or null for a request that fails.
 * @param {object | string | number | null} [options.nowcast] - what the radar's relay answers, in the same
 *   way; that the radar has no data for the place unless given.
 * @param {object | string | number | null | Function} [options.direct] - what KNMI's own map service answers,
 *   in the same way, or a function of the address asked that gives it; a request that fails unless given.
 */
export async function launch(code, options = {}) {
  const { at = Date.UTC(2026, 10, 17, 20, 14), offsetMin = 60, settings = {} } = options;
  let now = at;
  let nextTimer = 1;
  const timers = new Map();

  const bar = {
    /** The front display's bitmap as rows of palette characters, or null. */
    front: null,
    /** The back display's elements by id. */
    back: {},
    sounds: [],
    lights: [],
    errors: [],
    /** The addresses the app asked the forecast service, and the radar's relay, in order. */
    requests: [],
    radarRequests: [],
    /** The addresses the app asked KNMI's own map service, its second way to the radar. */
    directRequests: [],
    /** How many draw requests reached the display. */
    draws: 0,
    settings: { ...settings },
    /** The state of the bar's Wi-Fi; a test may change it while the app runs. */
    wifi: options.wifi || "connected",
    /** What the forecast service answers; a test may change it while the app runs. */
    forecast: options.forecast === undefined ? null : options.forecast,
    /** What the radar's relay answers; a test may change it while the app runs. */
    nowcast: options.nowcast === undefined ? NO_RADAR : options.nowcast,
    /** What KNMI's own map service answers; a request that fails unless given. A test may change it. */
    direct: options.direct === undefined ? null : options.direct,
    /** Calls of the bar's own API that answer 500, by the start of their path; a test may change them. */
    broken: options.broken || [],
    handler: null,
    /** The bar's clock, in ms. */
    get now() {
      return now;
    },
    /** Sets the bar's clock `ms` on, or back; timers keep the time they had left. */
    jump(ms) {
      now += ms;
      for (const timer of timers.values()) timer.at += ms;
    },
    /** Whether anything still keeps the app alive. */
    get alive() {
      return bar.handler !== null || timers.size > 0;
    },
    /** A line of text on the back display. */
    text(id) {
      return bar.back[id] ? bar.back[id].text : null;
    },
    /** Lets `ms` of the bar's time pass, running the timers that fall due. */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        let due = null;
        for (const [id, timer] of timers) if (timer.at <= end && (!due || timer.at < due.at)) due = { id, ...timer };
        if (!due) break;
        timers.delete(due.id);
        now = Math.max(now, due.at);
        due.run();
      }
      now = end;
      await flush();
    },
    async press(key) {
      if (bar.handler) bar.handler({ key, action: "short" });
      await bar.advance(700);
    },
    async wheel(clicks) {
      for (let i = 0; i < Math.abs(clicks); i++) {
        const delta = clicks > 0 ? 1 : -1;
        if (bar.handler) bar.handler({ key: "encoder", action: delta > 0 ? "clockwise" : "counterclockwise", delta });
      }
      await bar.advance(200);
    },
  };

  class BarDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(now);
    }
    static now() {
      return now;
    }
  }

  const reply = (status, body) => {
    const text = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(text),
      json: () => Promise.resolve().then(() => JSON.parse(text)),
    });
  };
  /** The service's answer: a number is an HTTP status, null a request that fails, anything else the body. */
  const answer = (given) => {
    if (given === null) return Promise.reject(new Error("Inactivity timeout"));
    if (typeof given === "number") return reply(given, "Not found");
    return reply(200, given);
  };

  const fetch = (url, init = {}) => {
    url = String(url);
    const method = init.method || "GET";
    if (url.startsWith(FORECAST)) {
      bar.requests.push(url);
      return answer(bar.forecast);
    }
    if (url.startsWith(DIRECT)) {
      bar.directRequests.push(url);
      return answer(typeof bar.direct === "function" ? bar.direct(url) : bar.direct);
    }
    if (url.indexOf(NOWCAST) > 0) {
      bar.radarRequests.push(url);
      return answer(bar.nowcast);
    }
    if (!url.startsWith(API)) return Promise.reject(new Error("no network: " + url));
    const path = url.slice(API.length);
    if (bar.broken.some((start) => path.startsWith(start))) return reply(500, { error: "broken" });
    if (path === "time") {
      const local = new Date(now + offsetMin * 60000).toISOString().slice(0, 19);
      const abs = Math.abs(offsetMin);
      return reply(200, { timestamp: local + (offsetMin < 0 ? "-" : "+") + pad(Math.floor(abs / 60)) + ":" + pad(abs % 60) });
    }
    if (path.startsWith("apps/settings")) return reply(200, { values: bar.settings });
    if (path === "wifi/status") return reply(200, { state: bar.wifi });
    if (path === "audio/play") {
      bar.sounds.push(JSON.parse(init.body).stock_path);
      return reply(200, null);
    }
    if (path === "display/draw" && method === "POST") {
      const body = JSON.parse(init.body);
      bar.draws++;
      for (const el of body.elements) {
        if (el.display === "back") bar.back[el.id] = el;
        else if (el.id === "front") bar.front = xpmRows(el.data);
      }
      if (body.led_notification_color) bar.lights.push(body.led_notification_color);
      return reply(200, null);
    }
    return reply(404, null);
  };

  const listen = (type, handler) => {
    if (type !== "input") throw new TypeError("unknown event type");
    if (bar.handler) throw new TypeError("handler already attached");
    bar.handler = handler;
    return () => {
      if (bar.handler === handler) bar.handler = null;
    };
  };
  const setTimeout = (run, ms = 0) => {
    const id = nextTimer++;
    timers.set(id, { at: now + ms, run });
    return id;
  };
  const clearTimeout = (id) => void timers.delete(id);
  const console = { log() {}, warn() {}, error: (...args) => bar.errors.push(args.join(" ")) };

  new Function("Date", "fetch", "listen", "setTimeout", "clearTimeout", "console", code)(
    BarDate,
    fetch,
    listen,
    setTimeout,
    clearTimeout,
    console,
  );
  await bar.advance(700);
  return bar;
}
