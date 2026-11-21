/**
 * A pet whose brain is another line's starter circuit (A136). Pet #2 on mainnet hatched as gentle with circuit #2, the
 * bold starter: a test hatch from 15 November, before the game checked that a pet's brain matches its line. The proof
 * page says so rather than leave a judge to wonder; the chain records exactly that and every check reads what it holds.
 */
const LINES = ["gentle", "bold", "curious"] as const;

/** The line (0 gentle, 1 bold, 2 curious) whose starter `brainId` is, when that is not the pet's own `line`; else null. */
export function otherStarter(line: number, brainId: bigint, circuits: Partial<Record<string, { id: string }>> | undefined): number | null {
  if (!circuits) return null;
  const of = LINES.findIndex((l) => circuits[l]?.id === brainId.toString());
  return of >= 0 && of !== line ? of : null;
}
