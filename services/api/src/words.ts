/**
 * Words never shown to other players: in room names and chat (live.ts) and in the names of pets that share lessons
 * (library.ts). One list, so every place a stranger's words can appear refuses the same ones.
 */

export const BLOCKED_WORDS = /(fuck|shit|cunt|nigg|fag|rape|\bkill\b|操你|傻逼|妈的|去死)/i;
