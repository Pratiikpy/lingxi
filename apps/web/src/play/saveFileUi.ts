/**
 * Whether the save-file sheet is open, kept apart from the sheet itself (P3): the hatch screen only opens it, and the
 * sheet's own code (the save readers, moving pets, the sheet frame) loads with the game behind it.
 */
import { create } from "zustand";

export const useSaveFileUi = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
