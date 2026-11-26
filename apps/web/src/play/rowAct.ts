/**
 * R8: a row's button, named for a screen reader by what it does and what it does it to. A list of foods each with a
 * button reading "Feed" is three buttons called "Feed" to someone tabbing through them; "Feed: Rice ball" says which.
 * The words on the button come first, so a voice command that reads the button still finds it.
 */
export const rowAct = (action: string, what: string, lang: string): string =>
  lang === "zh" ? `${action}：${what}` : `${action}: ${what}`;

/**
 * R8: a rule in one sentence, as it is read aloud: "something scary, then explore." / "有可怕的东西，就到处看看。",
 * with what kind of rule it is first when that is shown ("Instinct: ...").
 */
export function ruleSpoken(when: readonly string[], then: string, lang: string, lead?: string): string {
  const zh = lang === "zh";
  const body = zh ? `${when.join("且")}，就${then}。` : `${when.join(" and ")}, then ${then}.`;
  if (!lead) return body;
  return zh ? `${lead}：${body}` : `${lead}: ${body}`;
}
