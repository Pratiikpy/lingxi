/**
 * The adoption centre on this device (plan 4.8).
 *
 * A breeder offers a young child: it is saved first if today has not been saved, the centre is allowed to move
 * this one pet, it is listed, and its papers (its whole record) are signed with the wallet and left at our server.
 * The device copy then waits at the centre, frozen, like a pet staying with a friend. If the offer is withdrawn or
 * runs out it comes back; once adopted it leaves this device.
 *
 * A buyer browses the offers. Each one's papers are checked against X Layer before it can be paid for; after
 * paying, the little one arrives with its history, cared for by the centre for the time it waited.
 */

import { type Address, type Hex, keccak256, toBytes } from "viem";
import { type ChainPetView, type PapersProblem, type Pet, checkPapers, savedLength } from "@lingxi/game";
import { type Offer, adoptChild, adoptionTerms, childView, offerChild, offerable, readOffers, withdrawOffer } from "@lingxi/chain";
import { type ChainRecord, connectWallet, deployment, publicClient, recordOf, setRecordOf, useChain } from "./chain";
import { useGame } from "./store";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
export const adoptionAvailable = () => !!deployment?.adoptionCentre;
/** Papers live on our server, so offering and adopting need the web version. */
export const papersAvailable = () => BASE !== "";

const CENTRE = "centre:";
export const atCentre = (pet: Pet): string | null => (pet.away?.code.startsWith(CENTRE) ? pet.away.code.slice(CENTRE.length) : null);

/** What travels with the little one: the pet itself and its chain record on the breeder's device. */
interface Papers {
  v: 1;
  pet: Pet;
  record: ChainRecord;
}

/** The message the owner signs; the server checks the same text. */
export const papersMessage = (petId: string, papers: string) => `Lingxi adoption papers for pet #${petId}
${keccak256(toBytes(papers))}`;

/* ── the breeder's side ─────────────────────────────────────────────────── */

export type OfferResult = { ok: true } | { ok: false; reason: "notOnChain" | "notYours" | "notBred" | "moved" | "grown" | "busy" | "outsideInstinct" | "papers" | string };

/** Offer a little one for `priceUnits` BEM base units, until `untilSec` (it must still be young then). */
export async function offerForAdoption(pet: Pet, priceUnits: bigint, untilSec: number, onStep: (s: "saving" | "listing" | "signing" | "papers") => void): Promise<OfferResult> {
  const record = recordOf(pet);
  if (!deployment?.adoptionCentre || !record) return { ok: false, reason: "notOnChain" };
  if (pet.away || pet.sitting) return { ok: false, reason: "busy" };
  if (pet.outside) return { ok: false, reason: "outsideInstinct" };
  const wallet = await connectWallet();
  const who = wallet.account!.address;
  const can = await offerable(publicClient, deployment, BigInt(record.petId), who, Math.floor(Date.now() / 1000));
  if (can !== "ok") return { ok: false, reason: can };
  // save today first, if it has not been saved, so the papers follow straight on from the chain
  onStep("saving");
  await useChain.getState().saveToday(pet, () => undefined);
  const current = useGame.getState().pets.find((p) => p.bornAt === pet.bornAt) ?? pet;
  onStep("listing");
  await offerChild(publicClient, wallet, deployment, BigInt(record.petId), priceUnits, untilSec);
  onStep("signing");
  const papers = JSON.stringify({ v: 1, pet: current, record: recordOf(current) ?? record } satisfies Papers);
  const signature = await wallet.signMessage({ account: wallet.account!, message: papersMessage(record.petId, papers) });
  onStep("papers");
  const res = await fetch(`${BASE}/api/papers/${record.petId}`, { method: "POST", body: JSON.stringify({ papers, signature }) });
  if (!res.ok) return { ok: false, reason: "papers" };
  // the device copy waits at the centre, frozen, until it is adopted or comes back
  useGame.getState().replace({ ...current, away: { code: `${CENTRE}${record.petId}`, key: "", until: untilSec * 1000, sitter: null } });
  return { ok: true };
}

/** Is the little one still waiting, adopted, or back? Acts on what it finds. */
export async function checkCentre(pet: Pet): Promise<"waiting" | "adopted" | "back" | "unreachable"> {
  const petId = atCentre(pet);
  const record = recordOf(pet);
  if (!petId || !deployment?.adoptionCentre || !record) return "back";
  let offer: Offer | undefined;
  let owner: Address;
  try {
    const [offers, view] = await Promise.all([readOffers(publicClient, deployment), childView(publicClient, deployment, BigInt(petId))]);
    offer = offers.find((o) => o.petId === BigInt(petId));
    owner = view.pet.owner;
  } catch {
    return "unreachable";
  }
  if (owner.toLowerCase() !== record.owner.toLowerCase()) {
    // adopted: it belongs to someone else now, so it leaves this device, with a note to say where it went
    noteFarewell({ name: pet.name, petId, to: owner, at: Date.now() });
    setRecordOf(pet, null);
    useGame.getState().release(pet.bornAt);
    return "adopted";
  }
  const stillOffered = offer && offer.live && offer.seller.toLowerCase() === record.owner.toLowerCase() && Date.now() < offer.expiresAt * 1000;
  if (stillOffered) return "waiting";
  comeBack(pet);
  return "back";
}

/* ── farewells: told once, on the next screen, after a little one leaves for its new home ─────────────── */

const FAREWELL = "lingxi.adopted.v1";
export interface Farewell {
  name: string;
  petId: string;
  to: string;
  at: number;
}
function noteFarewell(f: Farewell): void {
  try {
    const all = JSON.parse(localStorage.getItem(FAREWELL) ?? "[]") as Farewell[];
    localStorage.setItem(FAREWELL, JSON.stringify([...all.filter((x) => x.petId !== f.petId), f].slice(-8)));
  } catch {
    // the pet still goes; only the note is lost
  }
}
/** Farewells not yet shown; reading them marks them shown. */
export function takeFarewells(): Farewell[] {
  try {
    const all = JSON.parse(localStorage.getItem(FAREWELL) ?? "[]") as Farewell[];
    localStorage.removeItem(FAREWELL);
    return Array.isArray(all) ? all.filter((f) => typeof f?.name === "string" && /^\d+$/.test(String(f.petId))) : [];
  } catch {
    return [];
  }
}

function comeBack(pet: Pet): void {
  const { away: _away, ...home } = pet;
  useGame.getState().replace(home as Pet);
}

/** Take the offer back and bring the little one home. */
export async function withdrawFromCentre(pet: Pet): Promise<void> {
  const petId = atCentre(pet);
  if (!petId || !deployment) return;
  const wallet = await connectWallet();
  await withdrawOffer(publicClient, wallet, deployment, BigInt(petId));
  comeBack(pet);
}

/* ── the adopter's side ─────────────────────────────────────────────────── */

export interface CheckedOffer {
  offer: Offer;
  papers: Papers | null;
  /** null when the papers match the chain */
  problem: PapersProblem | "noPapers" | "unreachable" | null;
}

/** Every offer, each with its papers fetched and checked against X Layer. */
export async function browseOffers(): Promise<CheckedOffer[]> {
  if (!deployment?.adoptionCentre) return [];
  const offers = await readOffers(publicClient, deployment);
  return Promise.all(
    offers.map(async (offer): Promise<CheckedOffer> => {
      let papers: Papers;
      try {
        const r = await fetch(`${BASE}/api/papers/${offer.petId}`);
        const body = (await r.json()) as { ok: boolean; papers: string; signer: string };
        if (!r.ok || !body.ok) return { offer, papers: null, problem: "noPapers" };
        if (body.signer.toLowerCase() !== offer.seller.toLowerCase()) return { offer, papers: null, problem: "noPapers" };
        papers = JSON.parse(body.papers) as Papers;
      } catch {
        return { offer, papers: null, problem: BASE ? "noPapers" : "unreachable" };
      }
      try {
        const { view } = await childView(publicClient, deployment!, offer.petId);
        return { offer, papers, problem: checkPapers(withoutAway(papers.pet), view as ChainPetView) };
      } catch {
        return { offer, papers, problem: "unreachable" };
      }
    }),
  );
}

const withoutAway = (p: Pet): Pet => {
  const { away: _a, sitting: _s, ...rest } = p;
  return rest as Pet;
};

/** The centre looked after it while it waited: it arrives fed, rested, clean and happy. */
const CARED = { food: 800, joy: 800, energy: 900, clean: 900 };

/** Adopt, then bring the little one home with its history. */
export async function adoptFromCentre(c: CheckedOffer): Promise<{ ok: true; pet: Pet } | { ok: false; reason: string }> {
  if (!deployment || !c.papers || c.problem) return { ok: false, reason: c.problem ?? "noPapers" };
  if (useGame.getState().pets.length >= 8) return { ok: false, reason: "full" };
  const wallet = await connectWallet();
  const who = wallet.account!.address;
  if (who.toLowerCase() === c.offer.seller.toLowerCase()) return { ok: false, reason: "own" };
  // check once more just before paying: the chain may have moved since the list was read
  const { view, pet: onChain } = await childView(publicClient, deployment, c.offer.petId);
  const problem = checkPapers(withoutAway(c.papers.pet), view as ChainPetView);
  if (problem) return { ok: false, reason: problem };
  const tx: Hex = await adoptChild(publicClient, wallet, deployment, c.offer.petId, c.offer.price);
  const now = Date.now();
  const base = withoutAway(c.papers.pet);
  const pet: Pet = {
    ...base,
    // it resumes from now: the time at the centre is a gap in its log, not hours of being alone
    beat: Math.floor(now / 60_000),
    meters: { food: CARED.food * 60, joy: CARED.joy * 60, energy: CARED.energy * 60, clean: CARED.clean * 60 },
    asleep: false,
    hibernating: false,
    starvingBeats: 0,
    sick: false,
    dirtyBeats: 0,
    tzOffsetMin: -new Date().getTimezoneOffset(),
  };
  const saved = savedLength(base.pendingLog, onChain.logHash) ?? 0;
  const record: ChainRecord = {
    ...c.papers.record,
    owner: who,
    hatchTx: c.papers.record.hatchTx,
    lastDay: onChain.day,
    lastTx: tx,
    logLen: saved,
  };
  delete (record as Partial<ChainRecord>).autoUntil;
  delete (record as Partial<ChainRecord>).sitter;
  if (!useGame.getState().welcome(pet)) return { ok: false, reason: "full" };
  setRecordOf(pet, record);
  return { ok: true, pet };
}

/** The centre's terms, for the screen. */
export const centreTerms = () => (deployment?.adoptionCentre ? adoptionTerms(publicClient, deployment) : Promise.resolve(null));
