/**
 * The handheld's core on an emulated ESP32-S3 (Espressif's QEMU): builds the firmware's `selftest` image, writes it
 * into an 8 MB flash file, boots it, and checks what the chip prints: the boot self-test against X Layer's hashes and
 * pet #1's mainnet log, the USB link's hello, and a whole scripted trip whose packet back must be byte for byte the
 * WebAssembly app's (scripts/build-chip-trip.ts).
 *
 *   QEMU_XTENSA=<path to qemu-system-xtensa> node scripts/chip-selftest.mjs
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const fw = new URL("../firmware/cardputer/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const build = join(fw, ".pio", "build", "selftest");
const qemu =
  process.env.QEMU_XTENSA ??
  join(
    homedir(),
    "tools",
    "qemu-esp",
    "qemu",
    "bin",
    process.platform === "win32" ? "qemu-system-xtensa.exe" : "qemu-system-xtensa",
  );
if (!existsSync(qemu)) throw new Error(`no Espressif QEMU at ${qemu}; set QEMU_XTENSA`);

execFileSync("python", ["-m", "platformio", "run", "-d", fw, "-e", "selftest"], { stdio: "inherit" });
const pkgs = join(homedir(), ".platformio", "packages");
const esptool = join(pkgs, "tool-esptoolpy", "esptool.py");
const app0 = join(pkgs, "framework-arduinoespressif32", "tools", "partitions", "boot_app0.bin");
// prettier-ignore
execFileSync("python", [esptool, "--chip", "esp32s3", "merge_bin", "-o", join(build, "merged.bin"), "--fill-flash-size", "8MB", "--flash_mode", "dio", "--flash_size", "8MB",
  "0x0", join(build, "bootloader.bin"), "0x8000", join(build, "partitions.bin"), "0xe000", app0, "0x10000", join(build, "firmware.bin")], { stdio: "ignore" });

const log = join(build, "qemu.log");
rmSync(log, { force: true });
const vm = spawn(
  qemu,
  [
    "-nographic",
    "-machine",
    "esp32s3",
    "-drive",
    `file=${join(build, "merged.bin")},if=mtd,format=raw`,
    "-serial",
    `file:${log}`,
    "-monitor",
    "none",
  ],
  { stdio: "ignore" },
);
const deadline = Date.now() + 120_000;
let out = "";
while (Date.now() < deadline && !/selftest: done|assert failed|Guru Meditation/.test(out)) {
  await new Promise((r) => setTimeout(r, 1000));
  out = existsSync(log) ? readFileSync(log, "utf8") : "";
}
vm.kill();

const lines = out.split(/\r?\n/).filter((l) => /^selftest:|^LX/.test(l));
for (const l of lines) console.log(l);
const checks = [
  ["boot self-test passed", /selftest: starter hashes 111, loads 111, pet #1 log hash 1, memory 1, pass 1/.test(out)],
  ["the link says hello", /^LX! 1 1 0$/m.test(out)],
  [
    "the scripted trip comes back identical",
    /trip opened 0, \d+ bytes back, identical to the WebAssembly app's/.test(out),
  ],
];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
