export declare const FAILS_TO_ACT: number;
export declare const SLOW_FAILS_TO_ACT: number;
export declare const QUIET_MS: number;
export interface Watch {
  localFails: number;
  /** whether every missed beat of the current streak was the server here only answering too slowly */
  localSlowOnly: boolean;
  publicFails: number;
  quietUntil: number;
}
export declare function initialWatch(): Watch;
export declare function decide(w: Watch, beat: { local: boolean | "slow"; public: boolean }, now: number): { watch: Watch; action: "restart-server" | "restart-tunnel" | null };
export declare function describeBeat(why: { local: string; public: string }): string;
