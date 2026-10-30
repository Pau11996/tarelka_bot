"""Versioned, authored home workouts. Keep released versions for offline clients.

Movement references (reviewed 2026-10-30):
https://www.nhs.uk/live-well/exercise/strength-and-flex-exercise-plan-how-to-videos/
https://www.nhs.uk/live-well/exercise/flexibility-exercises/
MET references: https://pacompendium.com/conditioning-exercise/
02030 = light calisthenics (3.5), 02056 = bodyweight resistance (3.0),
02101 = mild stretching (2.3). Values describe activity categories, not
measurements of an individual. Artwork and Russian descriptions are original.
"""
from __future__ import annotations

from copy import deepcopy


def exercise(id, title, cue, instruction, animation, met=3.5, *, mirror=False, equipment=None):
    return dict(id=id, title=title, cue=cue, instruction=instruction,
                animation=animation, mirror=mirror, met=met, equipment=equipment or [])


EXERCISES = [
    exercise("march", "Шаги на месте", "Мягко ставьте стопы. Дышите свободно.",
             "Встаньте прямо и шагайте на месте в удобном темпе. Поднимайте колени невысоко, помогайте себе руками.", "march"),
    exercise("side_step", "Приставные шаги", "Шаг в сторону — приставьте вторую ногу.",
             "Сделайте небольшой шаг вправо и приставьте левую ногу. Повторите влево. Не подпрыгивайте, сохраняйте мягкие колени.", "side_step"),
    exercise("shoulders", "Движение плечами", "Поднимите плечи и плавно опустите.",
             "Руки свободно опущены. Медленно поднимите плечи к ушам, затем расслабьте и опустите. Не запрокидывайте голову.", "shoulders"),
    exercise("arm_raise", "Подъёмы рук", "Поднимайте руки только до удобной высоты.",
             "Из положения стоя поднимите руки через стороны, затем плавно опустите. Сохраняйте спину ровной, не прогибайтесь.", "arm_raise"),
    exercise("squat", "Неглубокие приседания", "Таз назад, пятки остаются на полу.",
             "Поставьте стопы на ширине плеч. Слегка согните колени, отводя таз назад. Колени направлены вдоль стоп. Плавно выпрямитесь; глубина должна быть комфортной.", "squat", 3.0),
    exercise("wall_push", "Отжимания от стены", "Корпус ровный. Двигайтесь медленно.",
             "Встаньте лицом к стене на расстоянии вытянутых рук. Ладони на уровне плеч. Согните локти, приблизив корпус к стене, и оттолкнитесь обратно. Стопы не скользят.", "wall_push", 3.0, equipment=["Свободная стена"]),
    exercise("calf_raise", "Подъёмы на носки", "Поднимайтесь и опускайтесь без рывка.",
             "Стойте прямо, стопы параллельны. Поднимите пятки, затем медленно верните их на пол. При необходимости слегка придерживайтесь за стену.", "calf_raise", 3.0, equipment=["Стена для опоры при необходимости"]),
    exercise("leg_left", "Нога в сторону · левая", "Таз неподвижен, носок смотрит вперёд.",
             "Перенесите вес на правую ногу. Невысоко отведите прямую левую ногу в сторону и верните. Не наклоняйте корпус; для равновесия используйте стену.", "leg_side", 3.0, equipment=["Стена для опоры при необходимости"]),
    exercise("leg_right", "Нога в сторону · правая", "Таз неподвижен, носок смотрит вперёд.",
             "Перенесите вес на левую ногу. Невысоко отведите прямую правую ногу в сторону и верните. Не наклоняйте корпус; для равновесия используйте стену.", "leg_side", 3.0, mirror=True, equipment=["Стена для опоры при необходимости"]),
    exercise("chest", "Раскрытие грудной клетки", "Плечи вниз, не прогибайтесь в пояснице.",
             "Встаньте ровно. Разведите руки в стороны чуть ниже плеч и мягко отведите их назад до лёгкого натяжения. Удерживайте удобное положение и спокойно дышите.", "chest", 2.3),
    exercise("bend_left", "Наклон влево", "Тянитесь в сторону, не разворачивая корпус.",
             "Стопы на ширине таза. Скользните левой ладонью вниз по бедру, слегка наклоняясь влево. Удерживайте комфортное положение без пружинящих движений.", "side_bend", 2.3),
    exercise("bend_right", "Наклон вправо", "Тянитесь в сторону, не разворачивая корпус.",
             "Стопы на ширине таза. Скользните правой ладонью вниз по бедру, слегка наклоняясь вправо. Удерживайте комфортное положение без пружинящих движений.", "side_bend", 2.3, mirror=True),
    exercise("stretch_left", "Растяжка левой икры", "Задняя пятка прижата к полу.",
             "Упритесь ладонями в стену. Отставьте левую ногу назад, сохраняя её прямой. Слегка согните правое колено до мягкого натяжения в левой икре. Удерживайте без рывков.", "calf_stretch", 2.3, equipment=["Свободная стена"]),
    exercise("stretch_right", "Растяжка правой икры", "Задняя пятка прижата к полу.",
             "Упритесь ладонями в стену. Отставьте правую ногу назад, сохраняя её прямой. Слегка согните левое колено до мягкого натяжения в правой икре. Удерживайте без рывков.", "calf_stretch", 2.3, mirror=True, equipment=["Свободная стена"]),
]


def routine(id, title, subtitle, focus, sequence, *, seconds=30, rest=15, reps=None, preview=None):
    steps = []
    for i, key in enumerate(sequence):
        count = (reps or {}).get(key)
        steps.append(dict(id=f"{id}-{i + 1}", exercise_id=key,
                          duration_seconds=None if count else seconds,
                          repetitions=count, expected_seconds=count * 4 if count else seconds,
                          rest_seconds=rest if i < len(sequence) - 1 else 0))
    equipment = sorted({item for ex in EXERCISES if ex["id"] in sequence for item in ex["equipment"]})
    return dict(id=id, title=title, subtitle=subtitle, focus=focus, level="Начальный",
                equipment=equipment, space="Место для шага в сторону и свободного движения рук",
                preview_exercise_id=preview or sequence[2], steps=steps,
                duration_seconds=sum(step["expected_seconds"] + step["rest_seconds"] for step in steps))


WARM = ["march", "shoulders", "arm_raise"]
COOL = ["chest", "stretch_left", "stretch_right"]
BODY = ["squat", "wall_push", "calf_raise", "leg_left", "leg_right", "side_step", "march", "arm_raise"]
WORKOUTS = [
    routine("morning", "Мягкая зарядка", "Начните день с движения", "Зарядка",
            WARM + ["side_step", "calf_raise", "bend_left", "bend_right", "chest"], rest=10),
    routine("body_short", "Всё тело · 10 минут", "Небольшое занятие для основных мышц", "Всё тело",
            WARM + BODY + COOL, reps={"wall_push": 8, "squat": 8}, preview="squat"),
    routine("body_long", "Всё тело · 15 минут", "Больше движения в спокойном темпе", "Всё тело",
            WARM + BODY + BODY[:6] + COOL, reps={"wall_push": 8, "squat": 8}, preview="wall_push"),
    routine("legs", "Лёгкость в ногах", "Приседания, баланс и подъёмы на носки", "Ноги",
            WARM + ["squat", "calf_raise", "leg_left", "leg_right"] * 2 + COOL,
            reps={"squat": 8, "calf_raise": 8}, preview="leg_left"),
    routine("standing", "Стоя, без прыжков", "Спокойное движение без упражнений на полу", "Без прыжков",
            WARM + ["side_step", "march", "arm_raise", "calf_raise"] * 2 + COOL, preview="march"),
    routine("stretch", "Пауза на растяжку", "Мягкие движения и спокойное дыхание", "Растяжка",
            ["march", "shoulders", "chest", "bend_left", "bend_right", "stretch_left", "stretch_right", "chest"], rest=10),
]

CATALOGS = {1: dict(version=1, exercises=EXERCISES, workouts=WORKOUTS)}


def catalogue(version: int = 1):
    return deepcopy(CATALOGS[version])


def workout_definition(version: int, id: str):
    return next((item for item in CATALOGS.get(version, {}).get("workouts", []) if item["id"] == id), None)


def active_kcal(version: int, steps: list[dict], weight_kg: float) -> float:
    """Net active energy, excluding rest and the 1 MET resting component."""
    exercises = {item["id"]: item for item in CATALOGS[version]["exercises"]}
    return round(sum(max(exercises[s["exercise_id"]]["met"] - 1, 0) * 3.5 * weight_kg
                     / 200 * s["active_seconds"] / 60 for s in steps), 1)
