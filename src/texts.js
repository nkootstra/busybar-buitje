// Every word the app shows, in each language it speaks. A new language is one more entry here, and one more
// option of the `language` setting in src/appmeta/settings.json.
//
// The front display's font has capitals only, so what goes there is in capitals. Everything is printable ASCII:
// the bar's displays take nothing else.

const en = {
  // The front display.
  loading: "LOADING",
  // Why there is nothing to show: the bar is not on Wi-Fi, or it is and the sources do not answer.
  problem: { offline: "NO WI-FI", unreachable: "NO DATA" },
  window: (hours) => "NEXT " + hours + "H",
  dryWindow: (hours) => "DRY NEXT " + hours + "H",

  // The back display.
  waiting: "Asking for the rain...",
  problemLine: { offline: "The bar is not on Wi-Fi", unreachable: "No rain data. Start: try again" },
  // Under old data, where the window's name stood: what is wrong, and when the data is from.
  dataFrom: { offline: (time) => "No Wi-Fi. Data from " + time, unreachable: (time) => "No answer. Data from " + time },
  windowOnFront: (hours) => "Next " + hours + (hours === 1 ? " hour" : " hours") + " on the front",
  now: "now",
  tomorrow: "tomorrow",

  // The headline, as a sentence and as two short lines.
  headline: {
    kinds: ["Drizzle", "Rain", "Heavy rain"],
    short: ["DRIZZLE", "RAIN", "HEAVY"],
    lasting: (kind, time) => kind + " for about " + time,
    coming: (kind, time) => kind + " in " + time,
    dryUntil: (when) => "Dry until " + when,
    // As far as the forecast reaches: `span` is "2 days", or less when less is known.
    allTheWay: (kind, span) => kind + " for the next " + span,
    dry: (span) => "Dry for the next " + span,
    twoDays: "2 days",
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    minutes: " minutes",
    hours: " hours",
    front: { dry: "DRY", dryUntil: "DRY TILL", coming: " IN", min: " MIN", hrs: " HRS", twoDays: "2 DAYS" },
  },
};

const nl = {
  loading: "LADEN",
  problem: { offline: "GEEN WIFI", unreachable: "GEEN DATA" },
  window: (hours) => "KOMENDE " + hours + "U",
  dryWindow: (hours) => "DROOG KOMENDE " + hours + "U",

  waiting: "Regen wordt opgehaald...",
  problemLine: { offline: "De bar heeft geen wifi", unreachable: "Geen regendata. Start: opnieuw" },
  dataFrom: { offline: (time) => "Geen wifi. Data van " + time, unreachable: (time) => "Geen antwoord. Data van " + time },
  windowOnFront: (hours) => "Komende " + hours + " uur op de voorkant",
  now: "nu",
  tomorrow: "morgen",

  headline: {
    kinds: ["Motregen", "Regen", "Zware regen"],
    short: ["MOTREGEN", "REGEN", "ZWAAR"],
    lasting: (kind, time) => kind + ", nog ca. " + time,
    coming: (kind, time) => kind + " over " + time,
    dryUntil: (when) => "Droog tot " + when,
    allTheWay: (kind, span) => kind + " de komende " + span,
    dry: (span) => "Droog de komende " + span,
    twoDays: "2 dagen",
    days: ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"],
    minutes: " minuten",
    hours: " uur",
    front: { dry: "DROOG", dryUntil: "DROOG TOT", coming: " OVER", min: " MIN", hrs: " UUR", twoDays: "2 DAGEN" },
  },
};

export const TEXTS = { en, nl };

/** The clock time of moment `at`, in ms, in the zone `zone` minutes east of UTC, as "7:05". */
export function clock(at, zone) {
  const minutes = Math.floor((at + zone * 60000) / 60000) % 1440;
  const m = minutes % 60;
  return Math.floor(minutes / 60) + ":" + (m < 10 ? "0" : "") + m;
}

/** Letters the bar cannot show, by the plain letters that stand in for them. */
const UNMARKED = {
  a: "àáâãäå",
  c: "ç",
  e: "èéêë",
  i: "ìíîï",
  n: "ñ",
  o: "òóôõöø",
  u: "ùúûü",
  y: "ýÿ",
  A: "ÀÁÂÃÄÅ",
  C: "Ç",
  E: "ÈÉÊË",
  I: "ÌÍÎÏ",
  N: "Ñ",
  O: "ÒÓÔÕÖØ",
  U: "ÙÚÛÜ",
  Y: "Ý",
  ss: "ß",
  ae: "æ",
  oe: "œ",
  l: "ł",
  Ae: "Æ",
  Oe: "Œ",
  L: "Ł",
  "'": "‘’",
  "-": "–—",
};

/**
 * Text from outside the app, such as the name of a place, as text the bar's displays can show: printable
 * ASCII. Marked letters lose their mark, what has no plain form goes, and runs of blanks become one space.
 */
export function plain(value) {
  let out = "";
  const from = typeof value === "string" ? value : "";
  for (let i = 0; i < from.length; i++) {
    const ch = from[i];
    if (ch >= " " && ch <= "~") out += ch;
    else if (ch === "\n" || ch === "\t" || ch === "\r") out += " ";
    else for (const letter in UNMARKED) if (UNMARKED[letter].indexOf(ch) >= 0) out += letter;
  }
  return out.replace(/ +/g, " ").trim();
}

/** The texts of a language; English for one the app does not speak. */
export function textsFor(language) {
  return TEXTS[language] || TEXTS.en;
}
