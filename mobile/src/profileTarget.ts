import type { Profile } from "./types";

const activityMultipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
const goalAdjustments = { lose: -500, maintain: 0, gain: 300 };

type ProfileDraft = Pick<Profile, "sex" | "goal" | "activity_level"> & {
  weight: string;
  height: string;
  age: string;
};

/** Matches the server's daily-target calculation, including Python's rounding. */
export function calculateSetupTarget(draft: ProfileDraft): number | null {
  if (!draft.weight.trim() || !draft.height.trim() || !draft.age.trim() || !draft.sex || !draft.goal || !draft.activity_level) return null;
  const weight = Number(draft.weight.replace(",", "."));
  const height = Number(draft.height.replace(",", "."));
  const age = Number(draft.age.replace(",", "."));
  if (![weight, height, age].every(value => Number.isFinite(value) && value > 0) || !Number.isInteger(age) || age > 120) return null;

  const bmr = 10 * weight + 6.25 * height - 5 * age + (draft.sex === "male" ? 5 : -161);
  const value = bmr * activityMultipliers[draft.activity_level] + goalAdjustments[draft.goal];
  const floor = Math.floor(value);
  const rounded = value - floor === 0.5 ? floor + (floor % 2 === 0 ? 0 : 1) : Math.round(value);
  const target = Math.max(1200, rounded);
  // Keep the preview within the profile API's accepted calorie range.
  return Number.isFinite(target) && target <= 10000 ? target : null;
}
