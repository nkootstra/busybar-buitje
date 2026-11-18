# Privacy

Buitje shows the rain for one place. To do that it sends that place to the services the rain comes from. This page says exactly what is sent, to whom, and what is kept.

## What the app sends

Only the coordinates of the place in its settings, rounded to two decimals, which is about a kilometre. As with any request over the internet, the service also sees the IP address the request comes from.

Nothing else leaves the bar: no name, no account, no device number, no usage statistics. The place's name, the other settings and everything the app shows stay on the bar.

## Who receives it

| Service | When | What for |
|---|---|---|
| [Open-Meteo](https://open-meteo.com) (`api.open-meteo.com`) | Every quarter of an hour | The weather models' forecast. Their [terms and privacy](https://open-meteo.com/en/terms). |
| The Buitje relay (`buitje.kootstra.io`) | Every 5 minutes, only for a place the Dutch rain radar covers | KNMI's radar nowcast for the place's square kilometre. |
| [KNMI](https://www.knmi.nl) (`anonymous.api.dataplatform.knmi.nl`) | Only when the relay does not answer, at most every 10 minutes | The same radar nowcast, straight from KNMI. Their [privacy statement](https://www.knmi.nl/privacy). |

## The relay

The relay is run by the app's author, Niels Kootstra, as a Cloudflare Worker. It reads KNMI's radar pictures and answers with the rain for the square asked for.

- It keeps nothing about a request: no log of its own, no database, and the coordinates are not stored.
- Cloudflare, which runs it, processes the request and keeps its usual operational records, such as request counts and, for a short time, logs that can include the IP address. See [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
- It sets no cookies and does no tracking.

## Not sending a place

The app cannot show rain without asking for a place. If you do not want your own coordinates sent, set the place to a town centre nearby: the app then sends that.

## Questions

Open an issue in the app's repository, [github.com/nkootstra/busybar-buitje](https://github.com/nkootstra/busybar-buitje/issues).

Last changed on 18 November 2026.
