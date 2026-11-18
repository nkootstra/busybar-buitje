# AGENTS.md

Instructions for AI coding agents working on Buitje (`io.kootstra.buitje`), a JavaScript app for the BUSY Bar that shows the rain ahead for one spot. [README.md](./README.md) says what it does and how to run it.

The app runs on the bar itself, in the firmware's embedded JerryScript runtime. It is not Node.js and not a browser: no `fs`, `process`, `document` or `window`. `fetch`, timers, `Date`, `JSON`, typed arrays and standard ECMAScript are there.

## Where things are

Each file has one reason to change. Put a change where that reason lives.

| File | Changes when |
|---|---|
| `src/main.js` | the buttons or the loop change: what a press does, how often a frame is drawn |
| `src/feed.js` | when a source is asked, and what happens when the connection or a source fails |
| `src/sources.js` | a service changes: its address, or what its answers look like |
| `src/rain.js` | how the sources are joined into one series, or how it is cut into columns |
| `src/headline.js` | what the rain ahead comes to in words |
| `src/texts.js` | any wording, or a new language |
| `src/zoom.js` | the window: its lengths, its slide, its return when left alone |
| `src/settings.js` | a setting, with `src/appmeta/settings.json` |
| `src/show.js` | the displays need to be told something new |
| `src/screen.js` | what has to be sent: which display changed, and when the back may follow |
| `src/front.js` | what the front display looks like |
| `src/back.js` | what the back display looks like |
| `src/canvas.js` | the palette, the font, how a picture becomes XPM2 |
| `src/bar.js` | a call to the bar's own HTTP API |

`main.js` describes what to show with `describe` from `show.js`, one plain object, and hands it to `drawFront` and to `backKey` / `backElements`. The benchmark and the preview tool make theirs with the same `describe` and call the same functions, so they draw what the app draws. When a display needs something new, add it there.

Imports run one way: `main` uses everything; `feed`, `front`, `back`, `show` and `settings` use `sources`, `headline`, `texts`, `zoom`, `canvas` and `bar`; all of them may use `rain.js`, which imports nothing.

## Rain is a level

Everything keeps rain as a whole number from 0 to 255 on the radar feed's own logarithmic scale: 0 is dry, and `10^((level - 109) / 32)` is mm an hour. `WET` (0.1 mm/h), `RAIN` (0.5) and `HEAVY` (4) in `rain.js` are the levels that matter. `sources.js` turns the model's mm into levels once, when an answer arrives; nothing after that computes with mm.

## The sources

- **Radar:** Buienradar's raintext, 2 hours in 5-minute steps, for the Netherlands, Belgium and a strip across their borders (Luxembourg, Cologne and Lille answered on 18 November 2026; London and Copenhagen did not). It needs HTTPS: the plain address redirects, and the bar follows no redirects. Elsewhere it answers 404, and the app then uses the model's 15-minute values for the first hours.
- **Model:** Open-Meteo with `models=knmi_seamless`, 48 hours by the hour, over plain HTTP: a TLS handshake takes the bar 1.5 s. An hourly value is the rain of the hour *before* its time. It answers for any place in the world: KNMI's HARMONIE at 2 km in the Netherlands and Belgium and at 5.5 km in central and northern Europe, other models elsewhere (Madrid, New York, Tokyo, Sydney and Paramaribo all answered). README.md has the table of what a person gets where: keep it true.
- The radar's first line can be the step now is in or the next one. Its lines carry clock times without a date: `buildSeries` places them by the minute of the hour, so the bar's own zone does not matter. An answer older than 15 minutes can no longer be placed and is not used.
- **A series knows how far it reaches** (`known`). Past that the sources said nothing, which is not the same as dry: the headline speaks only of what is known ("Dry for the next 2 hours" with the radar alone), the timeline's axis ends there, and the back strip is dark past it. Keep it that way in anything that reads a series.
- Keep the source line on the back display. It is the attribution the data's licences ask for.
- Before publishing, check Buienradar's terms for using the raintext feed in an app.

## When the connection fails

`feed.js` asks the bar for its Wi-Fi state before it asks the internet for anything.

- **No Wi-Fi** (`disconnected`, `connecting`, `reconnecting`, `disconnecting`): nothing is requested, the displays say so, and the Wi-Fi is looked at again every minute. Any other answer, or none, counts as connected: the requests will tell.
- **Wi-Fi, but a source does not answer:** it is asked again after 1 minute, then 2, then 4, doubling up to its usual pace. One request per source at a time.
- **Data on show when it fails:** it stays. After 20 minutes it gets a red dot on the front, in both views, and the back display says what is wrong and when the data is from, in the line that names the window. The credit line stays.
- **The data is taken off** when it has nothing ahead of now any more, or after 3 hours without an answer. The back display is then wiped whole: the bar keeps an element until another with its id comes.
- `feed.problem` is worked out from the state of each source, not set by the last request: one source failing must not hide that the other is fine, or the reverse.

## Speed and memory: measured, not guessed

Measured on BUSY Bar Emulator, which runs apps at the bar's speed (firmware 1.3.1). `npm run bench` repeats it; run it after changing how anything is drawn.

| Kind of frame | Time |
|---|---|
| Resting: only the rain shimmers | 50 ms |
| The window sliding, with its name on show | 119 ms |
| Both displays whole, when new data has come | 212 ms |
| Joining fresh answers into a series, twice every 5 minutes | 22 ms |

Sending the front display takes the bar about 45 ms of each, whatever the app does. A frame of the slide must stay under 125 ms for 8 frames a second.

- **A picture is painted once.** `startFrom` in `front.js` paints only when the picture's name changes. A frame draws its few shimmering pixels straight onto the picture with `drawOver`, and the next frame first puts them back: copying all 1,152 pixels for every frame cost 4 ms. Anything a frame adds must go through `drawOver`.
- **Count in whole numbers on every frame.** The runtime allocates memory for every fraction. Bar length and grain density are lookup tables by level for that reason.
- **The headline is worked out once a minute.** Finding the next rain walks the series, all of it on dry days: 20 ms.
- **`describe` writes its fields out one by one.** It runs on every frame, and walking an object's keys is slow.
- **The window's name is part of the picture**, as is "DRY NEXT 5H": text drawn on every frame cost 20 ms. The name's pixels are found once per name, and the rain is kept out of its corner rather than painted and covered.
- **The series is filled hour by hour** (`fillFrom` in `rain.js`), not step by step: asking each of 576 steps for its hour took 108 ms.
- **The back display's strip is made a row from the row above:** rain hangs from the top, so each row only ends some bars. Building it pixel by pixel made new data cost 440 ms.
- **The benchmark makes its frames through `screen.js`, as the app does.** Three times it had measured less than the app did, because it assembled frames its own way: without the headline, without the window's name, without rebuilding the strip. Keep what the app does per frame inside `screen.js` and below, where the benchmark gets it for free.
- **The back display waits until the window has stopped sliding**, and its strip of rain is built once per data update: a turn of the wheel only moves the frame.
- The app peaks at 90 KiB of the default 128 KiB heap. Watch it: `npm run bench` prints the peak, and the emulator logs it when the app stops.

## Device rules

- `listen("input", handler)` takes one handler; it returns an unbind function. Use the `short` action for a press.
- The app stays alive while a listener, a timer or a `fetch` is pending. Back clears the timer and unbinds from a `setTimeout`, so that the handler returns first.
- Keep one display request in flight; send only what changed.
- A request ends after 5 seconds without data.
- Settings are read once, at start. The `place` setting is the bar's `geolocation` type: `{ mode, name, lat, lon }`.
- Text on the displays is printable ASCII.

## Tests and tools

- `npm test` builds the app, then runs the series, the headline, the settings and the built app on a pretend bar (`tools/sim.mjs`): its clock moves only when a test says so, its Wi-Fi and its sources answer what the test gives.
- `tests/stress.test.mjs` tries to break it: answers no service should give, settings no page should save, mashed buttons, jumping clocks, a week of random failures. Add to its lists when a new way to break the app turns up.
- `tests/fixtures` holds live answers of both sources, taken on 17 November 2026 at 21:14. The app tests are written for that rain: `sh tools/fetch-fixtures.sh` takes new answers, and the tests then need new expectations.
- `node tools/render.mjs` writes `previews/screens.png` from the fixtures, with the app's own drawing.
- `node tools/make-icons.mjs` writes the two icons in `src/appmeta`.
- `node tools/readme-pictures.mjs` writes `docs/screenshots` from `screenshots/`: the front display's as LEDs, the way the bar looks, and the back's enlarged. Run it after taking new screenshots with `busy-emulator screenshot`. The catalog takes the ones in `screenshots/`, never these.
