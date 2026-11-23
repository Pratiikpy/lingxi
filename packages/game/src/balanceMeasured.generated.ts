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
      "value": "8 of 8 lessons seen everywhere; 0 of 4 brought about at once decide under 5% of watched minutes (none); 4 wait for their moment (nap, patient, tidy, explore)",
      "status": "met"
    },
    "spar-best-single": {
      "value": "least answered: fight:fresh/gentle, beaten 73% by coached/curious/pip; none beats the reader; best tap-only/excited wins 85% of the field",
      "status": "met"
    },
    "spar-reading-pays": {
      "value": "reader 89%; best other partner:pip 87%",
      "status": "met"
    },
    "spar-guard-answers": {
      "value": "guard-only 55% against pounce-only, 10% against the field",
      "status": "met"
    },
    "spar-dodge-answers": {
      "value": "dodge-only 47% against pounce-only, 11% against the field",
      "status": "met"
    },
    "level-not-by-tapping": {
      "value": "petTalk: level 99 never, day 30 level 34; play3: level 99 never, day 30 level 38; clean: level 99 never, day 30 level 35; feed: level 99 never, day 30 level 40; three visits day 30 level 44",
      "status": "met"
    },
    "trees-by-90": {
      "value": "three visits: level 80 on day 90, level 64 on day 55",
      "status": "met"
    },
    "coins-bounded": {
      "value": "once 115 (day 7), three 127 (day 7), weekend 117 (day 4), tapper 117 (day 8), grinder 127 (day 85)",
      "status": "met"
    },
    "coins-worth-saving": {
      "value": "everything costs 4910; once never, three never, weekend never, tapper never, grinder never",
      "status": "met"
    },
    "recipes-worth": {
      "value": "none strictly worse",
      "status": "met"
    },
    "neglect-costs": {
      "value": "teen on day 62, fell ill, 17 mistakes",
      "status": "met"
    },
    "once-a-day-safe": {
      "value": "0 care mistakes in 90 days",
      "status": "met"
    },
    "weekend-not-sick": {
      "value": "0 of 12 weekends end with the pet ill; 0 care mistakes",
      "status": "met"
    },
    "first-absence-floor": {
      "value": "gentle 240, bold 240, curious 240",
      "status": "met"
    },
    "sick-only-after-days": {
      "value": "gentle 168 h, bold 168 h, curious 168 h",
      "status": "met"
    },
    "new-every-day": {
      "value": "once 4 days with nothing new, at least 1 left, three 0 days with nothing new, at least 1 left, weekend 3 days with nothing new, at least 1 left, tapper 2 days with nothing new, at least 1 left, grinder 4 days with nothing new, at least 1 left",
      "status": "open"
    },
    "gate-budget-binds": {
      "value": "first refusal day 4; at most 65% of the budget used by day 7; sets that fit with no Mind points: gentle: teen 13/70 (5 points 70), adult 5/28, all eight 65 of 60; bold: teen 25/70 (5 points 70), adult 14/28, all eight 61 of 60; curious: teen 4/70 (5 points 70), adult 3/28, all eight 66 of 60",
      "status": "met"
    }
  }
};
