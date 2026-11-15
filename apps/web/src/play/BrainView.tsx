/**
 * The visible brain: the pet's real compiled circuit, every NAND and LATCH,
 * laid out by logic depth (inputs and memory on the left, the 8 outputs on the
 * right). After each beat a wavefront runs left to right lighting the gates that
 * carry a 1, so the owner can watch the thought happen. It draws exactly the
 * netlist that is taped out on X Layer.
 */

import { useEffect, useMemo, useRef } from "react";
import { INPUT_FIELDS, compileProgram, gateCount, layout, netDepth, traceBeat } from "@lingxi/brain";
import type { Pet } from "@lingxi/game";
import { useLang } from "../i18n";
import { decidingPart } from "../game/store";
import { MOOD_NAMES, WANT_COLORS, WANT_NAMES } from "./ruleText";

const FIELD_ZH: Record<string, string> = { hunger: "饥饿", joy: "心情", energy: "精神", clean: "清洁", time: "时间", action: "动作", event: "事件", owner: "主人" };

export function BrainView({ pet, reduceMotion }: { pet: Pet; reduceMotion: boolean }) {
  const { lang } = useLang();
  const ref = useRef<HTMLCanvasElement>(null);
  const part = decidingPart(pet);
  const program = part.program;
  const net = useMemo(() => compileProgram(program), [program]);
  const lay = useMemo(() => layout(net), [net]);
  // a child shows the half that decided this beat, with that half's own memory
  const before = (pet.last.before ?? pet.brain).slice(part.offset, part.offset + net.latches.length);
  const trace = useMemo(() => traceBeat(net, before, pet.last.word), [net, before, pet.last.word]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext("2d")!;
    const css = getComputedStyle(el);
    const ink = css.getPropertyValue("--ink").trim() || "#2B2140";
    const soft = css.getPropertyValue("--ink-soft").trim() || "#5B4E73";
    const lit = "#FFC83D";
    const node = "#2F7FD6";
    let raf = 0;
    const start = performance.now();
    const cols = lay.columns.length;
    const outFirst = trace.signals.length - net.nOut;
    const latchBase = 2 + net.nIn;
    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (el.width !== Math.round(W * dpr)) {
        el.width = Math.round(W * dpr);
        el.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const left = 76;
      const right = 70;
      const top = 14;
      const bottom = 14;
      const front = reduceMotion ? cols : Math.min(cols, ((now - start) / 700) * cols);
      const pos = new Map<number, [number, number]>();
      // inner gates by depth; the 8 outputs get their own column at the right edge
      const innerCols = lay.columns.map((col) => col.filter((s) => s < outFirst));
      const span = W - left - right;
      innerCols.forEach((col, ci) => {
        const x = left + (ci / cols) * span;
        col.forEach((s, k) => pos.set(s, [x, top + ((k + 0.5) / col.length) * (H - top - bottom)]));
      });
      for (let k = 0; k < net.nOut; k++) {
        pos.set(outFirst + k, [left + span, top + ((k + 0.5) / net.nOut) * (H - top - bottom)]);
      }
      // wires
      const gateBase = latchBase + net.latches.length;
      ctx.lineWidth = 1;
      net.gates.forEach(([a, b], i) => {
        const s = gateBase + i;
        const p = pos.get(s);
        if (!p) return;
        const depth = s >= outFirst ? cols : lay.depth[s]!;
        for (const o of [a, b]) {
          const q = pos.get(o);
          if (!q) continue;
          const on = trace.signals[o] === 1 && depth <= front;
          ctx.strokeStyle = on ? "rgba(255,200,61,0.38)" : "rgba(127,110,150,0.06)";
          ctx.beginPath();
          ctx.moveTo(q[0], q[1]);
          ctx.lineTo(p[0], p[1]);
          ctx.stroke();
        }
      });
      // nodes
      for (const [s, [x, y]] of pos) {
        const depth = s >= outFirst ? cols : lay.depth[s]!;
        const on = trace.signals[s] === 1 && depth <= front;
        const isLatch = s >= latchBase && s < gateBase;
        const isOut = s >= outFirst;
        const r = isOut ? 4 : isLatch ? 3.5 : depth === 0 ? 3 : 2.2;
        ctx.fillStyle = on ? lit : isLatch ? node : "rgba(127,110,150,0.35)";
        ctx.beginPath();
        if (isLatch) ctx.rect(x - r, y - r, r * 2, r * 2);
        else ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // labels: input fields on the left, outputs on the right
      ctx.font = `600 11px ${css.getPropertyValue("--round") || "system-ui"}`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = soft;
      ctx.textAlign = "right";
      for (const f of INPUT_FIELDS) {
        const ys = Array.from({ length: f.bits }, (_, b) => pos.get(2 + f.lo + b)?.[1] ?? 0);
        const y = (Math.min(...ys) + Math.max(...ys)) / 2;
        ctx.fillText(lang === "zh" ? FIELD_ZH[f.name]! : f.name, left - 10, y);
      }
      const memYs = net.latches.map((_, j) => pos.get(latchBase + j)?.[1] ?? 0);
      if (memYs.length) {
        ctx.fillStyle = node;
        ctx.fillText(lang === "zh" ? "记忆" : "memory", left - 10, (Math.min(...memYs) + Math.max(...memYs)) / 2);
      }
      ctx.textAlign = "left";
      const out = trace.out;
      const groups: Array<[string, number[], string]> = [
        [lang === "zh" ? "想要" : "want", [0, 1, 2], WANT_NAMES[lang][out & 7]!],
        [lang === "zh" ? "心情" : "mood", [3, 4], MOOD_NAMES[lang][(out >> 3) & 3]!],
        [lang === "zh" ? "习惯" : "habit", [5, 6, 7], ""],
      ];
      for (const [name, bits, value] of groups) {
        const ys = bits.map((b) => pos.get(outFirst + b)?.[1] ?? 0);
        const y = (Math.min(...ys) + Math.max(...ys)) / 2;
        const x = W - right + 12;
        ctx.fillStyle = soft;
        ctx.fillText(name, x, y - 7);
        ctx.fillStyle = ink;
        if (front >= cols && value && name === groups[0]![0]) {
          // the decision wears its behaviour colour, as it does everywhere else
          const w = ctx.measureText(value).width;
          ctx.fillStyle = WANT_COLORS[out & 7]!;
          ctx.beginPath();
          ctx.roundRect(x - 4, y, w + 8, 15, 7);
          ctx.fill();
          ctx.fillStyle = "#2b2140";
        }
        if (front >= cols) ctx.fillText(value, x, y + 7);
      }
      if (front < cols) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [lay, net, trace, lang, reduceMotion]);

  const gates = gateCount(net);
  return (
    <figure className="brainview">
      <canvas ref={ref} role="img" aria-label={lang === "zh" ? `${pet.name}的电路：${gates} 个门` : `${pet.name}'s circuit: ${gates} gates`} />
      <figcaption>
        {lang === "zh"
          ? `${gates} 个门 · ${net.latches.length} 位记忆 · 深度 ${netDepth(net)}`
          : `${gates} gates · ${net.latches.length} memory bits · depth ${netDepth(net)}`}
      </figcaption>
    </figure>
  );
}
