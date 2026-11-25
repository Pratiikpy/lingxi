/**
 * The proof page's checks of one pet, as panels (P7: out of VerifyApp): asking all 65,536 inputs, the 32 beats of the
 * spot check side by side with the open evaluator, and the published diary once it has passed against the chain.
 */
import { decodeSenses, wordToBits } from "@lingxi/brain";
import type { ChainPet } from "@lingxi/chain";
import { beatsOutrunChain, diaryText } from "@lingxi/game";
import type { Row } from "./checks";
import type { DiaryCheck } from "./diaryCheck";
import { T, viaText } from "./verifyText";

type Lang = "en" | "zh";

export interface FullCheckState {
  done: number;
  bad: number;
  first?: string;
  secs?: number;
  stopped?: boolean;
}

export function FullCheckPanel({
  lang,
  all,
  hosts,
  disabled,
  onRun,
  onStop,
}: {
  lang: Lang;
  all: FullCheckState | null;
  hosts: ReadonlySet<string>;
  disabled: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  return (
    <div className="v-all">
      <p className="v-note">
        {lang === "zh"
          ? "或者问遍全部：在它保存的记忆下，把 65,536 种可能的感受全部交给 X Layer 上的处理器，再逐一和开源求值器比对（约 2–3 分钟）。"
          : "Or ask everything: at its saved memory, every one of the 65,536 possible inputs goes to the processor on X Layer and is compared with the open evaluator (about 2–3 minutes)."}
      </p>
      {all && !all.secs && !all.stopped ? (
        <>
          <div
            className="v-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={65536}
            aria-valuenow={all.done}
          >
            <i style={{ transform: `scaleX(${all.done / 65536})` }} />
          </div>
          <p className="v-note">
            {all.done.toLocaleString()} / 65,536{" "}
            {all.bad ? (lang === "zh" ? `· ${all.bad} 处不一致` : `· ${all.bad} differ`) : ""}{" "}
            <button type="button" className="v-link" onClick={onStop}>
              {lang === "zh" ? "停止" : "Stop"}
            </button>
          </p>
        </>
      ) : (
        <button type="button" className="v-run" onClick={onRun} disabled={disabled}>
          {lang === "zh" ? "问遍全部 65,536 种输入" : "Ask all 65,536 inputs"}
        </button>
      )}
      {all?.secs !== undefined && (
        <p className={all.bad === 0 && !all.stopped ? "v-ok" : "v-bad"}>
          {all.stopped
            ? lang === "zh"
              ? `已停止：核对了 ${all.done.toLocaleString()} 种，${all.bad} 处不一致。`
              : `Stopped: ${all.done.toLocaleString()} checked, ${all.bad} differ.`
            : all.bad === 0
              ? lang === "zh"
                ? `65,536 种输入全部一致（${all.secs} 秒）。在这份记忆下，它每一个可能的念头都和链上处理器相同。`
                : `All 65,536 inputs match (${all.secs}s). At this memory, every thought it could possibly have is the processor's own.`
              : lang === "zh"
                ? `${all.bad} 种输入不一致，第一个是 ${all.first}。`
                : `${all.bad} inputs differ, the first at ${all.first}.`}
        </p>
      )}
      {all?.secs !== undefined && hosts.size > 0 && (
        <p className="v-note mono" data-testid="all-hosts">
          {viaText(hosts, lang)}
        </p>
      )}
    </div>
  );
}

export function SpotRows({
  lang,
  rows,
  running,
  hosts,
  brainBits,
}: {
  lang: Lang;
  rows: Row[];
  running: boolean;
  hosts: ReadonlySet<string>;
  brainBits: number;
}) {
  const t = T[lang];
  const ok = rows.filter((r) => r.chain.next === r.local.next && r.chain.outputs === r.local.outputs).length;
  return (
    <>
      {rows.length > 0 && (
        <>
          {/* the verdict only once all 32 are compared (A57) */}
          {running ? (
            <p className="v-note">{t.comparing.replace("{k}", String(rows.length))}</p>
          ) : (
            <p className={ok === rows.length ? "v-ok" : "v-bad"}>
              {ok === rows.length
                ? t.allOk.replace("{n}", String(rows.length))
                : t.someBad.replace("{n}", String(rows.length - ok))}
            </p>
          )}
          {!running && hosts.size > 0 && (
            <p className="v-note mono" data-testid="run-hosts">
              {viaText(hosts, lang)}
            </p>
          )}
          <div className="v-table" role="region" aria-label={lang === "zh" ? "每一拍" : "Each beat"} tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>
                    {t.state} <span className="v-note">({t.bitOrder})</span>
                  </th>
                  <th>{t.inputs}</th>
                  <th>X Layer</th>
                  <th>{lang === "zh" ? "开源求值器" : "open evaluator"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const same = r.chain.next === r.local.next && r.chain.outputs === r.local.outputs;
                  const s = decodeSenses(r.word);
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td className="mono">{wordToBits(r.state, brainBits).join("")}</td>
                      <td className="mono" title={JSON.stringify(s)}>
                        0x{r.word.toString(16).padStart(4, "0")}
                      </td>
                      <td className="mono">
                        {wordToBits(r.chain.next, brainBits).join("")} / {r.chain.outputs}
                      </td>
                      <td className="mono">
                        {wordToBits(r.local.next, brainBits).join("")} / {r.local.outputs}
                      </td>
                      <td className={same ? "v-ok" : "v-bad"}>{same ? t.match : t.differ}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export function DiaryPanel({
  lang,
  check,
  pet,
  onRetry,
}: {
  lang: Lang;
  check: DiaryCheck | null;
  pet: Pick<ChainPet, "born" | "checkedAt">;
  onRetry: () => void;
}) {
  const diary = check?.diary ?? null;
  const diaryState = check?.state ?? "none";
  // the log holds more beats than the minutes X Layer shows between the hatching and the latest save: told in beats
  const untimed = !!pet && check?.beats !== undefined && beatsOutrunChain(check.beats, pet.born, pet.checkedAt);
  const chainSpan = pet ? Math.max(0, pet.checkedAt - pet.born) : 0;
  const spanText = (en: boolean) =>
    chainSpan < 120
      ? en
        ? `${chainSpan} seconds`
        : `${chainSpan} 秒`
      : en
        ? `${Math.round(chainSpan / 60)} minutes`
        : `${Math.round(chainSpan / 60)} 分钟`;
  return (
    <>
      {diaryState !== "none" && (
        <div className="v-diary">
          <p className="v-sub">{lang === "zh" ? "它的日记" : "Its diary"}</p>
          {diaryState === "checking" && (
            <p className="v-note">
              {lang === "zh" ? "正在对照链上核对它的日记……" : "Checking its diary against the chain…"}
            </p>
          )}
          {diaryState === "waiting" && (
            <p className="v-note">
              {lang === "zh"
                ? "正在等灵犀的索引服务从 X Layer 读到它的孵化（每 15 秒读一次新区块），读到后就核对它的日记……"
                : "Waiting for Lingxi's indexer to read its hatching from X Layer (it reads new blocks every 15 seconds); its diary is checked as soon as it has…"}
            </p>
          )}
          {diaryState === "unread" && (
            <div className="v-note" data-diary="unread">
              <p>
                {lang === "zh"
                  ? "这次没能读到它发布的日记（灵犀的服务器或 X Layer 没有回答），所以还没有核对。这不代表它没有日记。"
                  : "Its published diary could not be read this time (Lingxi's server or X Layer did not answer), so it has not been checked. That does not mean it has none."}
              </p>
              <button type="button" className="v-run" onClick={onRetry}>
                {lang === "zh" ? "再试一次" : "Try again"}
              </button>
            </div>
          )}
          {diaryState === "unindexed" && (
            <p className="v-note">
              {lang === "zh"
                ? "它的孵化还没被索引，所以暂时核对不了它的日记。过几分钟再打开这一页。"
                : "Its hatching isn't indexed yet, so its diary can't be checked right now. Open this page again in a few minutes."}
            </p>
          )}
          {diaryState === "birth" && (
            <p className="v-note">
              {lang === "zh"
                ? "它发布的日记从它在浏览器里出生时记起，早于它上链（灵犀在 11 月 20 日之前都是这样上链的），所以链上无法为它锚定起点，这里不显示。下面的日志核对说明了它能证明什么。"
                : "Its published diary runs from its birth in the browser, before it was kept on X Layer (Lingxi kept pets that way until 20 November), so the chain cannot anchor where it starts, and it isn't shown. The log check below says what it does show."}
            </p>
          )}
          {diaryState === "bad" && (
            <p className="v-bad">
              {lang === "zh"
                ? "发布的日记没能通过链上核对（原因见下面的日志核对），所以不显示。"
                : "The published diary did not pass the check against the chain (the log check below says why), so it isn't shown."}
            </p>
          )}
          {diaryState === "ok" && diary && (
            <>
              <p className="v-note">
                {lang === "zh"
                  ? "最近一天，用锚定在链上事件的大脑逐刻重放得来，并与链上保存的记忆一致。"
                  : "Its latest day, replayed moment by moment through brains anchored to its events on chain, ending at exactly the memory saved on chain."}
              </p>
              {untimed && (
                <p className="v-note" data-diary="untimed">
                  {lang === "zh"
                    ? `它的日志有 ${check!.beats} 拍，但 X Layer 上从它孵化到最近一次存档只隔了 ${spanText(false)}，所以这些拍不是一分钟一拍过完的；日记按日志里的拍来说，不说多少分钟。`
                    : `Its log holds ${check!.beats} beats, but X Layer shows only ${spanText(true)} between its hatching and its latest save, so those beats were not lived a minute each; the diary counts beats of the log, not minutes.`}
                </p>
              )}
              <ul>
                {diary.map((l, i) => (
                  <li key={i}>{diaryText(l, lang, { untimed })}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
