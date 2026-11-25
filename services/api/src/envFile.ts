/**
 * A key file read as KEY=value lines; a file that is missing or unreadable reads as empty, so the feature it switches
 * on stays off rather than the server failing to start.
 */
import { readFileSync } from "node:fs";

export function readEnvFile(path: string | undefined): Record<string, string> {
  if (!path) return {};
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    // no file, no keys: the caller treats that as the feature being off
    return {};
  }
}
