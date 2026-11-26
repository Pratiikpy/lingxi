/** Rotates every `.log` in `dir` larger than `maxBytes`, keeping `keep` compressed copies of each (P8). */
export declare function rotateLogs(dir: string, o: { maxBytes: number; keep: number; now?: number }): string[];
