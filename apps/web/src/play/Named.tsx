/** A name in a name colour (plan 4.9), with no game state: for pages that know the colour already. */

import type React from "react";
import { revealHidden } from "@lingxi/game";
import { NAME_COLOUR_BY_ID } from "@lingxi/world";
import { useLang } from "../i18n";
import "./extras.css";

export function Named({
  name,
  colour,
  as: Tag = "b",
  className = "",
}: {
  name: string;
  colour?: number;
  as?: "b" | "span" | "strong";
  className?: string;
}) {
  const lang = useLang((s) => s.lang);
  const c = colour ? NAME_COLOUR_BY_ID[colour] : undefined;
  const style = c ? ({ "--nc-l": c.light, "--nc-d": c.dark } as React.CSSProperties) : undefined;
  // a name set on chain without the game may carry characters that show as nothing: they are shown, and said (A16)
  const { text, hidden } = revealHidden(name);
  const said = hidden
    ? lang === "zh"
      ? `这个名字里有 ${hidden} 个看不见的字符，显示为 \ufffd`
      : `This name carries ${hidden} invisible character${hidden === 1 ? "" : "s"}, shown as \ufffd`
    : undefined;
  return (
    <Tag
      className={`${className}${c ? " pet-named" : ""}${hidden ? " named-hidden" : ""}`.trim() || undefined}
      style={style}
      title={said}
    >
      {text}
    </Tag>
  );
}
