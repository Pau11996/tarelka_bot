from aiogram.fsm.state import State, StatesGroup


class ProfileStates(StatesGroup):
    weight = State()
    height = State()
    age = State()
    sex = State()
    goal = State()
    activity_level = State()
    daily_calorie_target = State()


class CorrectionStates(StatesGroup):
    waiting_text = State()


class StatisticsStates(StatesGroup):
    waiting_date = State()
