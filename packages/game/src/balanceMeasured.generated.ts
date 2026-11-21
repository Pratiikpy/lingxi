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
      "value": "2 of 8 lessons seen everywhere; 5 of 8 decide under 5% of watched minutes (share, brave, nap, tidy, thanks)",
      "status": "open"
    },
    "spar-best-single": {
      "value": "pounce-only wins 98%",
      "status": "open"
    },
    "spar-reading-pays": {
      "value": "reader 94%; best other pounce-only 98%",
      "status": "open"
    },
    "spar-guard-answers": {
      "value": "guard-only 0% against pounce-only, 0% against the field",
      "status": "open"
    },
    "spar-dodge-answers": {
      "value": "dodge-only 0% against pounce-only, 0% against the field",
      "status": "open"
    },
    "level-not-by-tapping": {
      "value": "tapper level 99 on day 1; day 30: tapper 99, three visits 24",
      "status": "open"
    },
    "coins-bounded": {
      "value": "once 100, three 92, weekend 92, tapper 97, grinder 2212",
      "status": "open"
    },
    "coins-worth-saving": {
      "value": "everything costs 840; once never, three never, weekend never, tapper day 40, grinder day 1",
      "status": "open"
    },
    "once-a-day-safe": {
      "value": "211 care mistakes in 90 days",
      "status": "open"
    },
    "weekend-not-sick": {
      "value": "12 of 12 weekends end with the pet ill; 185 care mistakes",
      "status": "open"
    },
    "new-every-day": {
      "value": "once 69 empty days, three 73 empty days, weekend 70 empty days, tapper 73 empty days, grinder 70 empty days",
      "status": "open"
    },
    "gate-budget-binds": {
      "value": "first refusal never; at most 67% of the budget used by day 7",
      "status": "open"
    }
  }
};
