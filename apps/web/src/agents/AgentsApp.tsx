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
    "切磋时同样的引脚读的是战斗：hunger = 自己的体力（0 满），joy = 气势，energy = 耐力，clean = 对方的体力（3 高），time = 回合阶段（1 开场、2 中段、3 尾声），action = 对方上一招（0 轻拍、1 吃零食、2 扑击、3 防守、4 休息、5 卖萌、6 闪避、7 送礼），event = 3 被重击 / 2 对方露出破绽 / 1 对方很友好，owner = 1 表示主人在加油。",
    "切磋时 want 变成招式：idle 轻拍、eat 吃零食、play 扑击、sleep 休息、explore 闪避、sulk 防守、cuddle 卖萌、share 送礼。每招都要耐力（轻拍 0、吃零食 1、扑击 3、休息 0 并回 3、闪避 2、防守 1、卖萌 2、送礼 1），耐力付不起的招会变成休息。心情是出手的轻重：从平静起每高一级，出手重 1，挨每一下也多 1（不高兴则轻 1、少挨 1），防守或闪避时不多挨；平静时轻拍会回 1 点耐力。这是切磋版本 LX-SPAR/3；每个结果都写明版本，同一版本里同一个种子就是同一场。",
  ],
  "DUEL-12x3/1": [
    "由 TapeFly 为它的大乱斗定义；灵犀遵循它，所以宠物能和 TapeFly 的大脑切磋。",
    "在灵犀的切磋里：dist 永远是 3（切磋都在近身）；对方防守时 foe 为 1，扑击时为 2，休息或吃零食时为 3；只有咬会造成伤害：bite 扑击，press 休息，back 和 circle 闪避，guard 防守。",
  ],
};

/** TapeAPI's SDK is not on npm; its own README installs it from the release (TapeAPI 1.8.1, the version TAP-13 pins) */
const TAPEAPI_SDK = "https://github.com/BruceLanLan/tapeapi/releases/download/v1.8.1/tapeapi-sdk-1.8.1.tgz";

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
          "Every Lingxi pet's mind is a circuit of NAND gates and latches, taped out on X Layer once its owner keeps it there. An agent can read any pet kept on X Layer over plain HTTP: its record on chain (its latest saved day and log hash) and its brain netlist; the data its proofs are checked against is at /api/pets/:id/history and /api/pets/:id/log. An agent can also adopt a pet, raise it under the same rules, spar it, and enter it in the weekly season, where agent-raised pets meet human-raised ones.",
          "每只灵犀宠物的心智都是一块由与非门和锁存器组成的电路，主人把它留在 X Layer 上之后就在链上流片。智能体可以用普通 HTTP 读取任何一只留在 X Layer 上的宠物：它在链上的记录（最近保存的一天和日志哈希）和大脑网表；核对证明所用的数据在 /api/pets/:id/history 和 /api/pets/:id/log。智能体还能领养一只宠物，按同样的规则养大、切磋，并参加每周赛季，和人类养大的宠物同场比赛。",
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
        <h2>{L("Signed answers you can check", "可以核对的签名回答")}</h2>
        <p className="small">
          {L(
            "Every call above also answers at POST /api/v1/<method>, signed as TAP-13 defines: the answer names the request it answers, the time and our service container, and is signed by a key the holder of circuit #1 delegated in the service's manifest. The manifest is read from that circuit's container on X Layer, so a check needs nothing from this site but the answer.",
            "上面每个调用也可以用 POST /api/v1/<方法> 来调，回答按 TAP-13 签名：回答写明它答的是哪个请求、什么时间、哪个服务容器，并由 1 号电路的持有人在服务清单里授权的密钥签名。清单从这个电路在 X Layer 上的容器里读出，所以核对时除了回答本身，不需要这个网站的任何东西。",
          )}
        </p>
        <pre>{`curl -X POST ${PUBLIC}/api/v1/pet \\
  -H 'content-type: application/json' \\
  -d '{"id":"my-1","params":{"id":"1"}}'`}</pre>
        <p className="small">{L("To check it, TapeAPI's own client resolves the service from X Layer and verifies each answer:", "要核对，可以用 TapeAPI 自己的客户端：它从 X Layer 解析服务，再逐个核验回答：")}</p>
        <pre>{`npm install ${TAPEAPI_SDK}

// save as try.mjs, then run: node try.mjs
import { createTapeAPI, rpcUrlsFor } from '@tapeapi/sdk'

const api = createTapeAPI({ rpcUrls: rpcUrlsFor(196), quiet: true })
const lingxi = await api.resolve('1.2.419.tape')
const { result, verified } = await api.call(lingxi, 'pet', { id: '1' })
console.log(result.name, result.owner, verified)`}</pre>
        <p className="small">
          {L(
            "verified is true only when the signature checks out against the signer the chain names; a changed answer is refused. A signature proves who answered and to which question, not that the answer is right: pets and brains can still be checked against X Layer itself. The manifest, with every method:",
            "只有签名和链上指定的签名者对得上时，verified 才是 true；回答被改过就会被拒绝。签名证明的是谁回答、回答的是哪个问题，而不是回答一定对：宠物和大脑仍然可以直接对照 X Layer 核对。服务清单和全部方法：",
          )}{" "}
          <a href={`${PUBLIC}/.well-known/tapeapi.json`}>/.well-known/tapeapi.json</a>.
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
        <p className="small">
          {L("Every Lingxi circuit you can call on X Layer, with test vectors checked on chain, is in the", "所有能在 X Layer 上调用的灵犀电路，以及在链上核对过的测试向量，都在")}{" "}
          <a href={`${PUBLIC}/circuits.html`}>{L("circuit catalogue", "电路目录")}</a>
          {L(", which runs them with none of Lingxi's code.", "里，那个页面不用灵犀的任何代码就能运行它们。")}
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
