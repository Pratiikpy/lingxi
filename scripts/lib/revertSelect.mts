/**
 * A35: which revert entries a push asks for. CI runs, on each push, every entry the push added or changed in
 * `scripts/regressions/list.json` and every entry whose patch it changed; all of them when the commit before the push
 * is not known (a new branch). Entries it did not touch wait for the nightly full run, which also catches a patch that no
 * longer applies because the code it undoes has moved.
 */

export interface Entry {
  id: string;
}

/** The entries of `after` that differ from `before` or whose patch is among `changedFiles` (repo paths). */
export function changedEntries<E extends Entry>(before: readonly E[] | null, after: readonly E[], changedFiles: readonly string[]): E[] {
  if (!before) return [...after];
  const was = new Map(before.map((e) => [e.id, JSON.stringify(e)]));
  const patched = new Set(changedFiles.map((f) => /^scripts\/regressions\/(.+)\.patch$/.exec(f)?.[1]).filter((id): id is string => !!id));
  return after.filter((e) => was.get(e.id) !== JSON.stringify(e) || patched.has(e.id));
}
