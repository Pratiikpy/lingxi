/** Fails the build when any shipped sheet or quest has a problem (run before the web build). */
import { QUESTLINE } from "../src/questline";
import { SHEETS, checkGame } from "../src/sheets";

try {
  checkGame();
  console.log(
    `sheets ok: ${SHEETS.length} sheet(s), ${SHEETS.reduce((n, s) => n + s.rows.length, 0)} row(s); quest line ok: ${QUESTLINE.length} quests`,
  );
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
