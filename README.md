# Buitje for BUSY Bar

The rain ahead for your spot. On the front display rain hangs down from a time axis, sparse for drizzle and dense for a downpour; the wheel sets how far ahead it looks, from the next hour to the next two days. The back display says what is coming in a sentence and shows the 48 hours as a strip.

![The wheel widens the window from 2 hours to 48 and back, then OK shows the headline](docs/zoom.gif)

The next 2 hours, the next 48, and the headline in words:

![Rain for the next hour, then a dry spell](docs/screenshots/front-1.png)

![Two days of showers](docs/screenshots/front-3.png)

![RAIN, 65 MIN](docs/screenshots/front-4.png)

The back display:

![The headline as a sentence, the place, the 48 hours as a strip, and the sources](docs/screenshots/back-3.png)

The pictures are the bar's own, from BUSY Bar Emulator with live rain for Utrecht, enlarged; `screenshots/` has them at the displays' size, 72x16 and 160x80.

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

## Where the rain comes from

- The next 2 hours, in steps of 5 minutes: Buienradar's radar nowcast, in the Netherlands and Belgium.
- The 2 days after: KNMI's HARMONIE model through [Open-Meteo](https://open-meteo.com), which also stands in for the radar elsewhere.

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
