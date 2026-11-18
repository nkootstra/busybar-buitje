// What the rain ahead comes to, in words: "Drizzle for about 45 minutes", "Dry until 22:35".
import { HEAVY, HOURS, RAIN, STEPS, STEP_MS, WET } from "./rain.js";
import { clock, textsFor } from "./texts.js";

const DAY_MS = 86400000;
/** Up to this many minutes a length of time is said in minutes, from here on in hours. */
const IN_HOURS_FROM = 90;
/** A forecast that reaches this far is said to reach "2 days": the model's last hours come and go with the hour. */
const TWO_DAYS_FROM = (HOURS - 2) * 60;

/** 0 for drizzle, 1 for rain, 2 for heavy rain. */
function kindOf(level) {
  return level < RAIN ? 0 : level < HEAVY ? 1 : 2;
}

/** A length of time as people say it: to 5 minutes up to an hour and a half, then to half hours, then hours. */
function rounded(minutes) {
  if (minutes < IN_HOURS_FROM) return Math.max(5, Math.round(minutes / 5) * 5);
  if (minutes < 360) return Math.round(minutes / 30) * 30;
  return Math.round(minutes / 60) * 60;
}

/** A rounded length of time in a sentence: "45 minutes", "1.5 hours". */
function spoken(minutes, words) {
  if (minutes < IN_HOURS_FROM) return minutes + words.minutes;
  const hours = minutes / 60;
  return (hours % 1 ? hours.toFixed(1) : String(hours)) + (hours === 1 ? words.hour : words.hours);
}

/** A rounded length of time on the front display: "45 MIN", "2 HRS". */
function short(minutes, words) {
  return minutes < IN_HOURS_FROM ? minutes + words.front.min : Math.round(minutes / 60) + words.front.hrs;
}

/** The last headline made, and what it was made for. */
let kept = null;

/**
 * The headline for the rain from `now` on.
 *
 * Its wording changes with the minute at most, and finding the next rain means walking the series, all of it
 * when the days are dry: 20 ms on the bar. The answer for this series and this minute is kept, because the app
 * asks on every frame.
 *
 * @param {{ base: number, levels: Uint8Array, known: number }} series - from buildSeries.
 * @param {number} now - the moment, in ms.
 * @param {number} zone - the bar's zone, minutes east of UTC, for clock times.
 * @param {string} language - "en" or "nl".
 * @returns {{ full: string, top: string, bottom: string, wet: boolean, startsIn: number }} `full` is a sentence
 *   for the back display, `top` and `bottom` two short lines for the front. `startsIn` is the minutes until rain
 *   starts, or -1 when it rains now or stays dry for the next 2 hours.
 */
export function headline(series, now, zone, language) {
  const minute = Math.floor(now / 60000);
  if (kept && kept.series === series && kept.minute === minute && kept.zone === zone && kept.language === language) {
    return kept.words;
  }
  kept = { series, minute, zone, language, words: phrase(series, now, zone, textsFor(language)) };
  return kept.words;
}

function phrase(series, now, zone, texts) {
  const words = texts.headline;
  const levels = series.levels;
  // Past `known` the sources said nothing: the headline speaks only of what is known.
  const end = Math.min(STEPS, series.known);
  const first = Math.max(0, Math.floor((now - series.base) / STEP_MS));
  const wetAt = (i) => i < end && levels[i] >= WET;
  /** Minutes from now until step `step` begins: now is seldom at the start of a step. */
  const minutesTo = (step) => Math.max(0, (series.base + step * STEP_MS - now) / 60000);

  /** How long the spell that starts at step `from` lasts, and how strong it gets. */
  const spell = (from) => {
    let stop = from;
    let peak = 0;
    while (wetAt(stop)) {
      if (levels[stop] > peak) peak = levels[stop];
      stop++;
    }
    return { stop, kind: kindOf(peak) };
  };

  /** How far the forecast reaches from now, as a sentence says it and as the front display does. */
  const horizon = () => {
    const minutes = minutesTo(end);
    if (minutes >= TWO_DAYS_FROM) return { span: words.twoDays, short: words.front.twoDays };
    const length = rounded(minutes);
    return { span: spoken(length, words), short: short(length, words) };
  };

  if (wetAt(first)) {
    const { stop, kind } = spell(first);
    if (stop >= end) {
      const reach = horizon();
      return { full: words.allTheWay(words.kinds[kind], reach.span), top: words.short[kind], bottom: reach.short, wet: true, startsIn: -1 };
    }
    const minutes = rounded(minutesTo(stop));
    return { full: words.lasting(words.kinds[kind], spoken(minutes, words)), top: words.short[kind], bottom: short(minutes, words), wet: true, startsIn: -1 };
  }

  let start = first;
  while (start < end && !wetAt(start)) start++;
  if (start >= end) {
    const reach = horizon();
    return { full: words.dry(reach.span), top: words.front.dry, bottom: reach.short, wet: false, startsIn: -1 };
  }

  const wait = minutesTo(start);
  if (wait <= 120) {
    const { kind } = spell(start);
    const minutes = rounded(wait);
    return {
      full: words.coming(words.kinds[kind], spoken(minutes, words)),
      top: words.short[kind] + words.front.coming,
      bottom: short(minutes, words),
      wet: false,
      startsIn: Math.round(wait),
    };
  }

  const at = series.base + start * STEP_MS;
  const time = clock(at, zone);
  const day = (moment) => Math.floor((moment + zone * 60000) / DAY_MS);
  const daysAhead = day(at) - day(now);
  let when = time;
  if (daysAhead === 1) when = texts.tomorrow + " " + time;
  // Days are counted from 1 January 1970, a Thursday: day 4 of a week that starts on Sunday.
  else if (daysAhead > 1) when = words.days[(day(at) + 4) % 7] + " " + time;
  return { full: words.dryUntil(when), top: words.front.dryUntil, bottom: time, wet: false, startsIn: -1 };
}
