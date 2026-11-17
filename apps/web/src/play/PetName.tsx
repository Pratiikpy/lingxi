/** A pet's name as a label, in its name colour when it has one (plan 4.9). The colour follows the theme. */

import { useExtras } from "../game/extras";
import { Named } from "./Named";

export function PetName({ name, petId, colour, as = "b", className = "" }: { name: string; petId?: string | null; colour?: number; as?: "b" | "span" | "strong"; className?: string }) {
  const known = useExtras((s) => (petId ? s.colours[petId] : undefined));
  return <Named name={name} colour={colour ?? known} as={as} className={className} />;
}
