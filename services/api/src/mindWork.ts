/** The mind check's worker (A62): is the entered pet's mind the circuit on X Layer? Off the server's request thread. */
import { parentPort, workerData } from "node:worker_threads";
import { type Circuit, type StarterLine, circuitBrain } from "@lingxi/brain";
import { type PetCard, mindBrain } from "@lingxi/game";
import { sameBrain } from "./seasonProof";

const { circuit, line, card } = workerData as { circuit: Circuit; line: StarterLine; card: PetCard };
try {
  const mine = mindBrain({
    line,
    lessons: card.lessons,
    family: card.family,
    instincts: card.instincts,
    outside: card.outside,
    growth: card.growth,
  });
  parentPort!.postMessage({
    same: sameBrain({ fast: circuitBrain(circuit), nState: circuit.nState }, mine, card.memory),
  });
} catch (e) {
  parentPort!.postMessage({ error: e instanceof Error ? e.message : String(e) });
}
