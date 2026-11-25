/**
 * Teaching: lessons learned (reorder or forget), Pet School, plain words (web
 * build), and a rule builder. Every path shows the rule first; nothing changes
 * the pet until the owner confirms, and the game rules check it again then.
 */

import { CuteState } from "./CuteState";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { type Rule } from "@lingxi/brain";
import { type Pet, lessonCapacity, checkLesson, stageOf } from "@lingxi/game";
import { useLang, useT } from "../i18n";
import { useWorld } from "../game/world";
import { Sandbox } from "./Sandbox";
import { TryIt } from "./TryIt";
import { OwnedInstinctPanel } from "./OwnedInstinct";
import "./teach.css";
import { now } from "../game/gameClock";
import { Learned } from "./teach/Learned";
import { Proposal } from "./teach/Proposal";
import { Builder, Library, Mentor, SchoolLevels, Words } from "./teach/Ways";
import { GateMeter, type Source } from "./teach/shared";

export { GateMeter } from "./teach/shared";

export function TeachPanel({ pet }: { pet: Pet }) {
  const t = useT();
  const { lang } = useLang();
  const [proposal, setProposal] = useState<{ rule: Rule; reply?: string; source: Source } | null>(null);
  // the lesson just taught, offered to try out in the room (H5)
  const [learned, setLearned] = useState<Rule | null>(null);
  const stage = stageOf(pet, now());
  // the stage's slots, those its skills add and any a quest gave: the same capacity the game checks when it teaches
  const slots = useWorld((s) => ((s.world.flags ?? []).includes("lesson-slot") ? 1 : 0));
  const max = lessonCapacity(stage, pet.growth, slots);
  const full = pet.lessons.length >= max;
  const propose = (rule: Rule, reply?: string, source: Source = { kind: "own" }) => {
    const check = checkLesson(pet.line, stage, pet.lessons, rule, pet.instincts);
    setProposal({ rule: check.ok ? check.program.rules[0]! : rule, source, ...(reply ? { reply } : {}) });
  };
  if (pet.sitting || pet.away)
    return (
      <div className="teach">
        <CuteState
          who={{ pet, expression: "shy" }}
          text={
            lang === "zh"
              ? `${pet.name}是朋友托你照看的，只有它的主人能教它。`
              : `${pet.name} is a friend's pet staying with you; only its owner teaches it.`
          }
        />
        <Sandbox pet={pet} />
      </div>
    );
  return (
    <div className="teach">
      <div className="teach-head">
        <p className="label">{t("teach.learned", { name: pet.name })}</p>
        <span className="cap">{t("teach.capacity", { n: pet.lessons.length, max })}</span>
      </div>
      {learned && !proposal && <TryIt pet={pet} lesson={learned} onDone={() => setLearned(null)} />}
      <GateMeter pet={pet} />
      <Learned pet={pet} />
      <Mentor pet={pet} />
      <SchoolLevels pet={pet} canLearn={!proposal} onPropose={(rule) => propose(rule, undefined, { kind: "school" })} />
      <Sandbox pet={pet} trying={proposal?.rule ?? null} />
      <AnimatePresence mode="wait">
        {proposal ? (
          <Proposal
            key="p"
            pet={pet}
            rule={proposal.rule}
            source={proposal.source}
            swap={full}
            {...(proposal.reply ? { reply: proposal.reply } : {})}
            onDone={() => setProposal(null)}
            onLearned={setLearned}
          />
        ) : (
          <motion.div key="choose" className="teach-choose" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* full: the ways to teach stay, and a new lesson takes the newest one's place (H5) */}
            {full && <p className="small">{t("teach.fullSwap", { name: pet.name })}</p>}
            <Library pet={pet} onPropose={(l) => propose(l.rule, undefined, { kind: "library", key: l.key })} />
            <p className="label">{t("teach.words")}</p>
            <Words pet={pet} onPropose={propose} />
            <details className="build">
              <summary>{t("teach.build")}</summary>
              <Builder pet={pet} onPropose={(r) => propose(r)} />
            </details>
          </motion.div>
        )}
      </AnimatePresence>
      <OwnedInstinctPanel pet={pet} />
    </div>
  );
}
