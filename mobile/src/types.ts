export type EntryType = "meal" | "activity" | "water";

export type MealSlot =
  | "breakfast"
  | "second_breakfast"
  | "lunch"
  | "lanch"
  | "snack"
  | "afternoon"
  | "dinner"
  | "late_dinner";

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
  favorite_id?: number | null;
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
  meal_slot: MealSlot | null;
  volume_ml: number | null;
  created_at: string | null;
};

export type EntryDetails = Entry & {
  analysis: {
    confidence: number | null;
    assumptions: string[];
    portion_assumed: boolean;
    needs_clarification: boolean;
    clarification_question: string | null;
    input_text: string | null;
    created_at: string | null;
  } | null;
  media: { id: string; mime: string; url: string }[];
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
  water_ml: number;
  streak: number | null;
};

export type NutrientTargets = {
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  micronutrients: Record<string, number>;
};

export type RequestLimits = {
  photo: number;
  text: number;
  voice: number;
};

export type RequestUsage = {
  limit_mode?: "split" | "shared";
  requests_used_today: number;
  daily_limit: number;
  limits?: RequestLimits;
  used?: RequestLimits;
};

export type DayView = {
  health?: import("./health/types").HealthData | null;
  date: string;
  entry_dates?: string[];
  balance: Balance;
  nutrient_targets: NutrientTargets;
  entries: Entry[];
  profile_complete: boolean;
  requests_used_today: number;
  daily_limit: number;
  bonus_requests: number;
  limit_mode?: "split" | "shared";
  limits?: RequestLimits;
  used?: RequestLimits;
};

export type StatisticsCalendarData = {
  month: string;
  today: string;
  days: { date: string; entry_count: number }[];
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
  volume_ml: number | null;
  source_entry_id: number | null;
  micronutrients?: Record<string, number> | null;
  items?: NutrientItem[] | null;
  created_at?: string | null;
};

export type Profile = {
  weight_goal?: WeightGoal | null;
  weight_kg: number | null;
  height_cm: number | null;
  age: number | null;
  sex: "male" | "female" | null;
  goal: "lose" | "maintain" | "gain" | null;
  activity_level:
    "sedentary" | "light" | "moderate" | "active" | "very_active" | null;
  daily_calorie_target: number;
  is_complete: boolean;
};

export type WeightMeasurement = {
  id: string; weight_kg: number; recorded_at: string; local_date: string;
  source: "manual" | "health_connect"; origin: string | null;
};
export type WeightGoal = {
  id: string; status: "active" | "completed" | "cancelled" | "replaced";
  direction: "lose" | "maintain" | "gain"; direction_label: string;
  start_weight_kg: number; target_weight_kg: number; current_weight_kg: number | null;
  progress: number | null; reached: boolean; change_kg: number | null; remaining_kg: number | null;
  started_at: string; finished_at: string | null;
};
export type WeighReminder = {
  enabled: boolean; effective_enabled: boolean; weekday: number; local_time: string;
  timezone: string; channel: "app" | "telegram" | "off"; delivery_ready: boolean; unavailable_reason: string | null;
};
export type Achievement = {
  key: string; title: string; description: string; target: number; progress: number;
  earned: boolean; awarded_at: string | null;
};
export type AchievementMessage = {
  id: string; title: string; message: string; created_at: string;
};
export type Achievements = {
  goal: WeightGoal | null; goal_history: WeightGoal[]; current_weight_kg: number | null;
  latest_measurement: WeightMeasurement | null; weight_history: WeightMeasurement[];
  achievements: Achievement[]; reminder: WeighReminder;
};

export type AccountSettings = {
  auth_method: "telegram" | "email";
  email: string | null;
  telegram_connected: boolean;
  notification_channel: "telegram"|"app"|"off";
  notifications_enabled: boolean;
  referral_url: string | null;
  bonus_requests: number;
  referral_monthly_goal: number;
  referral_progress: number;
  referral_rewarded_this_month: boolean;
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
  limit_mode?: "split" | "shared";
  limits?: RequestLimits;
  used?: RequestLimits;
};

export type StatsDay = {
  date:string;logged:boolean;calories:number|null;
  entry_count?:number;
  protein_g?:number|null;fat_g?:number|null;carbs_g?:number|null;
  water_ml?:number|null;activity_minutes?:number|null;activity_kcal?:number|null;
  fiber_g?:number|null;sugar_g?:number|null;
};
export type Stats = {
  health?: import("./health/types").HealthData | null;
  start_date:string;end_date:string;daily_calorie_target:number;total_calories:number;
  average_calories:number|null;logged_days:number;advanced_available:boolean;
  days:StatsDay[];weight:{recorded_at:string;local_date?:string;weight_kg:number;source?:string;origin?:string}[];
  targets?:Record<string,number>;meal_slots?:Record<string,number>;workouts?:number;
  water_days?:number;totals?:Record<string,number>;
  nutrients?: Record<"fiber_g" | "sugar_g", {
    total: number | null;
    average: number | null;
    recorded_days: number;
    meals_with_data: number;
    total_meals: number;
  }>;
};

export type AnalyzeResponse =
  | {
      status: "saved";
      entry: Entry;
      balance: Balance;
      transcript: string | null;
    }
  | { status: "unknown"; message: string }
  // Historical chat measurements; new measurements use the manual /weight form.
  | { status: "weight_saved"; type: "weight"; message: string;
      weight: { id: string; weight_kg: number; recorded_at: string }; transcript: string | null };
