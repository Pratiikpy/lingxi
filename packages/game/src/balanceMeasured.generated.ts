/* Written by scripts/sim90.ts --write; re-run it to reproduce. Do not edit by hand. */

export interface BalanceMeasured {
  seed: number;
  days: number;
  targets: Record<string, { value: string; status: "met" | "open" }>;
}

export const BALANCE_MEASURED: BalanceMeasured = {
  "seed": 20261121,
  "days": 90,
  "targets": {
    "lessons-seen": {
      "value": "2 of 8 lessons seen everywhere; 4 of 8 decide under 5% of watched minutes (brave, nap, tidy, thanks)",
      "status": "open"
    },
    "spar-best-single": {
      "value": "least answered: fight:fresh/gentle, beaten 72% by coached/gentle/pip; none beats the reader; best pounce-only wins 79% of the field",
      "status": "met"
    },
    "spar-reading-pays": {
      "value": "reader 84%; best other partner:pip 85%",
      "status": "open"
    },
    "spar-guard-answers": {
      "value": "guard-only 55% against pounce-only, 7% against the field",
      "status": "met"
    },
    "spar-dodge-answers": {
      "value": "dodge-only 47% against pounce-only, 10% against the field",
      "status": "met"
    },
    "level-not-by-tapping": {
      "value": "tapper level 99 on no day; day 30: tapper 29, three visits 38",
      "status": "met"
    },
    "trees-by-90": {
      "value": "three visits: level 69 on day 90, level 64 on day 77",
      "status": "met"
    },
    "coins-bounded": {
      "value": "once 92, three 92, weekend 92, tapper 107, grinder 6232",
      "status": "open"
    },
    "coins-worth-saving": {
      "value": "everything costs 840; once never, three never, weekend never, tapper never, grinder day 1",
      "status": "open"
    },
    "once-a-day-safe": {
      "value": "162 care mistakes in 90 days",
      "status": "open"
    },
    "weekend-not-sick": {
      "value": "12 of 12 weekends end with the pet ill; 155 care mistakes",
      "status": "open"
    },
    "new-every-day": {
      "value": "once 69 empty days, three 71 empty days, weekend 71 empty days, tapper 72 empty days, grinder 72 empty days",
      "status": "open"
    },
    "gate-budget-binds": {
      "value": "first refusal never; at most 67% of the budget used by day 7",
      "status": "open"
    }
  }
};
