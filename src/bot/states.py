from aiogram.fsm.state import State, StatesGroup


class ProfileStates(StatesGroup):
    weight = State()
    height = State()
    age = State()
    sex = State()
    goal = State()
    target_weight = State()
    activity_level = State()
    daily_calorie_target = State()
    edit_weight = State()


class WeightTrackingStates(StatesGroup):
    weight = State()
    goal_start_weight = State()
    goal_target = State()
    goal_confirm = State()
    reminder_time = State()


class CorrectionStates(StatesGroup):
    waiting_text = State()


class StatisticsStates(StatesGroup):
    waiting_date = State()


class SurveyStates(StatesGroup):
    app_rating = State()
    photo_rating = State()
    feedback = State()
