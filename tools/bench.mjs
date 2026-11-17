// Measures how long the bar takes for a frame of every kind, on BUSY Bar Emulator, which runs apps at the
// bar's speed. Prints one line per screen and the mean, `frame_ms`: lower is better.
//
//   node tools/bench.mjs            needs the emulator running and this folder trusted by it
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, ".bench");
const id = "io.kootstra.buitje.bench";
const emulator = process.env.BUSY_EMULATOR || join(homedir(), ".busy-emulator/bin/busy-emulator");
/** Where the emulated bar answers. */
const BAR = "127.0.0.1:8640";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const emu = (...args) => execFileSync(emulator, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

if (!existsSync(emulator)) throw new Error("BUSY Bar Emulator's command line is not at " + emulator);

// A copy of the sources with the benchmark as its entry point, built as an app of its own.
rmSync(work, { recursive: true, force: true });
mkdirSync(work);
cpSync(join(root, "src"), join(work, "src"), { recursive: true });
cpSync(join(root, "tools/bench-app.js"), join(work, "src/main.js"));
rmSync(join(work, "src/appmeta/settings.json"), { force: true });
const manifest = JSON.parse(readFileSync(join(root, "src/appmeta/manifest.json"), "utf8"));
writeFileSync(join(work, "src/appmeta/manifest.json"), JSON.stringify({ ...manifest, id, name: "Buitje bench" }));
writeFileSync(join(work, "package.json"), JSON.stringify({ name: "buitje-bench", private: true, type: "module" }));
execFileSync(join(root, "node_modules/.bin/busy-cli"), ["build"], { cwd: work, stdio: "ignore" });

const cli = (...args) => execFileSync(join(root, "node_modules/.bin/busy-cli"), [...args, "--addr", BAR], { stdio: "ignore" });
cli("app", "install", join(work, "dist", id + ".tgz"));
cli("app", "run", id);
let log = "";
for (let waited = 0; waited < 180 && !/bench frame_ms/.test(log); waited += 3) {
  await sleep(3000);
  log = emu("logs", "--app", id, "--since-run", "--lines", "200");
}
cli("app", "uninstall", id);
rmSync(work, { recursive: true, force: true });

const lines = log.split("\n").filter((line) => line.includes("bench "));
for (const line of lines) console.log(line.slice(line.indexOf("bench ")));
const heap = /heap peak ([\d.]+)/.exec(log);
if (heap) console.log("heap_kib " + heap[1]);
if (!/bench frame_ms/.test(log)) {
  console.error(log.split("\n").slice(-15).join("\n"));
  throw new Error("the benchmark did not finish");
}
