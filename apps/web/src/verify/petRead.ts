/**
 * The proof page's pet, read from X Layer (P7: out of VerifyApp). The pet named in the address is read on open, a
 * family link followed (or an edited address) opens that pet, and the reader may ask for any other. Each is shown
 * with everything about it read alongside: its circuit (a brain past any pet's mind is not run, A38), its name colour
 * and the picture the registry serves for it. A pet number is digits; anything else is no pet, never a crash (A72).
 */
import { startTransition, useCallback, useEffect, useEffectEvent, useState } from "react";
import type { Circuit } from "@lingxi/brain";
import {
  BrainTooBigError,
  type ChainPet,
  canvasOfSvg,
  gameSprite,
  loadCircuitFromChain,
  lookOf,
  nameColours,
  readMetadata,
  readPet,
} from "@lingxi/chain";
import { deployment } from "../game/network";
import { proofClient } from "../game/proofRpc";

/** the page's reads of the pet; the checks each take their own client, to say who answered them */
const pc = proofClient();

/** the words the reads need: no deployment to read from, and no such pet */
interface ReadWords {
  notDeployed: string;
  notFound: string;
}

/** `onFresh`: a read asked for starts from a clean page, so what the page showed of the last pet is cleared */
export function usePetRead(t: ReadWords, onFresh: () => void) {
  // the address may name a pet (#7) or a section of the page (#contracts, #rules): only a number is a pet (A72)
  const [id, setId] = useState(() => (/^\d{1,10}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : "1"));
  const [pet, setPet] = useState<ChainPet | null>(null);
  const [circuit, setCircuit] = useState<Circuit | null>(null);
  const [gates, setGates] = useState(0);
  // why the pet's circuit is not shown: too big to run (A38), or not read just now
  const [circuitError, setCircuitError] = useState<
    { tooBig: { gates: number; max: number } } | { unread: true } | null
  >(null);
  // with no deployment to read from, the page says so from the start
  const [err, setErr] = useState<string | null>(() => (deployment ? null : t.notDeployed));
  const [colour, setColour] = useState(0);
  // the picture and name the registry serves for this pet, drawn by PetLook; undefined while it is being read (P3: its
  // place is kept so the card does not jump when it arrives), null when there is none
  const [meta, setMeta] = useState<{ name: string; image?: string; same?: boolean } | null | undefined>(undefined);

  // a pet read from X Layer is shown with everything about it read alongside: its name colour, its picture, its circuit
  const show = useCallback(async (forId: string, p: ChainPet) => {
    // P3: what is read from X Layer renders in transitions, in short slices, so the page answers while it draws
    startTransition(() => {
      setPet(p);
      setMeta(undefined);
      setColour(0);
    });
    // its name colour (plan 4.9), from the extras contract
    if (!deployment) return;
    if (deployment.extras)
      void nameColours(pc, deployment, [BigInt(forId)])
        .then((c) => setColour(c[forId] ?? 0))
        .catch(() => setColour(0));
    void readMetadata(pc, deployment, BigInt(forId))
      .then((m) => {
        const svg = m.image?.startsWith("data:image/svg+xml;base64,") ? atob(m.image.slice(26)) : null;
        const same = svg
          ? JSON.stringify(canvasOfSvg(svg).px) === JSON.stringify(gameSprite(lookOf(p.state)).px)
          : undefined;
        startTransition(() => setMeta({ name: m.name, image: m.image, same }));
      })
      .catch(() => setMeta(null));
    // a child's circuit REFs its parents' circuits; those are read from the chain too. A brain no pet's mind could be
    // is not run (A38): the pet is still shown, its circuit is not
    setCircuitError(null);
    try {
      const c = await loadCircuitFromChain(pc, p.processor, p.brainId);
      startTransition(() => {
        setCircuit(c);
        setGates(c.nGates);
      });
    } catch (e) {
      setCircuit(null);
      setCircuitError(e instanceof BrainTooBigError ? { tooBig: { gates: e.gates, max: e.max } } : { unread: true });
    }
    history.replaceState(null, "", `#${forId}`);
  }, []);
  const notFound = useCallback(() => {
    setPet(null);
    setErr(t.notFound);
  }, [t]);
  // a pet number is digits; anything else (a typed word) is no pet, never a crash (A72)
  const fetchPet = (forId: string) =>
    deployment && /^\d{1,20}$/.test(forId.trim())
      ? readPet(pc, deployment, BigInt(forId.trim()))
      : Promise.reject(new Error("notFound"));
  // a read asked for (the form, a family link followed) starts from a clean page
  const read = (forId = id) => {
    setErr(null);
    onFresh();
    if (!deployment) return setErr(t.notDeployed);
    return fetchPet(forId).then((p) => show(forId, p).catch(notFound), notFound);
  };

  // read once on open, for the pet in the address (the page starts clean); later reads are the reader's own
  const readOnOpen = useEffectEvent(() => fetchPet(id).then((p) => show(id, p).catch(notFound), notFound));
  useEffect(() => {
    if (deployment) void readOnOpen();
    // a section named in the address is brought into view once the page has drawn it (A72)
    const section = location.hash.slice(1);
    if (section && !/^\d+$/.test(section)) {
      const t = setTimeout(() => document.getElementById(section)?.scrollIntoView(), 300);
      return () => clearTimeout(t);
    }
  }, []);

  // following a family link (or editing the address) opens that pet
  const openFromHash = useEffectEvent((h: string) => {
    setId(h);
    void read(h);
  });
  useEffect(() => {
    const on = () => {
      const h = location.hash.replace("#", "");
      if (/^\d{1,10}$/.test(h)) openFromHash(h);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  return { id, setId, pet, circuit, gates, circuitError, err, colour, meta, read };
}
