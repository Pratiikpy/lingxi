import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The repo's own lint over `code`, as if it were a file of the game. */
async function lintGame(code: string) {
  const [result] = await new ESLint({ cwd: root }).lintText(code, {
    filePath: join(root, "apps/web/src/play/Example.tsx"),
  });
  return result!.messages.map((m) => ({ rule: m.ruleId, severity: m.severity }));
}

describe("the repo's lint (H1)", () => {
  it("fails a hook placed after an early return, as the one that once took the live game down", async () => {
    const code = `import { useState } from "react";
export function Card({ open }: { open: boolean }) {
  if (!open) return null;
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
`;
    expect(await lintGame(code)).toContainEqual({ rule: "react-hooks/rules-of-hooks", severity: 2 });
  }, 30_000);

  it("fails a caught error read as (e as Error).message, which throws when a wallet rejects with a string (A21)", async () => {
    const code = `export async function save(send: () => Promise<void>): Promise<string> {
  try {
    await send();
    return "ok";
  } catch (e) {
    return (e as Error).message;
  }
}
`;
    expect(await lintGame(code)).toContainEqual({ rule: "no-restricted-syntax", severity: 2 });
  }, 30_000);
});
