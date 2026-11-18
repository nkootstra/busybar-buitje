# Buitje for BUSY Bar

The rain ahead for your spot. On the front display rain hangs down from a time axis, sparse for drizzle and dense for a downpour; the wheel sets how far ahead it looks, from the next hour to the next two days. The back display says what is coming in a sentence and shows the 48 hours as a strip.

![The wheel widens the window from 2 hours to 48 and back, then OK shows the headline](docs/zoom.gif)

The next 2 hours, the next 48, and the headline in words:

![Rain for the next hour, then a dry spell](docs/screenshots/front-1-leds.png)

![Two days of showers](docs/screenshots/front-3-leds.png)

![RAIN, 65 MIN](docs/screenshots/front-4-leds.png)

The back display:

![The headline as a sentence, the place, the 48 hours as a strip, and the sources](docs/screenshots/back-3-large.png)

The pictures are BUSY Bar Emulator's screenshots, taken with live rain for Utrecht. The front display's are drawn here as the LEDs they are on the bar; `screenshots/` has them as they were taken, at the displays' size, 72x16 and 160x80.

## Using it

| Control | What it does |
|---|---|
| Wheel | Sets the window: 1, 2, 3, 5, 9, 12, 18, 24, 36 or 48 hours. Left alone for half a minute it goes back to your default. |
| OK | Switches between the timeline and the headline in two lines, such as DRIZZLE IN / 25 MIN. |
| Start | Asks for fresh data. |
| Back | Leaves the app. |

The status light blinks blue when rain is about to start.

### Settings

| Setting | |
|---|---|
| Place | The spot the rain is shown for; Utrecht until you set it. After detecting it automatically, check that it names your town. |
| Window | How far ahead the timeline looks when the app starts. |
| Rain alert | How long before rain the status light blinks: off, or 5, 10, 15 or 30 minutes. |
| Sound with the alert | Off by default. |
| Language | English or Nederlands. |

The app reads its settings when it starts: start it again after a change.

## Where it works

Anywhere, with more detail in central Europe.

| Where | What you get |
|---|---|
| The Netherlands, Belgium, Germany and the rest of central Europe, with Denmark and southern England | The next 6 hours by the quarter of an hour, then by the hour for the 2 days after. |
| The rest of the world | All 48 hours by the hour. Showers are placed less precisely. |

The app finds out by itself which of the two it is in: the forecast for a place comes with quarters or without. The last line of the back display names the sources in use.

## Where the rain comes from

Weather models, through [Open-Meteo](https://open-meteo.com), in one request every quarter of an hour:

- by the hour: KNMI's HARMONIE model where it reaches (2 km in the Netherlands and Belgium, 5.5 km in central and northern Europe), and other models elsewhere;
- by the quarter of an hour, for the first 6 hours: ICON-D2, of Germany's weather service DWD.

The two models often disagree about the first hours. The app then shows the stronger rain of the two: rain that is shown and does not come costs less than rain that comes unannounced.

These are forecasts, not radar: a shower can come earlier or later than shown, and a small one can be missed. That goes for the rain alert too. The data is under CC BY 4.0.

The bar needs Wi-Fi. Without it the app says so and waits; when the connection drops it keeps showing what it had, marked as old and with the time it is from, for up to 3 hours.

## Building and running

Node 22 or later.

```sh
npm install
npm run build        # dist/io.kootstra.buitje.tgz
npm run app:install  # onto a BUSY Bar connected over USB
npm run app:run
```

Without a BUSY Bar, [BUSY Bar Emulator](https://github.com/busy-app/busybar-emulator) runs it: `busy-emulator dev --once` from this folder.

```sh
npm test       # the series, the headline, the settings, and the built app on a pretend bar
npm run bench  # how long the bar takes for a frame of every kind (needs the emulator running)
```

[AGENTS.md](AGENTS.md) says where each part of the code is and what was measured on the bar.

## License

[MIT](LICENSE)
