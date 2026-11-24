/**
 * The tree of life (PRD Z6): every pet ever hatched or bred on X Layer as one
 * family, with each pet's generation, its ancestors and the owners who raised
 * them, credited down the generations. Built from the indexer's chain events.
 */

export interface TreePet {
  id: string;
  line: number;
  owner: string | null;
  parents: [string, string] | null;
  children: string[];
  block: number;
  tx: string;
  at: number;
  name?: string;
  /** its name colour on X Layer (plan 4.9), when it has one */
  colour?: number;
}

export interface TreeNode extends TreePet {
  generation: number;
  /** every ancestor's id, nearest first */
  ancestors: string[];
  /** the owners who raised this pet and its ancestors, in order of appearance */
  designers: string[];
}

export interface Tree {
  pets: TreeNode[];
  founders: number;
  families: number;
  generations: number;
}

/** Generations, ancestors and designers for every pet. A parent missing from the chain counts as generation 0. */
export function buildTree(pets: readonly TreePet[]): Tree {
  const byId = new Map(pets.map((p) => [p.id, p]));
  const gen = new Map<string, number>();
  const genOf = (id: string, seen: Set<string> = new Set()): number => {
    const known = gen.get(id);
    if (known !== undefined) return known;
    const p = byId.get(id);
    // a loop could only come from bad data; it is cut rather than followed
    if (!p?.parents || seen.has(id)) return 0;
    seen.add(id);
    const g = 1 + Math.max(genOf(p.parents[0], seen), genOf(p.parents[1], seen));
    gen.set(id, g);
    return g;
  };
  // each ancestor once, found with a set and a moving index: linear in the ancestors, not cubic (A147)
  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    const queue = [...(byId.get(id)?.parents ?? [])];
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i]!;
      if (seen.has(a)) continue;
      seen.add(a);
      out.push(a);
      queue.push(...(byId.get(a)?.parents ?? []));
    }
    return out;
  };
  const nodes = pets
    .map((p) => {
      const ancestors = ancestorsOf(p.id);
      const designers = new Set<string>();
      for (const who of [p.owner, ...ancestors.map((a) => byId.get(a)?.owner ?? null)])
        if (who) designers.add(who.toLowerCase());
      return { ...p, generation: genOf(p.id), ancestors, designers: [...designers] };
    })
    .sort((a, b) => a.block - b.block || Number(a.id) - Number(b.id));
  const pairs = new Set(nodes.filter((n) => n.parents).map((n) => [...n.parents!].sort().join("+")));
  return {
    pets: nodes,
    founders: nodes.filter((n) => !n.parents).length,
    families: pairs.size,
    generations: nodes.reduce((m, n) => Math.max(m, n.generation), 0) + (nodes.length ? 1 : 0),
  };
}
