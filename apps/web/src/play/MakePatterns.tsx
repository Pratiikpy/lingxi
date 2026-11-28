/**
 * R75: the bag's sewing and building patterns. A new player's bag showed all of them at once, dimmed, each with its
 * needs in red ("Daffodil ×2 (0) + Old Bottle ×1 (0)") and a Sew it could not use: a wall of what was not yet possible.
 * Now what can be made comes first with its button; when nothing can, one plain line says what to do; every other
 * pattern waits in a closed fold, the nearest to done first, each naming what it takes and what the bag holds towards
 * it, with no button it cannot use. A pattern already made sits last in the fold, marked made.
 */
import { Fragment } from "react";
import { WEARABLE } from "@lingxi/art";
import { DECOR_BY_ID, ITEM, MAKE_RECIPES, has, ownedPieces } from "@lingxi/world";
import { useLang } from "../i18n";
import { useWorld } from "../game/world";
import { rowAct } from "./rowAct";

type Pattern = (typeof MAKE_RECIPES)[number];

export function MakePatterns() {
  const zh = useLang((s) => s.lang) === "zh";
  const lang = zh ? "zh" : "en";
  const world = useWorld((s) => s.world);
  const make = useWorld((s) => s.make);
  const owned = ownedPieces(world);
  const rows = MAKE_RECIPES.map((r) => {
    const done = r.kind === "outfit" ? owned.includes(r.id) : (world.decor?.owned ?? []).includes(r.id);
    const can = r.ins.every((x) => has(world, x.item, x.amount));
    const name = (r.kind === "outfit" ? WEARABLE[r.id]?.name : DECOR_BY_ID[r.id]?.name)?.[lang] ?? r.id;
    // how much of it the bag holds: each thing it takes counted up to what it takes
    const need = r.ins.reduce((n, x) => n + x.amount, 0);
    const near = r.ins.reduce((n, x) => n + Math.min(world.bag[x.item] ?? 0, x.amount), 0) / need;
    return { r, done, can, name, near };
  });
  const ready = rows.filter((x) => x.can && !x.done);
  const later = rows.filter((x) => !x.can || x.done).sort((a, b) => Number(a.done) - Number(b.done) || b.near - a.near);
  const kind = (r: Pattern) => (r.kind === "outfit" ? (zh ? "衣服" : "outfit") : zh ? "家具" : "furniture");
  const verb = (r: Pattern) => (r.kind === "outfit" ? (zh ? "缝" : "Sew") : zh ? "做" : "Build");
  return (
    <section className="make-patterns">
      <p className="label">{zh ? "缝衣服 · 做家具" : "Sew and build"}</p>
      {ready.length ? (
        <ul className="bag-list">
          {ready.map(({ r, name }) => (
            <li key={`${r.kind}:${r.id}`} className="bag-item no-art">
              <div className="bag-text">
                <b>
                  {name} <em>{kind(r)}</em>
                </b>
                <span>{needs(r, world.bag, lang)}</span>
              </div>
              <button
                type="button"
                className="btn primary"
                onClick={() => make(r.kind, r.id)}
                aria-label={rowAct(verb(r), name, lang)}
              >
                {verb(r)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small make-none">
          {zh
            ? "还没有能做的。下面每个图样都写着要用什么，出门散步、逛各个地方时留意收集。"
            : "Nothing to make yet. Each pattern below says what it takes: look out for those on walks and in the places you visit."}
        </p>
      )}
      {later.length > 0 && (
        <details className="make-later">
          <summary>
            {ready.length
              ? zh
                ? `更多图样（${later.length}）`
                : `More patterns (${later.length})`
              : zh
                ? `全部图样（${later.length}）`
                : `All patterns (${later.length})`}
          </summary>
          <ul className="bag-list">
            {later.map(({ r, name, done }) => (
              <li key={`${r.kind}:${r.id}`} className={`bag-item no-art${done ? " is-made" : ""}`}>
                <div className="bag-text">
                  <b>
                    {name} <em>{kind(r)}</em>
                  </b>
                  <span>{needs(r, world.bag, lang)}</span>
                </div>
                {done && <span className="small make-made">{zh ? "已做好" : "Made"}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** What a pattern takes: each thing and its amount, and where the bag holds some, how many of it so far. */
function needs(r: Pattern, bag: Readonly<Record<number, number>>, lang: "en" | "zh") {
  return r.ins.map((x, k) => {
    const held = Math.min(bag[x.item] ?? 0, x.amount);
    const item = ITEM[x.item]?.name[lang] ?? String(x.item);
    return (
      <Fragment key={x.item}>
        {k > 0 && (lang === "zh" ? "、" : " · ")}
        <span className={held >= x.amount ? "have" : held > 0 ? "some" : undefined}>
          {held > 0 ? `${item} ${held}/${x.amount}` : `${item} ×${x.amount}`}
        </span>
      </Fragment>
    );
  });
}
