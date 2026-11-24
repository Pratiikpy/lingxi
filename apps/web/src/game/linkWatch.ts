/**
 * P6: links in the address (a duel, its result, a gift, a packet, a sitting) are read when the player follows one,
 * not when the page's own Back, taken because a dialog or sheet closed, lands on an entry that still holds one: that
 * reopened a duel link already answered (arena-starts spec on CI). The back stack says which hash its own back landed
 * on; that hash, once, is put aside. A link the player follows, or reaches with the phone's Back, is read as before.
 */
import { isOwnLanding } from "./backStack";

/** Calls `follow` for a link to read and `aside` for one the page's own back landed on, until the returned call. */
export function watchLinks(follow: () => void, aside: () => void): () => void {
  const onHash = () => (isOwnLanding(location.hash) ? aside() : follow());
  window.addEventListener("hashchange", onHash);
  return () => window.removeEventListener("hashchange", onHash);
}
