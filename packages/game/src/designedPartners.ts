/**
 * The partners designed by search (PRD F27), one per stage, with the names and
 * personalities their fighting earned. Their brains and the numbers behind them
 * are in designed.generated.ts, written by scripts/design-partners.ts.
 */

import { DESIGNED, type DesignRecord } from "./designed.generated";
import { type DesignStage, STAGE_LEVEL } from "./designer";
import type { Partner } from "./partners";

const LOOKS: Record<DesignStage, Pick<Partner, "id" | "name" | "line" | "blurb">> = {
  baby: {
    id: "flit",
    name: { en: "Flit the Dodger", zh: "躲闪的小闪" },
    line: "curious",
    blurb: {
      en: "Dodges on nearly half its turns, and rests or snacks in between.",
      zh: "将近一半的回合都在躲闪，其余时候休息或吃零食。",
    },
  },
  child: {
    id: "bruno",
    name: { en: "Bruno the Bulldozer", zh: "横冲直撞的布鲁诺" },
    line: "bold",
    blurb: {
      en: "Pounces hard on nearly half its turns and rests in between. Catch its pounces with a guard.",
      zh: "将近一半的回合都在猛扑，下手很重，其余时候在休息。用防守接住它的扑击。",
    },
  },
  teen: {
    id: "velvet",
    name: { en: "Velvet the Charmer", zh: "迷人的丝绒" },
    line: "gentle",
    blurb: {
      en: "Charms you on about a third of its turns, rests as often, and pounces now and then.",
      zh: "大约三分之一的回合在迷惑你，休息得也一样多，偶尔扑过来。",
    },
  },
  adult: {
    id: "sentinel",
    name: { en: "Old Sentinel", zh: "老哨兵" },
    line: "bold",
    blurb: { en: "Guards on half its turns and snacks to heal.", zh: "一半的回合都在防守，还会吃零食回血。" },
  },
};

export interface DesignedPartner extends Partner {
  design: DesignRecord;
}

export const DESIGNED_PARTNERS: readonly DesignedPartner[] = (Object.keys(LOOKS) as DesignStage[])
  .filter((s) => DESIGNED[s])
  .map((stage) => ({
    ...LOOKS[stage],
    stage,
    level: STAGE_LEVEL[stage],
    program: DESIGNED[stage]!.program,
    design: DESIGNED[stage]!,
  }));
