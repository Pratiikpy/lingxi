/**
 * Where the pet and the room's resident stand this frame (P7: out of RoomScene's frame loop). With floor to spare the
 * resident keeps its own spot, pulled inside what shows, and the pet stays home; with too little, the two stand side
 * by side, centred in what shows, the resident on the side it lives on.
 */
import { HALF, PET_HOME, type FloorView } from "./floor";

type Stage = keyof typeof HALF;

/** half the width of a pet at a stage that may be one the room does not draw (an elder stands as an adult) */
export function halfOf(stage: string): number {
  return HALF[(stage in HALF ? stage : "adult") as Stage];
}

export interface ResidentAt {
  petX: number;
  spot: { id: string; x: number } | null;
}

export function placeResident(
  resident: { id: string; stage: string; x: number } | null,
  petStage: Stage,
  view: FloorView,
): ResidentAt {
  if (!resident) return { petX: PET_HOME, spot: null };
  const { left, right } = view;
  const hp = HALF[petStage];
  const hr = halfOf(resident.stage);
  const onRight = resident.x >= PET_HOME;
  const want = Math.max(left + hr + 2, Math.min(right - hr - 2, resident.x));
  const gap = Math.abs(want - PET_HOME) - hp - hr;
  if (gap >= 4) return { petX: PET_HOME, spot: { id: resident.id, x: want } };
  // not enough floor: stand the two side by side, centred in what shows
  const total = 2 * hp + 2 * hr + 6;
  const start = left + Math.max(2, (right - left - total) / 2);
  return {
    petX: Math.round(onRight ? start + hp : start + 2 * hr + 6 + hp),
    spot: { id: resident.id, x: Math.round(onRight ? start + 2 * hp + 6 + hr : start + hr) },
  };
}
