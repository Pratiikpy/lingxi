/** Fails the build when any shipped sheet has a bad row (run before the web build). */
import { SHEETS, checkSheets } from "../src/sheets";

try {
  checkSheets(SHEETS);
  console.log(`sheets ok: ${SHEETS.length} sheet(s), ${SHEETS.reduce((n, s) => n + s.rows.length, 0)} row(s)`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
