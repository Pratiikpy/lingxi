/**
 * P7, check 5: the files allowed non-null assertions (`x!`) are listed in lint/non-null-allowed.json, and the lint
 * holds every other file to none. The list only shrinks: a listed file that no longer holds one must leave the list,
 * or new assertions could come back into it unseen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const allowed = JSON.parse(readFileSync(join(root, "lint/non-null-allowed.json"), "utf8")) as string[];

const assertionsIn = (file: string): number => {
  const text = readFileSync(join(root, file), "utf8");
  const src = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isNonNullExpression(node)) n++;
    ts.forEachChild(node, visit);
  };
  visit(src);
  return n;
};

describe("non-null assertions only where still listed (P7)", () => {
  it("every listed file still holds one", () => {
    expect(allowed.filter((f) => assertionsIn(f) === 0)).toEqual([]);
  });

  it("the list is sorted and has no repeats", () => {
    expect([...new Set(allowed)].sort()).toEqual(allowed);
  });
});
