/**
 * X1: circuits you own on X Layer, taught as everyday instincts. Connect a
 * wallet, list the circuits it owns on a processor, and teach one whose pins fit
 * a pet's brain. When the instinct wants anything, it answers; otherwise the
 * pet's own brain does. Its maker is credited, and ownership is checked again on
 * the chain at the moment it is taught.
 */

import { useState } from "react";
import type { Address } from "viem";
import { AdoptError, processorAbi, readOutsideCircuit } from "@lingxi/chain";
import { INSTINCT_MAX_GATES, MAX_MIND_STATE, type Pet, instinctBrain } from "@lingxi/game";
import { useLang } from "../i18n";
import { connectWallet, deployment, publicClient } from "../game/chain";
import { brainOf, useGame } from "../game/store";
import { play } from "../game/sound";
import { errorText } from "../game/errorText";

type Lang = "en" | "zh";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** The most circuit numbers read when listing what a wallet owns on one processor. */
const SCAN_LIMIT = 300;

interface Owned {
  processor: string;
  id: string;
  gates: number;
  nState: number;
}

export function OwnedInstinctPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const teach = useGame((s) => s.teachInstinct);
  const forget = useGame((s) => s.forgetInstinct);
  const [address, setAddress] = useState<string | null>(null);
  const [processor, setProcessor] = useState((deployment?.processor as string | undefined) ?? "");
  const [owned, setOwned] = useState<Owned[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const room = MAX_MIND_STATE - brainOf({ ...pet, outside: undefined }).nState;

  const connect = async () => {
    setNote("");
    try {
      const w = await connectWallet();
      setAddress(w.account!.address);
    } catch (e) {
      setNote(
        errorText(e) === "noWallet"
          ? L(
              "No wallet found in this browser. Open Lingxi in the OKX Wallet app, or a browser with a wallet.",
              "这个浏览器里没有钱包。请在 OKX 钱包应用里打开灵犀，或用装了钱包的浏览器。",
            )
          : L("The wallet didn't connect.", "钱包没有连上。"),
      );
    }
  };

  const scan = async () => {
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(processor.trim())) return;
    setBusy("scan");
    setNote("");
    setOwned(null);
    try {
      const cpu = processor.trim() as Address;
      const next = Number(await publicClient.readContract({ address: cpu, abi: processorAbi, functionName: "nextId" }));
      // nextId can name the newest circuit itself, so it is included; a number with no circuit is skipped
      const ids = Array.from({ length: Math.max(0, Math.min(next, SCAN_LIMIT)) }, (_, i) => BigInt(i + 1));
      const found: Owned[] = [];
      for (const id of ids) {
        const who = (await publicClient
          .readContract({ address: cpu, abi: processorAbi, functionName: "ownerOf", args: [id] })
          // a circuit whose owner cannot be read is left out of this list, never shown as the wallet's
          .catch(() => "")) as string;
        if (who.toLowerCase() !== address.toLowerCase()) continue;
        const info = (await publicClient.readContract({
          address: cpu,
          abi: processorAbi,
          functionName: "circuitInfo",
          args: [id],
        })) as readonly [bigint, bigint, bigint, bigint];
        if (Number(info[0]) === 16 && Number(info[1]) === 8)
          found.push({
            processor: cpu.toLowerCase(),
            id: id.toString(),
            gates: Number(info[3]),
            nState: Number(info[2]),
          });
      }
      setOwned(found);
      if (next > SCAN_LIMIT)
        setNote(
          L(
            `Only the first ${SCAN_LIMIT} circuits on this processor were checked.`,
            `只检查了这个处理器上的前 ${SCAN_LIMIT} 个电路。`,
          ),
        );
    } catch {
      setNote(
        L(
          "That processor couldn't be read. Check the address, or try again in a moment.",
          "读不了这个处理器。请检查地址，或稍后再试。",
        ),
      );
    }
    setBusy(null);
  };

  const limit = INSTINCT_MAX_GATES.toLocaleString(lang === "zh" ? "zh-CN" : "en");
  const tooManyGates = (gates: number) =>
    L(
      `That circuit runs ${gates.toLocaleString("en")} gates each beat, more than an instinct may (${limit}): every friend who meets ${pet.name} would have to run it too.`,
      `那个电路每一拍要跑 ${gates.toLocaleString("zh-CN")} 个门，超过本能的上限（${limit} 个）：每个遇到${pet.name}的朋友也都得跑它。`,
    );

  const teachIt = async (o: Owned) => {
    if (!address) return;
    setBusy(o.id);
    setNote("");
    try {
      const c = await readOutsideCircuit(publicClient, o.processor as Address, BigInt(o.id));
      // ownership is checked on the chain now, not taken from the list; an owner X Layer did not give is not someone else's
      if (!c.owner) {
        setNote(
          L(
            "Who owns that circuit couldn't be read just now. Try again in a moment.",
            "刚才没能读到这个电路的拥有者，请稍后再试。",
          ),
        );
      } else if (c.owner.toLowerCase() !== address.toLowerCase()) {
        setNote(L("This wallet doesn't own that circuit any more.", "这个钱包已经不再拥有那个电路了。"));
      } else {
        const r = teach({ processor: c.processor, id: c.id, owner: c.owner.toLowerCase(), parts: c.parts });
        if (r.ok) play("success");
        else if (r.reason === "tooManyGates") setNote(tooManyGates(r.gates));
        else
          setNote(
            r.reason === "tooBig"
              ? L(
                  `Its memory doesn't fit beside ${pet.name}'s: there is room for ${room} more bits.`,
                  `它的记忆放不进${pet.name}的大脑：只剩 ${room} 位的空间。`,
                )
              : r.reason === "tooLong"
                ? L(
                    `That circuit is too big to travel with ${pet.name}: friends, seasons and duels could not read ${pet.name}'s card. An instinct can take up to 12,000 bytes of circuit.`,
                    `那个电路太大，没法跟着${pet.name}走：朋友、赛季和切磋都读不了${pet.name}的卡片。本能的电路最多 12,000 字节。`,
                  )
                : r.reason === "notYours"
                  ? L(`${pet.name} is away or is a friend's pet.`, `${pet.name}不在家，或是朋友托你照看的。`)
                  : L("That circuit can't be read as a pet's brain.", "那个电路读不成宠物的大脑。"),
          );
      }
    } catch (e) {
      setNote(
        e instanceof AdoptError && e.reason === "tooBig"
          ? L("That circuit is too big for a pet to carry on a phone.", "那个电路太大了，宠物在手机上带不动。")
          : L("That circuit couldn't be read just now.", "暂时读不了那个电路。"),
      );
    }
    setBusy(null);
  };

  const current = pet.outside;
  const currentInfo = current ? instinctBrain(current) : null;
  return (
    <div className="chainpanel owned-instinct">
      <p className="label">{L("An instinct from a circuit you own", "来自你拥有的电路的本能")}</p>
      <p className="small">
        {L(
          `A circuit you own on X Layer can become ${pet.name}'s instinct when its pins fit a pet's brain (16 in, 8 out), it runs in at most ${INSTINCT_MAX_GATES.toLocaleString("en")} gates and its memory fits beside ${pet.name}'s: whenever it wants something, it answers; otherwise ${pet.name}'s own brain does. On chain, a new circuit points at both, so the chain shows which circuits it thinks with.`,
          `你在 X Layer 上拥有的电路，只要引脚接得上宠物大脑（16 进 8 出）、运行不超过 ${INSTINCT_MAX_GATES.toLocaleString("zh-CN")} 个门、记忆放得进${pet.name}的大脑，就能成为${pet.name}的本能：它想做什么时由它回答，否则由${pet.name}自己的大脑回答。在链上，会有一个新电路同时指向两者，链上能看出它用哪些电路思考。`,
        )}
      </p>
      {current && (
        <div className="owned-current" role="status">
          <p className="small">
            <b>{L(`${pet.name}'s instinct: circuit #${current.id}`, `${pet.name}的本能：#${current.id} 号电路`)}</b>
            <br />
            {L(
              `on ${short(current.processor)} · made and owned by ${current.owner ? short(current.owner) : "unknown"}`,
              `在 ${short(current.processor)} 上 · 作者和拥有者 ${current.owner ? short(current.owner) : "未知"}`,
            )}
            {currentInfo
              ? L(
                  ` · ${currentInfo.gates} gates · ${currentInfo.nState} memory bits`,
                  ` · ${currentInfo.gates} 个门 · ${currentInfo.nState} 位记忆`,
                )
              : ""}
          </p>
          <button type="button" className="btn" onClick={() => (play("tap"), forget())}>
            {L("Forget this instinct", "忘掉这个本能")}
          </button>
        </div>
      )}
      {!address ? (
        <button type="button" className="btn" onClick={() => (play("tap"), void connect())}>
          {L("Connect a wallet to see your circuits", "连接钱包，看看你的电路")}
        </button>
      ) : (
        <>
          <p className="small">{L(`Wallet ${short(address)}`, `钱包 ${short(address)}`)}</p>
          <form
            className="sp-chain-form owned-form"
            onSubmit={(e) => {
              e.preventDefault();
              void scan();
            }}
          >
            <input
              value={processor}
              onChange={(e) => setProcessor(e.target.value)}
              placeholder="0x…"
              aria-label={L("Processor address", "处理器地址")}
              spellCheck={false}
            />
            <button type="submit" className="btn" disabled={busy !== null}>
              {busy === "scan" ? L("Looking…", "查找中……") : L("List my circuits", "列出我的电路")}
            </button>
          </form>
          {owned && !owned.length && (
            <p className="small">
              {L(
                "This wallet owns no circuit with a pet's pins on that processor.",
                "这个钱包在那个处理器上没有引脚接得上宠物大脑的电路。",
              )}
            </p>
          )}
          {owned && owned.length > 0 && (
            <ul className="owned-list">
              {owned.map((o) => {
                // the processor's count is at least what it runs, so one past the budget here is past it for sure (A38)
                const runs = o.gates <= INSTINCT_MAX_GATES;
                const fits = o.nState <= room;
                const isCurrent = current?.processor === o.processor && current.id === o.id;
                return (
                  <li key={`${o.processor}:${o.id}`}>
                    <span>
                      <b>{L(`Circuit #${o.id}`, `#${o.id} 号电路`)}</b>
                      <span className="small">
                        {L(
                          ` · ${o.gates.toLocaleString("en")} gates · ${o.nState} memory bits`,
                          ` · ${o.gates.toLocaleString("zh-CN")} 个门 · ${o.nState} 位记忆`,
                        )}
                      </span>
                      {/* said on the page, not only in a tooltip a phone never shows (A38) */}
                      {!runs && <span className="small sp-warn owned-why">{tooManyGates(o.gates)}</span>}
                    </span>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!fits || !runs || isCurrent || busy !== null}
                      onClick={() => void teachIt(o)}
                    >
                      {isCurrent
                        ? L("Its instinct", "已是本能")
                        : busy === o.id
                          ? L("Reading…", "读取中……")
                          : !runs
                            ? L("Too many gates", "门太多")
                            : fits
                              ? L("Teach as instinct", "教成本能")
                              : L("Too much memory", "记忆太多")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {note && (
        <p className="small sp-warn" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
