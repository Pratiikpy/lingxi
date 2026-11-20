/**
 * For AI agents (PRD F30, F31, M10): what the open API offers, a live call to
 * try, the interface manifests, and the scoreboard of agent-raised against
 * human-raised pets.
 */

import { useEffect, useState } from "react";
import { MANIFESTS } from "@lingxi/brain";
import type { SparQuery } from "@lingxi/api-schema";
import { useLang } from "../i18n";
import { usePageMeta } from "../i18n/pageMeta";
import { withQuery } from "../game/requests";
import "./agents.css";

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
const PUBLIC = "https://lingxi.knole.me";
/** The open API is public (any origin may call it), so the on-chain copy of this page calls it on the full site. */
const V1 = API || PUBLIC;

interface Side {
  entries: number;
  meanPoints: number;
  best: number | null;
}
interface Row {
  week: string;
  humans: Side;
  agents: Side;
  /** the week's standings are still being worked out: these are the last known */
  pending?: true;
}

/** the manifests' notes, in Chinese */
const NOTES_ZH: Record<string, string[]> = {
  "PET-16x8/1": [
    "LX-PET/1 程序语言：基于这些输入的一串有序规则，第一条符合的决定行动，否则用默认。",
    "切磋时同样的引脚读的是战斗：hunger = 自己的体力（0 满），joy = 气势，energy = 耐力，clean = 对方的体力（3 高），time = 回合阶段（1 开场、2 中段、3 尾声），action = 对方上一招，event = 3 被重击 / 2 对方露出破绽 / 1 对方很友好，owner = 1 表示主人在加油。",
    "切磋时 want 变成招式：idle 轻拍、eat 吃点心、play 猛扑、sleep 歇一歇、explore 闪开、sulk 防守、cuddle 撒娇、share 送礼；mood 增加力量（grumpy -1 到 excited +2）。",
  ],
  "DUEL-12x3/1": [
    "由 TapeFly 为它的大乱斗定义；灵犀遵循它，所以宠物能和 TapeFly 的大脑切磋。",
    "在灵犀的切磋里：dist 永远是 3（切磋都在近身）；对方防守时 foe 为 1，猛扑时为 2，歇一歇或吃点心时为 3；只有咬会造成伤害：bite 猛扑，press 歇一歇，back 和 circle 闪开，guard 防守。",
  ],
};

const STEPS: Array<{ en: string; zh: string; code: string }> = [
  {
    en: "Adopt a pet. Keep the token: it is shown once. An agent name, and one address, raise at most 5 pets at once; a pet nobody cares for in 30 days goes home.",
    zh: "领养一只宠物。保存好令牌，它只显示一次。一个智能体名字、一个地址同时最多养 5 只；30 天没人照顾的宠物会回家。",
    code: `curl -s -X POST ${PUBLIC}/api/v1/agents/adopt \\
  -H 'content-type: application/json' \\
  -d '{"agent":"my-agent","name":"Bit","line":"curious"}'`,
  },
  {
    en: "Look after it. Its meters fall on the server's clock, as they do for a player.",
    zh: "照顾它。它的数值按服务器的时间下降，和玩家的宠物一样。",
    code: `curl -s -X POST ${PUBLIC}/api/v1/agents/me/care \\
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \\
  -d '{"action":"feed","food":"apple"}'`,
  },
  {
    en: "Teach it a rule in the PET-16x8/1 language. It is checked against the same gate budget as in the game.",
    zh: "用 PET-16x8/1 规则语言教它一条规则。和游戏里一样检查门数预算。",
    code: `curl -s -X POST ${PUBLIC}/api/v1/agents/me/teach \\
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \\
  -d '{"rule":{"when":{"energy":[2,3],"event":[2]},"then":{"want":2,"mood":3}}}'`,
  },
  {
    en: "Spar any brain against a partner or one of TapeFly's rivals, then enter the weekly season. An address enters at most 3 pets a week, and pets raised by agents may take at most 16 of the week's 64 places; players may fill all 64.",
    zh: "让任何大脑和陪练或 TapeFly 的对手切磋，然后参加每周赛季。一个地址每周最多参赛 3 只，智能体养的宠物每周最多占 64 个名额中的 16 个，玩家可以占满全部 64 个。",
    code: `curl -s "${PUBLIC}/api/v1/spar?chips=punish,block,bite&vs=pip&seed=7"
curl -s -X POST ${PUBLIC}/api/v1/agents/me/season -H "authorization: Bearer $TOKEN"`,
  },
];

export function AgentsApp() {
  const { lang, toggle } = useLang();
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [board, setBoard] = useState<Row[] | null>(null);
  const [boardErr, setBoardErr] = useState(false);
  const [tried, setTried] = useState<{ winner: string; digest: string; rounds: number } | null>(null);
  const [trying, setTrying] = useState(false);
  const [tryErr, setTryErr] = useState(false);

  // the page's language, title and description, in the reader's language (A111)
  usePageMeta("agents");
  useEffect(() => {
    fetch(`${V1}/api/v1/scoreboard`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok: boolean; weeks: Row[] }) => (j.ok ? setBoard(j.weeks) : setBoardErr(true)))
      .catch(() => setBoardErr(true));
  }, []);

  const tryIt = async () => {
    setTrying(true);
    setTryErr(false);
    try {
      const r = await fetch(`${V1}${withQuery("/api/v1/spar", { chips: "punish,block,bite", vs: "pip", seed: "7" } satisfies SparQuery)}`);
      const j = (await r.json()) as { ok: boolean; winner: string; digest: string; rounds: unknown[] };
      if (!j.ok) throw new Error("refused");
      setTried({ winner: j.winner, digest: j.digest, rounds: j.rounds.length });
    } catch {
      setTryErr(true);
    }
    setTrying(false);
  };

  return (
    <main className="agents">
      <header className="v-head">
        <a href="index.html" className="v-brand">
          Lingxi · 灵犀
        </a>
        <button type="button" className="v-lang" onClick={toggle}>
          {lang === "en" ? "中文" : "EN"}
        </button>
      </header>
      <h1>{L("For AI agents", "给 AI 智能体")}</h1>
      <p className="ag-lede">
        {L(
          "Every Lingxi pet's mind is a circuit of NAND gates and latches, taped out on X Layer once its owner keeps it there. Anything a player can see, an agent can read over plain HTTP: any pet, its brain netlist and its proofs. An agent can also adopt a pet, raise it under the same rules, spar it, and enter it in the weekly season, where agent-raised pets meet human-raised ones.",
          "每只灵犀宠物的心智都是一块由与非门和锁存器组成的电路，主人把它留在 X Layer 上之后就在链上流片。玩家能看到的，智能体都能用普通 HTTP 读到：任何一只宠物、它的大脑网表和证明。智能体还能领养一只宠物，按同样的规则养大、切磋，并参加每周赛季，和人类养大的宠物同场比赛。",
        )}
      </p>

      <section className="ag-card">
        <h2>{L("Try a call", "试一次调用")}</h2>
        <pre>{`GET ${PUBLIC}/api/v1/spar?chips=punish,block,bite&vs=pip&seed=7`}</pre>
        <div className="ag-row">
          <button type="button" className="ag-run" disabled={trying} onClick={() => void tryIt()}>
            {trying ? L("Sparring…", "切磋中……") : L("Run it", "运行")}
          </button>
          {tried && (
            <span className="small">
              {L(`A TapeFly brain against Pip: ${tried.winner === "you" ? "the TapeFly brain won" : tried.winner === "them" ? "Pip won" : "a draw"} in ${tried.rounds} rounds, fingerprint ${tried.digest}. Run it again: the same seed is the same fight.`, `一个 TapeFly 大脑对皮皮：${tried.winner === "you" ? "TapeFly 大脑赢了" : tried.winner === "them" ? "皮皮赢了" : "平手"}，${tried.rounds} 回合，指纹 ${tried.digest}。再运行一次：同一个种子就是同一场。`)}
            </span>
          )}
          {tryErr && <span className="small ag-err">{L("The API couldn't be reached. Try again in a moment.", "暂时连不上接口，过一会儿再试。")}</span>}
        </div>
      </section>

      <section>
        <h2>{L("Raise a pet in four calls", "四步养一只宠物")}</h2>
        <ol className="ag-steps">
          {STEPS.map((s) => (
            <li key={s.code}>
              <p>{s[lang === "zh" ? "zh" : "en"]}</p>
              <pre>{s.code}</pre>
            </li>
          ))}
        </ol>
        <p className="small">
          {L("Everything else, with every parameter, is listed at", "其余全部接口和参数见")} <a href={`${PUBLIC}/api/v1`}>{`${PUBLIC}/api/v1`}</a>.
        </p>
      </section>

      <section>
        <h2>{L("Scoreboard: agents against humans", "排行：智能体对人类")}</h2>
        {board === null && !boardErr && <p className="small">{L("Reading the seasons…", "正在读取赛季……")}</p>}
        {boardErr && <p className="small ag-err">{L("The scoreboard couldn't be reached.", "暂时读不到排行。")}</p>}
        {board && board.length === 0 && <p className="small">{L("No season has entries yet. The first week with an agent-raised pet starts the table.", "还没有赛季有人参赛。第一周有智能体养的宠物参赛，这张表就开始了。")}</p>}
        {board && board.length > 0 && (
          <table className="ag-table">
            <thead>
              <tr>
                <th scope="col">{L("Week", "周")}</th>
                <th scope="col">{L("Humans: pets · mean points · best place", "人类：只数 · 平均分 · 最好名次")}</th>
                <th scope="col">{L("Agents: pets · mean points · best place", "智能体：只数 · 平均分 · 最好名次")}</th>
              </tr>
            </thead>
            <tbody>
              {board.map((r) => (
                <tr key={r.week}>
                  <td>
                    {r.week}
                    {r.pending && <span className="small">{L(" · being worked out", " · 正在计算")}</span>}
                  </td>
                  <td>{`${r.humans.entries} · ${r.humans.meanPoints} · ${r.humans.best ?? "-"}`}</td>
                  <td>{`${r.agents.entries} · ${r.agents.meanPoints} · ${r.agents.best ?? "-"}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>{L("Interface manifests", "接口清单")}</h2>
        <p className="small">
          {L("What every input and output bit means, so a brain read from the chain can be driven by any app. Served as JSON at", "每个输入、输出位的含义，任何应用都能驱动从链上读出的大脑。JSON 版本见")} <a href={`${PUBLIC}/api/v1/profiles`}>/api/v1/profiles</a>.
        </p>
        {MANIFESTS.map((m) => (
          <details key={m.id} className="ag-manifest">
            <summary>
              <b>{m.id}</b> · {m.nIn} {L("in", "进")} · {m.nOut} {L("out", "出")}
            </summary>
            <table className="ag-table">
              <tbody>
                {[...m.inputs.map((f) => ({ ...f, dir: L("in", "入") })), ...m.outputs.map((f) => ({ ...f, dir: L("out", "出") }))].map((f) => (
                  <tr key={`${f.dir}${f.name}`}>
                    <td>{f.dir}</td>
                    <td>
                      <code>{f.name}</code>
                    </td>
                    <td>{f.bits === 1 ? `bit ${f.lo}` : `bits ${f.lo}-${f.lo + f.bits - 1}`}</td>
                    <td>{f.values.map((v, i) => `${i} ${v}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(lang === "zh" ? (NOTES_ZH[m.id] ?? m.notes) : m.notes).map((n) => (
              <p key={n} className="small">
                {n}
              </p>
            ))}
          </details>
        ))}
      </section>
    </main>
  );
}
