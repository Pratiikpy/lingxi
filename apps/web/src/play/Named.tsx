/** A name in a name colour (plan 4.9), with no game state: for pages that know the colour already. */

import type React from "react";
import { NAME_COLOUR_BY_ID } from "@lingxi/world";
import "./extras.css";

export function Named({ name, colour, as: Tag = "b", className = "" }: { name: string; colour?: number; as?: "b" | "span" | "strong"; className?: string }) {
  const c = colour ? NAME_COLOUR_BY_ID[colour] : undefined;
  const style = c ? ({ "--nc-l": c.light, "--nc-d": c.dark } as React.CSSProperties) : undefined;
  return (
    <Tag className={`${className}${c ? " pet-named" : ""}`.trim() || undefined} style={style}>
      {name}
    </Tag>
  );
}
