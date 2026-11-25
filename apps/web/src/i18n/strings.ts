/**
 * Every string the game shows, in English and Chinese. Chinese is written as
 * Chinese, not translated word for word. Keep both columns in step: the type
 * below makes a missing translation a compile error.
 */

import { en } from "./strings.en";

export { en };
export { zh } from "./strings.zh";

export type Key = keyof typeof en;
