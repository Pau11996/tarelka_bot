export type EntryType = "meal" | "activity";

export type NutrientItem = {
  name: string;
  quantity?: string | null;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type Entry = {
  id: number;
  entry_date: string;
  entry_type: EntryType;
  title: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  micronutrients: Record<string, number> | null;
  items: NutrientItem[] | null;
  duration_minutes: number | null;
  created_at: string | null;
};

export type Balance = {
  target: number;
  consumed: number;
  activity_bonus: number;
  remaining: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  micronutrients: Record<string, number>;
  streak: number | null;
};

export type NutrientTargets = {
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  micronutrients: Record<string, number>;
};

export type DayView = {
  date: string;
  balance: Balance;
  nutrient_targets: NutrientTargets;
  entries: Entry[];
  profile_complete: boolean;
  requests_used_today: number;
  daily_limit: number;
  bonus_requests: number;
};

export type Favorite = {
  id: number;
  entry_type: EntryType;
  title: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  duration_minutes: number | null;
  source_entry_id: number | null;
};

export type Profile = {
  weight_kg: number | null;
  height_cm: number | null;
  age: number | null;
  sex: "male" | "female" | null;
  goal: "lose" | "maintain" | "gain" | null;
  activity_level: "sedentary" | "light" | "moderate" | "active" | "very_active" | null;
  daily_calorie_target: number;
  is_complete: boolean;
};

export type AccountSettings = {
  notifications_enabled: boolean;
  referral_url: string | null;
  bonus_requests: number;
  referral_bonus_requests: number;
  support_email: string;
  channel_url: string | null;
  feedback_url: string | null;
};

export type Subscription = {
  active: boolean;
  until: string | null;
  daily_limit: number;
  requests_used_today: number;
  bonus_requests: number;
};

export type Stats = {
  start_date: string;
  end_date: string;
  daily_calorie_target: number;
  total_calories: number;
  average_calories: number;
  days: { date: string; calories: number; protein_g: number; fat_g: number; carbs_g: number }[];
  weight: { recorded_at: string; weight_kg: number }[];
};

export type AnalyzeResponse =
  | { status: "saved"; entry: Entry; balance: Balance; transcript: string | null }
  | { status: "unknown"; message: string };
