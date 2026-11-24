/**
 * Compiles the handheld's C core to WebAssembly with Zig's clang (`python -m ziglang cc`), for the browser
 * handheld and the tests, and records the compiler, the flags and the SHA-256 of the module and of every source in
 * wasm/build.json. The module is committed, so neither the game nor the tests need a C compiler; a test rebuilds it
 * when Zig is present and checks the record still describes the sources.
 *
 *   node scripts/build-wasm.mjs [core|app]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sha = (b) => createHash("sha256").update(b).digest("hex");

export const TARGETS = {
  core: {
    out: "wasm/lingxi-core.wasm",
    sources: ["core/keccak.c", "core/tap02.c", "core/pet.c", "core/trip.c", "platform/wasm_core.c"],
  },
  app: {
    out: "wasm/lingxi-handheld.wasm",
    sources: [
      "core/keccak.c",
      "core/tap02.c",
      "core/pet.c",
      "core/trip.c",
      "core/draw.c",
      "core/font_data.c",
      "core/art_data.c",
      "core/selftest.c",
      "core/selftest_data.c",
      "core/app.c",
      "core/link.c",
      "platform/wasm_app.c",
    ],
  },
};

export const FLAGS = [
  "-target",
  "wasm32-freestanding",
  "-O2",
  "-std=c99",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-nostdlib",
  "-fno-builtin",
  "-Wl,--no-entry",
  "-Wl,-z,stack-size=262144",
];

export function build(name) {
  const t = TARGETS[name];
  if (!t) throw new Error(`unknown target ${name}`);
  const out = join(root, t.out);
  mkdirSync(dirname(out), { recursive: true });
  const python = process.env.PYTHON ?? "python";
  execFileSync(python, ["-m", "ziglang", "cc", ...FLAGS, "-o", out, ...t.sources.map((s) => join(root, s))], {
    cwd: root,
    stdio: "inherit",
  });
  const zig = execFileSync(python, ["-m", "ziglang", "version"], { encoding: "utf8" }).trim();
  const record = {
    target: name,
    compiler: `zig ${zig} (clang)`,
    flags: FLAGS,
    module: { path: t.out, sha256: sha(readFileSync(out)) },
    sources: Object.fromEntries(t.sources.map((s) => [s, sha(readFileSync(join(root, s)))])),
    headers: Object.fromEntries(
      [
        "core/lx.h",
        "core/tap02.h",
        "core/pet.h",
        "core/trip.h",
        "core/draw.h",
        "core/art.h",
        "core/selftest.h",
        "core/app.h",
      ].map((s) => [s, sha(readFileSync(join(root, s)))]),
    ),
  };
  writeFileSync(join(root, `wasm/build-${name}.json`), JSON.stringify(record, null, 2) + "\n");
  return { out: relative(root, out), record };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const n of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS)) {
    const { out, record } = build(n);
    process.stdout.write(
      `${n}: ${out} ${readFileSync(join(root, out)).length} bytes, sha256 ${record.module.sha256.slice(0, 16)}…\n`,
    );
  }
}
