/**
 * The garden (PRD W2, C4): four plots in the Mushroom Garden. Plant a seed from
 * the bag, with compost to halve the wait and add one to the harvest; come back
 * when it is ripe. Away from the garden, a short line says how the plots are
 * doing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { PLOT_COLORS, plotRows } from "@lingxi/art";
import { COMPOST, CROP, CROPS, GARDEN_ROOM, ITEM, ROOMS, gardenOf, plotStage } from "@lingxi/world";
import { useLang } from "../i18n";
import { useWorld } from "../game/world";
import { play } from "../game/sound";

const CROP_COLORS: Record<string, [string, string]> = { apple: ["#E8C14A", "#C98A00"], rice: ["#FFE08A", "#E0A21F"], pepper: ["#E8604A", "#B24A45"], clover: ["#FF9FC0", "#E5486C"] };

function PlotArt({ stage, crop, label }: { stage: 0 | 1 | 2 | 3; crop?: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rows = useMemo(() => plotRows(stage), [stage]);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    const [a, b] = CROP_COLORS[crop ?? "pepper"]!;
    const colors = PLOT_COLORS(a, b);
    c.clearRect(0, 0, 24, 24);
    rows.forEach((row, y) => {
      for (let x = 0; x < 24; x++) {
        const ch = row[x]!;
        if (ch === ".") continue;
        c.fillStyle = colors[ch]!;
        c.fillRect(x, y, 1, 1);
      }
    });
  }, [rows, crop]);
  return <canvas ref={ref} width={24} height={24} className="pixel garden-plot-art" role="img" aria-label={label} />;
}

function left(ms: number, lang: string): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(m / 60);
  return lang === "zh" ? (h ? `${h} 小时 ${m % 60} 分` : `${m} 分钟`) : h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function GardenPanel() {
  const lang = useLang((s) => s.lang);
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const { world, plant, harvest } = useWorld();
  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState<number | null>(null);
  const [useCompost, setUseCompost] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const plots = gardenOf(world);
  const here = world.room === GARDEN_ROOM;
  const seeds = CROPS.filter((c) => (world.bag[c.seed] ?? 0) > 0);
  const compost = world.bag[COMPOST] ?? 0;

  if (!here) {
    const ripe = plots.filter((p) => p && plotStage(p, now).stage === 3).length;
    const growing = plots.filter((p) => p && plotStage(p, now).stage < 3).length;
    if (!ripe && !growing) return null;
    return (
      <p className="small garden-away">
        {L(`Your garden in the ${ROOMS[GARDEN_ROOM]!.name.en}: ${ripe} ripe, ${growing} growing. Walk there to tend it.`, `你在${ROOMS[GARDEN_ROOM]!.name.zh}的园子：${ripe} 块成熟，${growing} 块在长。走过去照料吧。`)}
      </p>
    );
  }

  return (
    <section className="garden" aria-label={L("Garden", "园子")}>
      <p className="label">{L("Your garden plots", "你的菜地")}</p>
      <ul className="garden-plots">
        {plots.map((p, i) => {
          const st = plotStage(p, now);
          const crop = p ? CROP[p.crop] : undefined;
          const name = crop ? crop.name[lang] : L("Bare soil", "空地");
          return (
            <li key={i} className={`garden-plot stage-${st.stage}`}>
              <PlotArt stage={st.stage} crop={p?.crop} label={name} />
              <b>{name}</b>
              {p && st.stage < 3 && <span className="small">{L(`ripe in ${left(st.readyAt! - now, lang)}`, `${left(st.readyAt! - now, lang)}后成熟`)}{p.compost ? L(" · composted", " · 加了堆肥") : ""}</span>}
              {p && st.stage === 3 && (
                <button type="button" className="btn primary" onClick={() => (harvest(i), play("success"))}>
                  {L("Harvest", "收获")}
                </button>
              )}
              {!p && (
                <button type="button" className="btn" disabled={!seeds.length} onClick={() => (play("tap"), setPicking(picking === i ? null : i))} aria-expanded={picking === i}>
                  {L("Plant", "种下")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!seeds.length && plots.some((p) => !p) && <p className="small">{L("No seeds in your bag. The market sells them.", "包里没有种子，集市有卖。")}</p>}
      {picking !== null && seeds.length > 0 && (
        <div className="garden-pick">
          <label className="garden-compost">
            <input type="checkbox" checked={useCompost && compost > 0} disabled={compost < 1} onChange={(e) => setUseCompost(e.target.checked)} />
            <span>{compost > 0 ? L(`Use compost (${compost} in the bag): half the wait, one more to harvest`, `用堆肥（包里有 ${compost} 袋）：时间减半，多收一份`) : L("No compost yet: cleaning a messy pet makes some", "还没有堆肥：给脏兮兮的宠物洗澡就会有")}</span>
          </label>
          <ul className="garden-seeds">
            {seeds.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="garden-seed"
                  onClick={() => {
                    plant(picking, c.id, useCompost && compost > 0);
                    setPicking(null);
                  }}
                >
                  <img className="pixel" src={ITEM[c.seed]!.art} alt="" width={40} height={40} />
                  <span>
                    <b>{c.name[lang]}</b>
                    <span className="small">
                      {L(`×${world.bag[c.seed]} · ${c.hours}h · gives ${ITEM[c.yields]!.name.en} ×${c.amount}`, `×${world.bag[c.seed]} · ${c.hours} 小时 · 收 ${ITEM[c.yields]!.name.zh} ×${c.amount}`)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
