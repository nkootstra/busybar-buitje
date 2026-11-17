// A pretend BUSY Bar for tests: runs the built app (dist/*.tgz) with the bar's globals replaced by fakes,
// a clock that only moves when a test says so, and the two rain sources answering from what the test gives.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "http://localhost/api/";
const RADAR = "https://gpsgadget.buienradar.nl/";
const MODEL = "http://api.open-meteo.com/";
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
 * @param {string | number | null} [options.radar] - what the radar answers: its text, an HTTP status, or null
 *   for a request that fails.
 * @param {object | number | null} [options.model] - what the model answers: its JSON, an HTTP status, or null.
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
    /** The addresses the app asked outside the bar, in order. */
    requests: [],
    /** How many draw requests reached the display. */
    draws: 0,
    settings: { ...settings },
    /** What the sources answer; a test may change them while the app runs. */
    radar: options.radar === undefined ? null : options.radar,
    model: options.model === undefined ? null : options.model,
    handler: null,
    get now() {
      return now;
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
    async press(key, action = "short") {
      if (bar.handler) bar.handler({ key, action });
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
  /** A source's answer: a number is an HTTP status, null a request that fails, anything else the body. */
  const answer = (source) => {
    if (source === null) return Promise.reject(new Error("Inactivity timeout"));
    if (typeof source === "number") return reply(source, "Not found");
    return reply(200, source);
  };

  const fetch = (url, init = {}) => {
    url = String(url);
    const method = init.method || "GET";
    if (url.startsWith(RADAR)) {
      bar.requests.push(url);
      return answer(bar.radar);
    }
    if (url.startsWith(MODEL)) {
      bar.requests.push(url);
      return answer(bar.model);
    }
    if (!url.startsWith(API)) return Promise.reject(new Error("no network: " + url));
    const path = url.slice(API.length);
    if (path === "time") {
      const local = new Date(now + offsetMin * 60000).toISOString().slice(0, 19);
      const abs = Math.abs(offsetMin);
      return reply(200, { timestamp: local + (offsetMin < 0 ? "-" : "+") + pad(Math.floor(abs / 60)) + ":" + pad(abs % 60) });
    }
    if (path.startsWith("apps/settings")) return reply(200, { values: bar.settings });
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
