/**
 * The game's rules as circuits (plan 4.11): every rule the game runs, its circuit id on the processor, its size, what
 * it decides, and whether the rule compiled in this browser is the circuit stored on X Layer.
 */

import { useEffect } from "react";
import { RULES } from "@lingxi/chain";
import { deployment } from "../game/chain";
import { useRulesCheck } from "../game/rulesCheck";

export function RuleTable({ lang }: { lang: "en" | "zh" }) {
  // the same check the game runs on start
  const { checks: list, run } = useRulesCheck();
  const checks = Object.fromEntries(list.map((c) => [c.name, c]));
  const records = deployment?.rules;
  useEffect(() => {
    void run();
  }, [run]);
  const word = {
    match: { en: "✓ matches X Layer", zh: "✓ 与 X Layer 一致" },
    differs: { en: "✗ differs", zh: "✗ 不一致" },
    missing: { en: "✗ not taped out", zh: "✗ 尚未流片" },
    unreachable: { en: "? X Layer unreachable", zh: "? 连不上 X Layer" },
  } as const;
  return (
    <section id="rules" className="v-card v-proof-table" aria-labelledby="rules-h">
      <h2 id="rules-h">{lang === "zh" ? "规则电路" : "Rule circuits"}</h2>
      <p className="v-note">
        {lang === "zh"
          ? "游戏不直接执行这些规则的代码，而是读取编译好的电路给出的答案。你的浏览器把每条规则重新编译，再和处理器上存的网表逐字节比较。"
          : "The game does not run these rules as code: it reads the answers of the compiled circuits. Your browser compiles every rule again and compares it byte for byte with the netlist stored on the processor."}
      </p>
      {!records ? (
        <p className="v-note">{lang === "zh" ? "这个版本还没有记录规则电路。" : "No rule circuits are on record for this build."}</p>
      ) : (
        <div className="v-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{lang === "zh" ? "规则" : "Rule"}</th>
                <th>Id</th>
                <th>{lang === "zh" ? "门" : "Gates"}</th>
                <th>{lang === "zh" ? "核对" : "Check"}</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map((r) => {
                const c = checks[r.name];
                return (
                  <tr key={r.name}>
                    <td>
                      <span className="mono">{r.name}</span>
                      <span className="v-rule-about">{r.about[lang]}</span>
                    </td>
                    <td>{records[r.name]?.id ?? "—"}</td>
                    <td>{records[r.name]?.gates ?? "—"}</td>
                    <td className={c?.status === "match" ? "v-ok" : c && c.status !== "unreachable" ? "v-bad" : ""}>
                      {c ? (
                        <>
                          <span aria-hidden="true">{word[c.status][lang].slice(0, 1)}</span>
                          <span className="v-check-word">{word[c.status][lang].slice(1)}</span>
                        </>
                      ) : lang === "zh" ? (
                        "核对中……"
                      ) : (
                        "checking…"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
