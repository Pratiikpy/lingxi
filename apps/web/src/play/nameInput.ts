/**
 * P5: a name field held to NAME_MAX visible characters. A field's maxLength counts UTF-16 code units, so it cut an emoji
 * in half and stopped a name of twelve emoji at six; this counts what a reader sees instead. While an input method is
 * composing (pinyin turning into characters), the field is left alone and is cut when the composition ends.
 */
import type { ChangeEvent, CompositionEvent } from "react";
import { NAME_MAX, takeVisible } from "@lingxi/game";

/** The value a name field takes after a change. */
export function nameAfterChange(e: ChangeEvent<HTMLInputElement>, max = NAME_MAX): string {
  return (e.nativeEvent as InputEvent).isComposing ? e.target.value : takeVisible(e.target.value, max);
}

/** The value a name field takes when an input method finishes composing. */
export function nameAfterComposition(e: CompositionEvent<HTMLInputElement>, max = NAME_MAX): string {
  return takeVisible(e.currentTarget.value, max);
}
