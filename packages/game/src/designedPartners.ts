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
    blurb: { en: "Dodges nearly half the time, and pounces or rests in between.", zh: "将近一半的回合都在躲闪，其余时候扑一下或歇一歇。" },
  },
  child: {
    id: "bruno",
    name: { en: "Bruno the Bulldozer", zh: "横冲直撞的布鲁诺" },
    line: "bold",
    blurb: { en: "Pounces on about half its turns and hits hard. Rest at the wrong moment and it's over.", zh: "大约一半的回合都在猛扑，下手很重。在错的时候休息就输了。" },
  },
  teen: {
    id: "velvet",
    name: { en: "Velvet the Charmer", zh: "迷人的丝绒" },
    line: "gentle",
    blurb: { en: "Charms you to sap your strength, then pounces while you are soft.", zh: "先迷惑你、削弱你的力气，趁你松懈时扑过来。" },
  },
  adult: {
    id: "sentinel",
    name: { en: "Old Sentinel", zh: "老哨兵" },
    line: "bold",
    blurb: { en: "Guards about a third of the time, snacks to heal, and pounces in between.", zh: "大约三分之一的回合在防守，吃点心回血，其余时候扑过来。" },
  },
};

export interface DesignedPartner extends Partner {
  design: DesignRecord;
}

export const DESIGNED_PARTNERS: readonly DesignedPartner[] = (Object.keys(LOOKS) as DesignStage[])
  .filter((s) => DESIGNED[s])
  .map((stage) => ({ ...LOOKS[stage], stage, level: STAGE_LEVEL[stage], program: DESIGNED[stage]!.program, design: DESIGNED[stage]! }));
