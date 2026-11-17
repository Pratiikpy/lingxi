/**
 * On-chain decor (plan 4.6): which shop pieces and keepsakes the player's wallets hold on X Layer, read again on
 * start and after every purchase or claim, and given to the home so they can be placed. A piece sold or sent away
 * leaves the home the next time this is read.
 */

import { piecesHeld } from "@lingxi/chain";
import { syncChainDecor, syncChainWear } from "@lingxi/world";
import { deployment, deviceWallets, publicClient } from "./chain";
import { useDesigns } from "./designs";
import { useWorld } from "./world";

/** The wallets to read: every wallet that owns a pet on this device, and the one connected to the market. */
export function chainWallets(extra?: string | null): `0x${string}`[] {
  const all = [...deviceWallets(), ...(extra ? [extra.toLowerCase()] : []), ...(useDesigns.getState().wallet ? [useDesigns.getState().wallet!.toLowerCase()] : [])];
  return [...new Set(all)].filter((w): w is `0x${string}` => /^0x[0-9a-f]{40}$/.test(w)).slice(0, 8);
}

/** Read what the wallets hold and update the home and the wardrobe. Quietly keeps the last reading when X Layer cannot be read. */
export async function syncChainPieces(extra?: string | null): Promise<string[] | null> {
  if (!deployment?.itemShop || !deployment.items) return null;
  const wallets = chainWallets(extra);
  try {
    const held = wallets.length ? await piecesHeld(publicClient, deployment, wallets) : [];
    const w = useWorld.getState().world;
    // decorations for the home (plan 4.6), limited outfits for the wardrobe (plan 4.9)
    const next = syncChainWear(syncChainDecor(w, held), held);
    if (next !== w) useWorld.getState().setWorld(next);
    return held;
  } catch {
    return null;
  }
}
