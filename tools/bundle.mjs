import { build } from "vite";

/**
 * Bundles an entry script and everything it imports into one classic script (an IIFE), readable and unminified.
 * The simulators use it to run the app outside the bar, where there is no module loader to hand.
 */
export async function bundle(entry) {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: { write: false, minify: false, lib: { entry, formats: ["iife"], name: "app" } },
  });
  return (Array.isArray(result) ? result[0] : result).output[0].code;
}
