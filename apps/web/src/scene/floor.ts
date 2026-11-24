/**
 * Where pets stand on the room's floor. The room is a 128-pixel scene scaled to cover its box and cropped evenly, so a
 * phone shows only its middle (about pixels 28 to 100); a visiting pet is kept inside what shows (A69).
 */

/** The scene's size, in room pixels. */
export const ROOM = 128;

/** Where the player's own pet stands when no one shares its room. */
export const PET_HOME = 64;

/** Half a pet's width at each stage, in room pixels. */
export const HALF = { baby: 10, child: 12, teen: 14, adult: 18 } as const;

/** The eight spots a visitor may stand at, and the range it wanders over, as on a room that shows whole. */
export const LANES = [26, 42, 86, 102, 34, 94, 18, 110] as const;
export const WANDER = { min: 14, max: 114 } as const;

/** The part of the room that shows, in room pixels. */
export interface FloorView {
  left: number;
  right: number;
}

/** The largest whole-number scale that covers a box of `w` by `h`, as the room draws itself. */
export function sceneScale(w: number, h: number): number {
  return Math.max(1, Math.ceil(Math.max(w, h) / ROOM));
}

/** Where pets' feet rest, in room pixels from the top. */
export const PET_FEET = 104;
/** CSS pixels at the room's foot the thinking strip lies over; the pet's feet stay above them. */
export const STRIP_ROOM = 76;

/**
 * Where the scaled room's top-left corner sits in a box of `w` by `h`, in CSS pixels from the box's own corner: cropped
 * evenly, but never so the pet's feet sink under the thinking strip along the room's foot (a shorter room on a phone,
 * with more lines in the care panel below it, otherwise lost the pet's lower half). The room draws itself here, and the
 * browser tests tap its pets from here, so the two can never drift apart.
 */
export function roomOrigin(w: number, h: number): { x: number; y: number; scale: number } {
  const scale = sceneScale(w, h);
  return {
    scale,
    x: Math.round((w - ROOM * scale) / 2),
    y: Math.round(Math.min((h - ROOM * scale) / 2, h - STRIP_ROOM - PET_FEET * scale)),
  };
}

/** What a box of `w` by `h` shows of the room. */
export function viewOf(w: number, h: number): FloorView {
  const scale = sceneScale(w, h);
  const left = Math.max(0, -Math.round((w - ROOM * scale) / 2) / scale);
  return { left, right: Math.min(ROOM, left + w / scale) };
}

/** A visitor's lane, the same each time for the same id. */
export function laneOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return LANES[h % LANES.length]!;
}

/**
 * Where a pet `half` wide stands for a spot `x` of the whole room, so its whole body is seen: the floor its body can
 * cover in the whole room (`half` to `ROOM - half`) is laid evenly over the floor it can cover in what shows. A room
 * that shows whole keeps every spot as it was; a cropped one keeps the lanes in order and spaced, moved at most by the
 * crop.
 */
export function floorSpot(x: number, view: FloorView, half: number): number {
  const lo = view.left + half;
  const hi = view.right - half;
  if (hi <= lo) return (view.left + view.right) / 2;
  const t = (Math.max(half, Math.min(ROOM - half, x)) - half) / (ROOM - 2 * half);
  return lo + t * (hi - lo);
}
