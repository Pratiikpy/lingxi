/** The decorate bar over the home room: buy pieces with coins, pick one, tap the room to place it. */

import { useEffect, useRef } from "react";
import { CHAIN_DECOR, COMMISSIONS, DECOR, ITEM, decorOf, roomCapacity, stageReached } from "@lingxi/world";
import { stageOf } from "@lingxi/game";
import { useGame } from "../game/store";
import { now } from "../game/gameClock";
import { type Key, useLang, useT } from "../i18n";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import "./decor.css";

export function DecorIcon({ rows, colors }: { rows: readonly string[]; colors: Record<string, string> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = Math.max(...rows.map((r) => r.length));
    el.width = w;
    el.height = rows.length;
    const ctx = el.getContext("2d")!;
    ctx.clearRect(0, 0, w, rows.length);
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) {
        const c = colors[r[x]!];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });
  }, [rows, colors]);
  return <canvas ref={ref} className="pixel decor-icon" aria-hidden="true" />;
}

export function DecorBar({ selected, onSelect, onDone }: { selected: string | null; onSelect: (id: string | null) => void; onDone: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const world = useWorld((s) => s.world);
  const buy = useWorld((s) => s.buyDecor);
  const d = decorOf(world);
  return (
    <div className="decor-bar" role="toolbar" aria-label={t("decor.title")}>
      <div className="decor-head">
        <b>{t("decor.title")}</b>
        <span>{t("decor.coins" as Key, { n: world.coins })}</span>
        <button type="button" className="btn primary" onClick={() => (play("tap"), onDone())}>
          {t("decor.done")}
        </button>
      </div>
      <p className="decor-hint">{t("decor.hint")}</p>
      <p className="decor-hint">{lang === "zh" ? `已摆 ${d.placed.length}/${roomCapacity(world)} 件` : `${d.placed.length} of ${roomCapacity(world)} pieces placed`}</p>
      <ul className="decor-list">
        {[...DECOR.filter((p) => !p.commission && (!p.gift || d.owned.includes(p.id))), ...CHAIN_DECOR.filter((p) => (d.chainHeld ?? []).includes(p.id))].map((p) => {
          // an on-chain piece is placed while a wallet holds it (plan 4.6); it is never bought here
          const owned = d.owned.includes(p.id) || (!!p.chain && (d.chainHeld ?? []).includes(p.id));
          const placed = d.placed.some((x) => x.id === p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`decor-piece${selected === p.id ? " on" : ""}${owned ? "" : " shop"}`}
                aria-pressed={selected === p.id}
                onClick={() => {
                  if (owned) {
                    play("tap");
                    onSelect(selected === p.id ? null : p.id);
                  } else if (buy(p.id)) onSelect(p.id);
                }}
              >
                <DecorIcon rows={p.rows} colors={p.colors} />
                <span>{p.name[lang as "en" | "zh"]}</span>
                <small>{owned ? (placed ? "✓" : p.chain ? "⛓" : "") : t("decor.buy" as Key, { price: p.price })}</small>
              </button>
            </li>
          );
        })}
      </ul>
      <Commissions selected={selected} onSelect={onSelect} />
    </div>
  );
}

const STAGE_NAME: Record<string, [string, string]> = { child: ["child", "幼年"], teen: ["teen", "少年"], adult: ["adult", "成年"], elder: ["elder", "老年"] };

/** The Builder's commissions (G6): made to order from planks, bars and stone blocks, one or two for each stage. */
function Commissions({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const world = useWorld((s) => s.world);
  const commission = useWorld((s) => s.commission);
  const pet = useGame((s) => s.pet);
  const stage = pet ? stageOf(pet, now()) : "baby";
  const d = decorOf(world);
  return (
    <section className="decor-commissions" aria-label={zh ? "建设者的委托" : "Builder's commissions"}>
      <p className="decor-hint">
        <b>{zh ? "建设者的委托" : "Builder's commissions"}</b>
        {zh ? "：用金币和材料（木板、金属条、石块）定做，宠物长大一个阶段就多一件可以做。" : ": made to order for coins and materials (planks, metal bars, stone blocks). Each stage your pet reaches opens more."}
      </p>
      <ul className="decor-list">
        {COMMISSIONS.map((p) => {
          const c = p.commission!;
          const owned = d.owned.includes(p.id);
          const placed = d.placed.some((x) => x.id === p.id);
          const open = stageReached(stage, c.stage);
          const mats = c.ins.map((x) => `${x.amount} ${ITEM[x.item]?.name[zh ? "zh" : "en"] ?? ""}`).join(zh ? "、" : ", ");
          const have = c.ins.every((x) => (world.bag[x.item] ?? 0) >= x.amount) && world.coins >= p.price;
          const status = owned ? (placed ? "✓" : "") : !open ? (zh ? `${STAGE_NAME[c.stage]![1]}起` : `from ${STAGE_NAME[c.stage]![0]}`) : zh ? `${p.price} 金币 + ${mats}` : `${p.price} coins + ${mats}`;
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`decor-piece${selected === p.id ? " on" : ""}${owned ? "" : " shop"}${!owned && (!open || !have) ? " locked" : ""}`}
                aria-pressed={selected === p.id}
                aria-label={owned ? p.name[zh ? "zh" : "en"] : `${p.name[zh ? "zh" : "en"]}: ${status}`}
                onClick={() => {
                  if (owned) {
                    play("tap");
                    onSelect(selected === p.id ? null : p.id);
                  } else if (commission(p.id)) onSelect(p.id);
                }}
              >
                <DecorIcon rows={p.rows} colors={p.colors} />
                <span>{p.name[zh ? "zh" : "en"]}</span>
                <small>{status}</small>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
