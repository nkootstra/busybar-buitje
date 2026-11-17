// What the rain ahead comes to, in words: "Drizzle for about 45 minutes", "Dry until 22:35".
import { HEAVY, RAIN, STEPS, STEP_MS, WET } from "./rain.js";

const DAY_MS = 86400000;

const WORDS = {
  en: {
    kinds: ["Drizzle", "Rain", "Heavy rain"],
    short: ["DRIZZLE", "RAIN", "HEAVY"],
    lasting: (kind, time) => kind + " for about " + time,
    allTheWay: (kind) => kind + " for the next 2 days",
    coming: (kind, time) => kind + " in " + time,
    dryUntil: (when) => "Dry until " + when,
    dry: "Dry for the next 2 days",
    tomorrow: "tomorrow",
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    minutes: " minutes",
    hour: " hour",
    hours: " hours",
    front: { dry: "DRY", dryUntil: "DRY TILL", coming: " IN", min: " MIN", hrs: " HRS", twoDays: "2 DAYS" },
  },
  nl: {
    kinds: ["Motregen", "Regen", "Zware regen"],
    short: ["MOTREGEN", "REGEN", "ZWAAR"],
    lasting: (kind, time) => kind + ", nog ca. " + time,
    allTheWay: (kind) => kind + " de komende 2 dagen",
    coming: (kind, time) => kind + " over " + time,
    dryUntil: (when) => "Droog tot " + when,
    dry: "Droog de komende 2 dagen",
    tomorrow: "morgen",
    days: ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"],
    minutes: " minuten",
    hour: " uur",
    hours: " uur",
    front: { dry: "DROOG", dryUntil: "DROOG TOT", coming: " OVER", min: " MIN", hrs: " UUR", twoDays: "2 DAGEN" },
  },
};

/** 0 for drizzle, 1 for rain, 2 for heavy rain. */
function kindOf(level) {
  return level < RAIN ? 0 : level < HEAVY ? 1 : 2;
}

/** A length of time as people say it: to 5 minutes up to an hour and a half, then to half hours, then hours. */
function rounded(minutes) {
  if (minutes < 90) return Math.max(5, Math.round(minutes / 5) * 5);
  if (minutes < 360) return Math.round(minutes / 30) * 30;
  return Math.round(minutes / 60) * 60;
}

function spoken(minutes, words) {
  if (minutes < 90) return minutes + words.minutes;
  const hours = minutes / 60;
  return (hours % 1 ? hours.toFixed(1) : String(hours)) + (hours === 1 ? words.hour : words.hours);
}

/** The clock time of moment `at` in the zone `offsetMin` minutes east of UTC, as "7:05". */
function clock(at, offsetMin) {
  const minutes = Math.floor((at + offsetMin * 60000) / 60000) % 1440;
  const m = minutes % 60;
  return Math.floor(minutes / 60) + ":" + (m < 10 ? "0" : "") + m;
}

/**
 * The headline for the rain from `now` on.
 *
 * @param {{ base: number, levels: Uint8Array }} series - from buildSeries.
 * @param {number} now - the moment, in ms.
 * @param {number} offsetMin - the bar's zone, minutes east of UTC, for clock times.
 * @param {string} language - "en" or "nl".
 * @returns {{ full: string, top: string, bottom: string, wet: boolean, startsIn: number }} `full` is a sentence
 *   for the back display, `top` and `bottom` two short lines for the front. `startsIn` is the minutes until rain
 *   starts, or -1 when it rains now or stays dry for the next 2 hours.
 */
export function headline(series, now, offsetMin, language) {
  // Its wording changes with the minute at most, and finding the next rain means walking the series: the answer
  // for this series and this minute is kept, since the app asks on every frame.
  const minute = Math.floor(now / 60000);
  if (kept && kept.series === series && kept.minute === minute && kept.offsetMin === offsetMin && kept.language === language) {
    return kept.words;
  }
  kept = { series, minute, offsetMin, language, words: phrase(series, now, offsetMin, language) };
  return kept.words;
}

/** The last headline made, and what it was made for. */
let kept = null;

function phrase(series, now, offsetMin, language) {
  const words = WORDS[language] || WORDS.en;
  const levels = series.levels;
  const first = Math.max(0, Math.floor((now - series.base) / STEP_MS));
  const wetAt = (i) => i < STEPS && levels[i] >= WET;

  /** Minutes from now until step `step` begins: now is seldom at the start of a step. */
  const minutesTo = (step) => Math.max(0, (series.base + step * STEP_MS - now) / 60000);

  // How long the spell that starts at step `from` lasts, and how strong it gets.
  const spell = (from) => {
    let end = from;
    let peak = 0;
    while (wetAt(end)) {
      if (levels[end] > peak) peak = levels[end];
      end++;
    }
    return { end, kind: kindOf(peak) };
  };

  if (wetAt(first)) {
    const { end, kind } = spell(first);
    if (end >= STEPS) {
      return { full: words.allTheWay(words.kinds[kind]), top: words.short[kind], bottom: words.front.twoDays, wet: true, startsIn: -1 };
    }
    const minutes = rounded(minutesTo(end));
    const bottom = minutes < 90 ? minutes + words.front.min : Math.round(minutes / 60) + words.front.hrs;
    return { full: words.lasting(words.kinds[kind], spoken(minutes, words)), top: words.short[kind], bottom, wet: true, startsIn: -1 };
  }

  let start = first;
  while (start < STEPS && !wetAt(start)) start++;
  if (start >= STEPS) return { full: words.dry, top: words.front.dry, bottom: words.front.twoDays, wet: false, startsIn: -1 };

  const wait = minutesTo(start);
  if (wait <= 120) {
    const { kind } = spell(start);
    const minutes = rounded(wait);
    const bottom = minutes < 90 ? minutes + words.front.min : Math.round(minutes / 60) + words.front.hrs;
    return {
      full: words.coming(words.kinds[kind], spoken(minutes, words)),
      top: words.short[kind] + words.front.coming,
      bottom,
      wet: false,
      startsIn: Math.round(wait),
    };
  }

  const at = series.base + start * STEP_MS;
  const time = clock(at, offsetMin);
  const local = (moment) => Math.floor((moment + offsetMin * 60000) / DAY_MS);
  const daysAhead = local(at) - local(now);
  let when = time;
  if (daysAhead === 1) when = words.tomorrow + " " + time;
  else if (daysAhead > 1) when = words.days[(local(at) + 4) % 7] + " " + time;
  return { full: words.dryUntil(when), top: words.front.dryUntil, bottom: time, wet: false, startsIn: -1 };
}
