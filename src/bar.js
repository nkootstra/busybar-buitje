// The bar's HTTP API, as far as the app uses it. Every call is a request to the bar's own web server.
const API = "http://localhost/api/";

function call(method, path, body) {
  const init =
    body === undefined
      ? { method }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  return fetch(API + path, init).then((res) =>
    res.text().then((txt) => {
      if (!res.ok) throw new Error(method + " " + path + ": HTTP " + res.status);
      return txt ? JSON.parse(txt) : null;
    }),
  );
}

/** The values of the app's settings, as the person set them. */
export function loadSettings(app) {
  return call("GET", "apps/settings?app_id=" + encodeURIComponent(app)).then((doc) => (doc && doc.values) || {});
}

/** The bar's time, as an ISO 8601 timestamp with its zone. */
export function loadTime() {
  return call("GET", "time").then((answer) => answer && answer.timestamp);
}

/** Plays one of the bar's own sounds. */
export function playSound(app, path) {
  return call("POST", "audio/play", { application_name: app, stock_path: path });
}

/** A bitmap element for a display, from the XPM2 text of a canvas. */
export function bitmap(id, xpm, x, y, display) {
  return { id, type: "xpmbitmap", data: xpm, x, y, align: "top_left", display };
}

/** A line of text for the back display. */
export function backText(id, text, x, y, color) {
  return { id, type: "text", text, x, y, font: "small", color, align: "top_left", display: "back" };
}

/**
 * Sends elements to the displays; `light`, when given, blinks the status light in that colour.
 * Resolves to whether the bar took them.
 */
export function draw(app, elements, light) {
  const body = { application_name: app, priority: 50, elements };
  if (light) body.led_notification_color = light;
  return fetch(API + "display/draw", { method: "POST", body: JSON.stringify(body) }).then((res) => res.status === 200);
}
