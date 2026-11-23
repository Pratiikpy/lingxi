/**
 * The tree of life (PRD Z6): every Lingxi pet ever hatched or bred on X Layer,
 * as one family. Founders first, then each pair with the little ones they
 * raised; any pet can be looked up for its generation, its ancestors and the
 * owners credited down the generations.
 */

import { startTransition, useEffect, useMemo, useState } from "react";
import { boundingBox, drawPet } from "@lingxi/art";
import { revealHidden } from "@lingxi/game";
import { useLang } from "../i18n";
import { usePageMeta } from "../i18n/pageMeta";
import { PALETTE_OF } from "../scene/palette";
import { Sprite } from "../play/Sprite";
import { Named } from "../play/Named";
import "../agents/agents.css";
import "./tree.css";

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
const TX = (tx: string) => `https://www.oklink.com/xlayer/tx/${tx}`;
const LINES = ["gentle", "bold", "curious"] as const;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

interface Node {
  id: string;
  line: number;
  owner: string | null;
  parents: [string, string] | null;
  children: string[];
  block: number;
  tx: string;
  at: number;
  name?: string;
  colour?: number;
  generation: number;
  ancestors: string[];
  designers: string[];
}
interface TreeData {
  indexedTo: number;
  pets: Node[];
  founders: number;
  families: number;
  generations: number;
}

function PetArt({ line, generation }: { line: number; generation: number }) {
  const l = LINES[line] ?? "gentle";
  const { canvas, crop } = useMemo(() => {
    const c = drawPet(l, generation ? "child" : "adult", { expression: "happy" });
    const b = boundingBox(c);
    return { canvas: c, crop: { x: Math.max(0, b.x - 1), y: Math.max(0, b.y - 1), w: Math.min(c.w, b.w + 2), h: Math.min(c.h, b.h + 2) } };
  }, [l, generation]);
  return <Sprite canvas={canvas} palette={PALETTE_OF[l]} scale={2} crop={crop} />;
}

function Chip({ n, onPick, picked }: { n: Node; onPick: (id: string) => void; picked: boolean }) {
  return (
    <button type="button" className={`tl-chip${picked ? " is-picked" : ""}`} onClick={() => onPick(n.id)} aria-pressed={picked}>
      <PetArt line={n.line} generation={n.generation} />
      <Named name={n.name || `#${n.id}`} colour={n.colour} />
      <span>
        #{n.id}
        {n.owner ? ` · ${short(n.owner)}` : ""}
      </span>
    </button>
  );
}

export function TreeApp() {
  const { lang, toggle } = useLang();
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [data, setData] = useState<TreeData | null>(null);
  // the on-chain copy has no indexer of its own; the tree is read on the full site
  const [err, setErr] = useState(!API);
  const [query, setQuery] = useState(() => location.hash.replace("#", ""));
  const [picked, setPicked] = useState<string | null>(() => location.hash.replace("#", "") || null);

  // the page's language, title and description, in the reader's language (A111)
  usePageMeta("tree");
  useEffect(() => {
    if (!API) return;
    fetch(`${API}/api/tree`, { cache: "no-store" })
      .then((r) => r.json())
      // P3: the family's cards render in a transition, in short slices, so the page answers while they draw
      .then((j: TreeData & { ok: boolean }) => startTransition(() => (j.ok ? setData(j) : setErr(true))))
      .catch(() => setErr(true));
  }, []);

  const byId = useMemo(() => new Map((data?.pets ?? []).map((p) => [p.id, p])), [data]);
  const families = useMemo(() => {
    const groups = new Map<string, Node[]>();
    for (const p of data?.pets ?? []) if (p.parents) groups.set([...p.parents].sort((a, b) => Number(a) - Number(b)).join("+"), [...(groups.get([...p.parents].sort((a, b) => Number(a) - Number(b)).join("+")) ?? []), p]);
    return [...groups.entries()];
  }, [data]);
  const pick = (id: string) => {
    setPicked(id);
    setQuery(id);
    history.replaceState(null, "", `#${id}`);
  };
  const chosen = picked ? byId.get(picked) : undefined;
  const nameOf = (id: string) => revealHidden(byId.get(id)?.name ?? "").text || `#${id}`;

  return (
    <main className="agents tree">
      <header className="v-head">
        <a href="index.html" className="v-brand">
          Lingxi · 灵犀
        </a>
        <button type="button" className="v-lang" onClick={toggle}>
          {lang === "en" ? "中文" : "EN"}
        </button>
      </header>
      <h1>{L("The tree of life", "生命之树")}</h1>
      <p className="ag-lede">
        {L(
          "Every Lingxi pet ever hatched or bred on X Layer, as one family. Each little one is born with a mind woven from its two parents' circuits, carrying the lessons of the owners who raised its line; its parents stay on record even if its brain changes later. The tree is read from PetRegistry's events, which anyone can re-read.",
          "每一只在 X Layer 上孵化或出生的灵犀宠物，组成同一个大家庭。小宝宝出生时，心智由父母两块电路织成，带着养大它这一脉的主人们教过的东西；即使它的大脑以后换了，父母也一直记录在链上。这棵树读自 PetRegistry 的链上事件，任何人都能重新核对。",
        )}
      </p>

      {err && (
        <p className="ag-card">
          {API
            ? L("The tree couldn't be read just now. The chain's events are still there: try again in a moment.", "暂时读不到这棵树。链上事件还在，请稍后再试。")
            : L("The tree is read from PetRegistry's events by Lingxi's indexer, which this on-chain copy doesn't use. ", "这棵树由灵犀的索引器从 PetRegistry 的事件读出，这份链上版本不使用它。")}
          {!API && (
            <a href="https://lingxi.knole.me/tree.html" target="_blank" rel="noopener noreferrer">
              {L("See it on lingxi.knole.me", "到 lingxi.knole.me 查看")}
            </a>
          )}
        </p>
      )}
      {!data && !err && <p className="ag-card tl-loading">{L("Reading the chain…", "正在读取链上记录……")}</p>}

      {data && (
        <>
          <dl className="tl-stats">
            <div>
              <dt>{L("Pets", "宠物")}</dt>
              <dd>{data.pets.length}</dd>
            </div>
            <div>
              <dt>{L("Founders", "始祖")}</dt>
              <dd>{data.founders}</dd>
            </div>
            <div>
              <dt>{L("Families", "家庭")}</dt>
              <dd>{data.families}</dd>
            </div>
            <div>
              <dt>{L("Generations", "代数")}</dt>
              <dd>{data.generations}</dd>
            </div>
          </dl>
          <p className="small tl-indexed">{L(`Read up to X Layer block ${data.indexedTo.toLocaleString("en")}.`, `已读到 X Layer 第 ${data.indexedTo.toLocaleString("en")} 个区块。`)}</p>

          <form
            className="ag-card tl-find"
            onSubmit={(e) => {
              e.preventDefault();
              const id = query.replace(/\D/g, "");
              if (id) pick(id);
            }}
          >
            <label htmlFor="tl-q">{L("Find a pet by its number", "按编号查找宠物")}</label>
            <div className="ag-row">
              <input id="tl-q" inputMode="numeric" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="1" />
              <button type="submit" className="ag-run">
                {L("Find", "查找")}
              </button>
            </div>
            {picked && !chosen && <p className="small">{L(`No pet #${picked} on chain yet.`, `链上还没有 #${picked} 号宠物。`)}</p>}
            {chosen && (
              <div className="tl-chosen">
                <PetArt line={chosen.line} generation={chosen.generation} />
                <div>
                  <h2>
                    <Named as="strong" name={chosen.name || `#${chosen.id}`} colour={chosen.colour} /> <span>#{chosen.id}</span>
                  </h2>
                  <p>
                    {chosen.parents
                      ? L(
                          `Generation ${chosen.generation + 1}, the little one of ${nameOf(chosen.parents[0])} and ${nameOf(chosen.parents[1])}.`,
                          `第 ${chosen.generation + 1} 代，是${nameOf(chosen.parents[0])}和${nameOf(chosen.parents[1])}的小宝宝。`,
                        )
                      : L(`A founder: generation 1, hatched from a ${LINES[chosen.line] ?? "gentle"} egg.`, `始祖：第 1 代，从${["温柔", "勇敢", "好奇"][chosen.line] ?? "温柔"}的蛋里孵出来。`)}
                    {chosen.ancestors.length > 2 ? L(` Descended from ${chosen.ancestors.map(nameOf).join(", ")}.`, ` 祖先：${chosen.ancestors.map(nameOf).join("、")}。`) : ""}
                    {chosen.children.length ? L(` Parent of ${chosen.children.map(nameOf).join(", ")}.`, ` 孩子：${chosen.children.map(nameOf).join("、")}。`) : ""}
                  </p>
                  {chosen.designers.length > 0 && (
                    <p className="small">
                      {L("Raised by, down the generations: ", "历代养育它这一脉的主人：")}
                      {chosen.designers.map(short).join(" → ")}
                    </p>
                  )}
                  <p className="ag-row small">
                    <a href={`verify.html#${chosen.id}`}>{L("Check its brain on the proof page", "在证明页核对它的大脑")}</a>
                    <a href={TX(chosen.tx)} target="_blank" rel="noopener noreferrer">
                      {L(chosen.parents ? "Its birth on the explorer" : "Its hatching on the explorer", chosen.parents ? "在浏览器看它的出生" : "在浏览器看它的孵化")}
                    </a>
                  </p>
                </div>
              </div>
            )}
          </form>

          <section className="ag-card">
            <h2>{L("Founders", "始祖")}</h2>
            <p className="small">{L("Pets hatched from an egg. Every family starts with two of them.", "从蛋里孵出来的宠物。每个家庭都从其中两只开始。")}</p>
            {data.founders ? (
              <div className="tl-grid">
                {data.pets
                  .filter((p) => !p.parents)
                  .map((p) => (
                    <Chip key={p.id} n={p} onPick={pick} picked={picked === p.id} />
                  ))}
              </div>
            ) : (
              <p className="small">{L("No pets on chain yet.", "链上还没有宠物。")}</p>
            )}
          </section>

          <section className="ag-card">
            <h2>{L("Families", "家庭")}</h2>
            {families.length ? (
              <ul className="tl-families">
                {families.map(([pair, kids]) => {
                  const [a, b] = pair.split("+") as [string, string];
                  return (
                    <li key={pair} className="tl-family">
                      <div className="tl-parents">
                        {[a, b].map((id) => (byId.get(id) ? <Chip key={id} n={byId.get(id)!} onPick={pick} picked={picked === id} /> : <span key={id} className="tl-chip is-missing">#{id}</span>))}
                      </div>
                      <span className="tl-branch" aria-hidden="true" />
                      <div className="tl-kids">
                        {kids.map((k) => (
                          <Chip key={k.id} n={k} onPick={pick} picked={picked === k.id} />
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="small">
                {L(
                  "No little ones yet. When two best-friend pets raise one, it is born on chain with both parents recorded, and appears here.",
                  "还没有小宝宝。两只成为最好朋友的宠物一起养育时，小宝宝会在链上出生并记下父母，然后出现在这里。",
                )}
              </p>
            )}
          </section>
          <p className="small">
            {L("Names are the ones owners gave in PetLook. Pets that live only on a device, never taped out, are not on this tree.", "名字来自主人在 PetLook 里起的名字。只活在设备上、没有上链的宠物不在这棵树上。")}{" "}
            <a href="play.html">{L("Raise a pet", "养一只宠物")}</a>
          </p>
        </>
      )}
    </main>
  );
}
