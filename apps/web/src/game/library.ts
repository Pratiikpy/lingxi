/** The lesson library (web build): shared lessons, most learned first. Quiet without a server. */

import type { Rule } from "@lingxi/brain";
import { lessonKeyBody, lessonShareBody } from "./requests";
import { API_BASE } from "./apiBase";

const BASE = API_BASE;

export interface LibraryLesson {
  key: string;
  rule: Rule;
  by: string;
  uses: number;
  firstAt: number;
}

export const libraryAvailable = () => BASE !== "";

export async function listLessons(): Promise<LibraryLesson[]> {
  if (!BASE) return [];
  try {
    const r = await fetch(`${BASE}/api/lessons`, { signal: AbortSignal.timeout(6000) });
    const j = (await r.json()) as { ok: boolean; lessons?: LibraryLesson[] };
    return j.ok && j.lessons ? j.lessons : [];
  } catch {
    return [];
  }
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; reason?: string; isNew?: boolean }> {
  if (!BASE) return { ok: false, reason: "offline" };
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    return (await r.json()) as { ok: boolean; reason?: string; isNew?: boolean };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

export const shareLesson = (rule: Rule, by: string) => post("/api/lessons/share", lessonShareBody(rule, by));
export const usedLesson = (key: string) => post("/api/lessons/use", lessonKeyBody(key));
export const reportLesson = (key: string) => post("/api/lessons/report", lessonKeyBody(key));
