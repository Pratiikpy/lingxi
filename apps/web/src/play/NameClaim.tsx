/** Claim the pet's name on chain (PetLook): unique across every Lingxi pet, open once the pet is settled. */

import { useEffect, useState } from "react";
import type { Pet } from "@lingxi/game";
import { nameHolderOf, nameProblem, petRegistryAbi, readName, setNameOnChain } from "@lingxi/chain";
import { type Key, useT } from "../i18n";
import { connectWallet, deployment, publicClient, type ChainRecord } from "../game/chain";
import { play } from "../game/sound";

const PROBLEM: Record<string, Key> = { empty: "name.empty", long: "name.long", space: "name.space", chars: "name.chars" };

export function NameClaim({ pet, record }: { pet: Pet; record: ChainRecord }) {
  const t = useT();
  const [onChain, setOnChain] = useState<string | null>(null);
  const [settled, setSettled] = useState<boolean | null>(null);
  const [name, setName] = useState(pet.name);
  const [taken, setTaken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = BigInt(record.petId);

  useEffect(() => {
    if (!deployment?.look) return;
    let live = true;
    void Promise.all([readName(publicClient, deployment, id), publicClient.readContract({ address: deployment.registry, abi: petRegistryAbi, functionName: "isSettled", args: [id] }) as Promise<boolean>])
      .then(([n, s]) => live && (setOnChain(n), setSettled(s)))
      .catch(() => live && setErr(t("chain.failed")));
    return () => {
      live = false;
    };
  }, [id, t]);

  // is the name free? (checked as the player types, after a short pause)
  useEffect(() => {
    setTaken(null);
    if (!deployment?.look || nameProblem(name) || name === onChain) return;
    const h = setTimeout(() => {
      void nameHolderOf(publicClient, deployment!, name).then((holder) => setTaken(holder !== null && holder !== id ? holder.toString() : null)).catch(() => {});
    }, 400);
    return () => clearTimeout(h);
  }, [name, onChain, id]);

  if (!deployment?.look) return null;
  const problem = nameProblem(name);
  const claim = async () => {
    setBusy(true);
    setErr(null);
    try {
      const wallet = await connectWallet();
      await setNameOnChain(publicClient, wallet, deployment!, id, name);
      setOnChain(name);
      play("success");
    } catch (e) {
      const m = (e as Error).message ?? "";
      setErr(/NameTaken/.test(m) ? t("name.taken", { id: "?" }) : /NotSettled/.test(m) ? t("name.notSettled") : /noWallet/.test(m) ? t("chain.noWallet") : t("chain.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="keeping">
      <p className="label">{t("name.title")}</p>
      {onChain ? <p className="small">{t("name.yours", { name: onChain })}</p> : <p className="small">{t("name.pitch", { name: pet.name })}</p>}
      {settled === false ? (
        <p className="small">{t("name.notSettled")}</p>
      ) : (
        <form
          className="sit-form"
          onSubmit={(e) => {
            e.preventDefault();
            play("tap");
            void claim();
          }}
        >
          <label className="sr" htmlFor="chain-name">
            {t("name.title")}
          </label>
          <div className="row">
            <input id="chain-name" className="input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            <button type="submit" className="btn primary" disabled={busy || settled !== true || !!problem || !!taken || name === onChain}>
              {onChain ? t("name.rename") : t("name.claim")}
            </button>
          </div>
          {problem && name.length > 0 && <p className="small">{t(PROBLEM[problem]!)}</p>}
          {taken && <p className="err">{t("name.taken", { id: taken })}</p>}
        </form>
      )}
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
