/**
 * R8: the moment after hatching, for the keyboard and a screen reader. The Hatch button goes with its screen, the
 * focus falls back to the page, and NVDA said only "document": nothing told a blind player that the pet was there.
 * The hatching leaves a mark here; the pet's button (PetButton.tsx), when the room first shows, takes the mark and
 * the focus, so what is read next is the pet: its name, its age and what it is doing.
 */
let hatched = false;

/** A pet has just been hatched on this page. */
export const markHatched = (): void => {
  hatched = true;
};

/** Whether a pet was just hatched; asking clears it, so only the first room after a hatching takes the focus. */
export const takeHatched = (): boolean => {
  const was = hatched;
  hatched = false;
  return was;
};
