import type { DayView } from "../types";

export type DailyNorm = {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  personalized: boolean;
};

// Share the server's base targets, independently of food and activity logged today.
export function dailyNorm(day: DayView): DailyNorm | null {
  const values = [day.balance.target, day.nutrient_targets.protein_g, day.nutrient_targets.fat_g, day.nutrient_targets.carbs_g];
  if (values[0] <= 0 || values.some(value => !Number.isFinite(value) || value < 0)) return null;
  const [calories, protein, fat, carbs] = values.map(Math.round);
  return { calories, protein, fat, carbs, personalized: day.profile_complete };
}

export function normNumber(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function normTitle(norm: DailyNorm): string {
  return norm.personalized ? "Моя дневная норма" : "Стартовый ориентир";
}

export function normDescription(norm: DailyNorm): string {
  return `${normTitle(norm)}: ${normNumber(norm.calories)} ккал, белки ${norm.protein} г, жиры ${norm.fat} г, углеводы ${norm.carbs} г.`;
}
