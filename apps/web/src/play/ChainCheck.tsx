/**
 * Check a fight on X Layer (PRD A4). Shown only for a pet that lives on chain:
 * reads its brain circuit back from the chain, re-runs the fight with it, and
 * asks PetRegistry.replayStep what that circuit answers in every round.
 */

import { ruleSkillIds } from "@lingxi/game";
import { useState } from "react";
import type { Pet } from "@lingxi/game";
import { useLang } from "../i18n";
import type { BattleCheck } from "../game/battleCheck";
import { mindKey, recordOf } from "../game/chain";
import { play } from "../game/sound";

type Run = (petId: string, onProgress: (done: number) => void) => Promise<BattleCheck>;

export function ChainCheck({ pet, rounds, run }: { pet: Pet; rounds: number; run: Run }) {
  const lang = useLang((s) => s.lang);
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const rec = recordOf(pet);
  const [state, setState] = useState<{ k: "idle" } | { k: "run"; done: number } | { k: "done"; c: BattleCheck } | { k: "error" }>({ k: "idle" });
  if (!rec) return null;
  const stale = rec.brainKey !== undefined && rec.brainKey !== mindKey(pet.lessons, pet.instincts ?? 0, pet.outside, ruleSkillIds(pet.growth));
  const go = async () => {
    setState({ k: "run", done: 0 });
    try {
      const c = await run(rec.petId, (done) => setState({ k: "run", done }));
      setState({ k: "done", c });
      play(c.same && c.confirmed === c.rounds ? "success" : "error");
    } catch {
      setState({ k: "error" });
    }
  };
  return (
    <div className="sp-chain">
      <p className="label">{L("Check this fight on X Layer", "在 X Layer 上核对这场战斗")}</p>
      {state.k === "idle" && (
        <>
          <p className="small">
            {stale
              ? L(`${pet.name} has learned since its brain was last saved on chain, so the chain's brain may not match this fight. Save it first to check.`, `${pet.name}上次把大脑存上链之后又学了新东西，链上的大脑可能和这场不一样。先保存再核对。`)
              : L(`Reads pet #${rec.petId}'s brain circuit from the chain, re-runs the whole fight with it, and asks the chain what that circuit answers in every round.`, `从链上读出 #${rec.petId} 号宠物的大脑电路，用它重算整场战斗，再让链上合约回答每一回合这个电路会怎么出招。`)}
          </p>
          <button type="button" className="btn" onClick={() => void go()}>
            {L("Check on chain", "上链核对")}
          </button>
        </>
      )}
      {state.k === "run" && <p className="small">{L(`Asking X Layer… ${state.done} of ${rounds} rounds`, `正在问 X Layer…… 第 ${state.done} / ${rounds} 回合`)}</p>}
      {state.k === "error" && (
        <p className="small sp-warn">
          {L("X Layer couldn't be reached. Try again in a moment.", "暂时连不上 X Layer，过一会儿再试。")}{" "}
          <button type="button" className="link" onClick={() => void go()}>
            {L("Retry", "重试")}
          </button>
        </p>
      )}
      {state.k === "done" && (
        <ul className="sp-chain-out">
          <li className={state.c.same ? "ok" : "bad"}>
            {state.c.same
              ? L(`Re-run with brain circuit #${state.c.brainId} from the chain: the same fight, fingerprint ${state.c.digest}.`, `用链上的 #${state.c.brainId} 号大脑电路重算：同一场战斗，指纹 ${state.c.digest}。`)
              : L(`Re-run with brain circuit #${state.c.brainId} from the chain gives a different fight. The brain on chain is not the one that fought, usually because it learned since its last save.`, `用链上的 #${state.c.brainId} 号大脑电路重算，结果不同：链上的大脑不是这场出战的那个，通常是因为上次保存后又学了东西。`)}
          </li>
          <li className={state.c.confirmed === state.c.rounds ? "ok" : "bad"}>
            {L(`The chain's replayStep confirms ${state.c.confirmed} of ${state.c.rounds} of ${pet.name}'s moves.`, `链上合约的 replayStep 确认了${pet.name} ${state.c.rounds} 招里的 ${state.c.confirmed} 招。`)}
            {state.c.differs ? L(` The first difference is in round ${state.c.differs}.`, ` 第一处不同在第 ${state.c.differs} 回合。`) : ""}
          </li>
        </ul>
      )}
    </div>
  );
}
