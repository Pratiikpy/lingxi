/** The decorate bar over the home room: buy pieces with coins, pick one, tap the room to place it. */

import { useEffect, useRef } from "react";
import { CHAIN_DECOR, DECOR, decorOf } from "@lingxi/world";
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
      <ul className="decor-list">
        {[...DECOR.filter((p) => !p.gift || d.owned.includes(p.id)), ...CHAIN_DECOR.filter((p) => (d.chainHeld ?? []).includes(p.id))].map((p) => {
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
    </div>
  );
}
