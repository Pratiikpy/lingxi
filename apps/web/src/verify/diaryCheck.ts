/**
 * The diary a pet's owner published, checked against X Layer before a word of it is shown (Z1; P7: out of VerifyApp).
 * The published log is replayed against the pet and circuit on the page at that moment, waiting for the indexer when
 * the pet was kept a moment ago (A39); a diary that could not be read is said so, with a retry (A109).
 */
import { useEffect, useEffectEvent, useState } from "react";
import type { Circuit } from "@lingxi/brain";
import { type DiaryLine, diaryOfStretches } from "@lingxi/game";
import { HISTORY_RETRIES, HISTORY_RETRY_MS } from "./askHistory";
import { INDEXER, fetchPetHistory } from "./indexer";
import type { LogFile, Stretch } from "./logReplay";
import { readPublished } from "./published";

export /** Where the diary's check stands: checking, waiting for the indexer, not indexed in time, passed, or failed. */
type DiaryState = "checking" | "waiting" | "unindexed" | "ok" | "bad" | "birth" | "unread";

/**
 * Resolves true once Lingxi's indexer has read the pet's hatching (a diary is anchored to it), asking again every
 * HISTORY_RETRY_MS, HISTORY_RETRIES more times; false when it still has not, or the page moved on (A39).
 */
async function hatchIndexed(id: string, alive: () => boolean, waiting: () => void): Promise<boolean> {
  for (let left = HISTORY_RETRIES; ; left--) {
    // an indexer that does not answer is asked again below, as one that has not read the hatching yet (A39)
    const h = await fetchPetHistory(id).catch(() => null);
    if (h?.hatched) return true;
    if (left <= 0 || !alive()) return false;
    waiting();
    await new Promise((r) => setTimeout(r, HISTORY_RETRY_MS));
  }
}

export interface DiaryCheck {
  state: DiaryState;
  diary?: DiaryLine[];
  /** how many beats the published log holds, to set against the time X Layer shows it covered (A94) */
  beats?: number;
}

export function useDiaryCheck(
  pet: { id: bigint; logHash: string } | null,
  circuit: Circuit | null,
  replay: (log: LogFile) => Promise<Stretch[] | null | "birth">,
): { diaryNow: DiaryCheck | null; retryDiary: () => void } {
  // the published log is checked against the pet and circuit shown at that moment
  const replayPublished = useEffectEvent((log: LogFile) => replay(log));
  const petId = pet?.id;
  const logHash = pet?.logHash;
  // the diary's check, with the pet, log and circuit it was made for: it shows only while those are still on the page
  // `beats`: how many beats the published log holds, to set against the time X Layer shows it covered (A94)
  // asking again for a diary that could not be read (A109)
  const [diaryTry, setDiaryTry] = useState(0);
  const [diaryCheck, setDiaryCheck] = useState<{
    petId: unknown;
    logHash: unknown;
    circuit: Circuit;
    state: DiaryState;
    diary?: DiaryLine[];
    beats?: number;
  } | null>(null);
  const diaryNow =
    diaryCheck && diaryCheck.petId === petId && diaryCheck.logHash === logHash && diaryCheck.circuit === circuit
      ? diaryCheck
      : null;
  useEffect(() => {
    if (petId === undefined || !circuit) return;
    let live = true;
    const said = (state: DiaryState, lines?: DiaryLine[], beats?: number) =>
      live &&
      setDiaryCheck({
        petId,
        logHash,
        circuit,
        state,
        ...(lines ? { diary: lines } : {}),
        ...(beats !== undefined ? { beats } : {}),
      });
    readPublished(INDEXER, petId.toString())
      .then(async (r) => {
        if (!live) return;
        // no published diary: nothing to show; a diary that could not be read is said so, with a retry (A109)
        if (r.kind === "none") return setDiaryCheck(null);
        if (r.kind === "unread") return said("unread");
        const log = r.log;
        said("checking");
        // a pet kept a moment ago is not indexed yet, and its diary cannot be anchored until its hatching is: wait for
        // it, saying so, rather than call a genuine diary failed (A39)
        if (
          !(await hatchIndexed(
            petId.toString(),
            () => live,
            () => said("waiting"),
          ))
        )
          return said("unindexed");
        if (!live) return;
        said("checking");
        const stretches = await replayPublished(log);
        if (stretches === "birth") return said("birth");
        if (!stretches) return said("bad");
        said(
          "ok",
          diaryOfStretches(
            stretches.map((x) => ({ brain: { fast: x.brain.fast, nState: x.brain.nState }, words: x.words })),
          ),
          log.words.length,
        );
      })
      .catch(() => {
        // the chain reads behind the check failed: the diary was not checked, which is not the same as failing it
        said("unread");
      });
    return () => {
      live = false;
    };
  }, [petId, logHash, circuit, diaryTry]);

  // asking again shows the check under way at once, and asks
  const retryDiary = () => {
    setDiaryCheck((c) => c && { ...c, state: "checking" });
    setDiaryTry((n) => n + 1);
  };
  return { diaryNow, retryDiary };
}
