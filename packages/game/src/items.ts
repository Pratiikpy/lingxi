/**
 * Food and care items. Values are visible meter units. Diet tags feed the
 * evolution circuit: what a pet eats over its life shapes its adult form.
 */

import type { Diet } from "./pet";

export interface FoodItem {
  id: string;
  name: { en: string; zh: string };
  /** item art, 24×24 pixel sprites */
  art: string;
  food: number;
  joy: number;
  diet: Diet;
}

export const FOODS: readonly FoodItem[] = [
  {
    id: "mochi",
    name: { en: "Rice mochi", zh: "糯米麻薯" },
    art: "art/items/rice_mochi.png",
    food: 300,
    joy: 20,
    diet: "grain",
  },
  {
    id: "apple",
    name: { en: "Golden apple", zh: "金苹果" },
    art: "art/items/golden_apple.png",
    food: 180,
    joy: 60,
    diet: "fruit",
  },
  {
    id: "burger",
    name: { en: "Burger", zh: "汉堡" },
    art: "art/items/cheeseburger.png",
    food: 380,
    joy: 0,
    diet: "savory",
  },
  {
    id: "sundae",
    name: { en: "Cherry sundae", zh: "樱桃圣代" },
    art: "art/items/best_ice_cream.png",
    food: 140,
    joy: 160,
    diet: "sweet",
  },
];

export const foodById = (id: string): FoodItem => {
  const f = FOODS.find((x) => x.id === id);
  if (!f) throw new Error(`unknown food ${id}`);
  return f;
};
