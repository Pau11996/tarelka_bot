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

# Reference: the user's 2026-10-31 screen recording, documented in
# docs/workout-full-body-reference.md. Never mutate catalogue 1: queued sessions
# still resolve its step IDs, instructions and MET values.
FULL_BODY_EXERCISES = [
    exercise("standing_knee_elbow", "Колени к локтям стоя", "Колено к противоположному локтю. Чередуйте стороны.",
             "Встаньте, поставив стопы на ширине плеч, руки держите у ушей. Поднимите правое колено и поверните корпус к нему левым локтем. Верните стопу на пол и выполните движение другой стороной. Не тяните голову руками.", "standing_knee_elbow"),
    exercise("sumo_squat", "Вприсядку", "Стойка шире плеч. Колени направлены вдоль носков.",
             "Расставьте ноги шире плеч, слегка разверните носки наружу и положите ладони на бёдра. Согните колени, опуская таз между ногами, затем выпрямитесь. Сохраняйте пятки на полу.", "sumo_squat", 3.0),
    exercise("squat_kick", "Приседание с ударом ногой вперёд", "Присед — подъём — удар ногой. Меняйте ногу.",
             "Стопы на ширине плеч, руки перед грудью. Присядьте с отведением таза назад, выпрямитесь и выполните контролируемый удар одной ногой вперёд. Верните стопу, снова присядьте и повторите другой ногой. Не разгибайте колено рывком.", "squat_kick", 3.0),
    exercise("incline_pushup", "Отжимание с опорой впереди", "Прямая линия от головы до пяток. Опора неподвижна.",
             "Положите ладони на устойчивую опору перед собой и отойдите ногами назад. Сгибая локти, приблизьте грудь к опоре, затем выпрямите руки. Корпус и таз опускаются вместе.", "incline_pushup", 3.0, equipment=["Устойчивый стул без колёс у стены"]),
    exercise("chair_dip", "Обратные отжимания от стула", "Таз рядом с краем стула. Локти сгибаются назад.",
             "Повернитесь спиной к устойчивому стулу, обопритесь ладонями о край сиденья. Перенесите таз за край, стопы оставьте на полу. Медленно согните локти примерно до прямого угла и поднимитесь, выпрямляя руки. Не опускайтесь через боль в плечах.", "chair_dip", 3.0, equipment=["Устойчивый стул без колёс у стены"]),
    exercise("prone_pull", "Локти к бокам лёжа", "Локти к рёбрам — руки вперёд. Шея продолжает спину.",
             "Лягте на живот и вытяните руки вперёд. Слегка приподнимите грудь и руки, согните локти и подтяните их к бокам. Плавно вытяните руки обратно. Ноги остаются на коврике, взгляд направлен вниз.", "prone_pull", 3.0, equipment=["Коврик"]),
    exercise("plank_pike", "Из планки в перевёрнутую V", "Ладони и носки на месте. Поднимайте таз вверх.",
             "Примите планку на прямых руках: ладони под плечами, тело вытянуто. Поднимите таз вверх и отведите его назад, формируя перевёрнутую букву V. Плавно вернитесь в прямую планку без провисания поясницы.", "plank_pike", 3.0, equipment=["Коврик"]),
    exercise("seated_knee_tuck", "Ноги к себе — от себя", "Подтяните колени к груди. Стопы остаются над полом.",
             "Сядьте на коврик, поставьте ладони позади таза и немного отклонитесь назад. Подтяните согнутые ноги к груди, затем плавно вытяните их перед собой, не опуская пятки на пол. Двигайте обе ноги одновременно.", "seated_knee_tuck", 3.0, equipment=["Коврик"]),
    exercise("crunch_reach", "Упражнение для пресса", "Поднимайте лопатки, тянитесь руками вперёд.",
             "Лягте на спину, согните колени и поставьте стопы на коврик. Вытяните руки перед собой, приподнимите верхнюю часть корпуса и потянитесь к коленям. Сделайте короткую задержку и медленно опустите лопатки.", "crunch_reach", 3.0, equipment=["Коврик"]),
    exercise("hands_behind", "Сцепленные за спиной руки", "Соедините ладони за спиной. Плечи опущены.",
             "Встаньте прямо, стопы на ширине плеч. Соедините руки за спиной и мягко выпрямите локти, отводя ладони назад. Удерживайте положение без прогиба в пояснице и спокойно дышите.", "hands_behind", 2.3),
    exercise("quad_right", "Растяжка бедра у стены · правая", "Колени рядом. Правая пятка к ягодице.",
             "Встаньте рядом со стеной и обопритесь левой ладонью. Согните правое колено, возьмите правой рукой лодыжку и мягко приблизьте пятку к ягодице. Сохраняйте вертикальный корпус и удерживайте положение.", "quad_stretch", 2.3, equipment=["Свободная стена"]),
    exercise("quad_left", "Растяжка бедра у стены · левая", "Колени рядом. Левая пятка к ягодице.",
             "Обопритесь правой ладонью о стену. Согните левое колено и возьмите левой рукой лодыжку, мягко приближая пятку к ягодице. Не отводите колено в сторону, удерживайте положение и спокойно дышите.", "quad_stretch", 2.3, mirror=True, equipment=["Свободная стена"]),
]

_full_body_steps = [dict(id=f"body_short-reference-{i + 1}", exercise_id=ex["id"],
                         duration_seconds=30, repetitions=None, expected_seconds=30,
                         rest_seconds=30 if i < 11 else 0)
                    for i, ex in enumerate(FULL_BODY_EXERCISES)]
FULL_BODY_WORKOUT = dict(
    id="body_short", title="Всё тело · День 1", subtitle="12 упражнений по 30 секунд",
    focus="Всё тело", level="Начальный", equipment=["Коврик", "Устойчивый стул без колёс у стены", "Свободная стена"],
    space="Место, чтобы лечь во весь рост, вытянуть руки и сделать удар ногой вперёд",
    preview_exercise_id="standing_knee_elbow", steps=_full_body_steps,
    duration_seconds=sum(s["expected_seconds"] + s["rest_seconds"] for s in _full_body_steps),
)
CATALOGS[2] = dict(version=2, exercises=deepcopy(EXERCISES) + FULL_BODY_EXERCISES,
                   workouts=[deepcopy(FULL_BODY_WORKOUT) if w["id"] == "body_short" else deepcopy(w) for w in WORKOUTS])

# Preserve v1/v2 byte-for-byte for queued results and older APKs.
from src.shared.workout_course import build_course

COURSE_EXERCISES = deepcopy(CATALOGS[2]["exercises"]) + [
    exercise("glute_bridge", "Ягодичный мост", "Поднимите таз. Не прогибайте поясницу.",
             "Лягте на спину, согните колени, стопы на ширине таза. На выдохе плавно поднимите таз до линии плечи–таз–колени. Задержитесь и медленно опуститесь. Стопы и плечи остаются на коврике.", "glute_bridge", 3.0, equipment=["Коврик"]),
    exercise("bird_dog", "Рука–нога на четвереньках", "Противоположные рука и нога. Таз неподвижен.",
             "Встаньте на четвереньки: ладони под плечами, колени под тазом. Плавно вытяните одну руку и противоположную ногу до линии корпуса. Вернитесь и смените сторону. Не прогибайте поясницу и не разворачивайте таз. Если сложно, поднимайте только руку или только ногу.", "bird_dog", 3.0, equipment=["Коврик"]),
]
COURSE, COURSE_WORKOUTS = build_course(COURSE_EXERCISES)
CATALOGS[3] = dict(version=3, exercises=COURSE_EXERCISES,
                   workouts=deepcopy(CATALOGS[2]["workouts"]) + COURSE_WORKOUTS, course=COURSE)

# Revise the curriculum without changing any published workout or exercise.
from src.shared.workout_course_v2 import build_course as build_course_v2

BEGINNER_EXERCISES = deepcopy(COURSE_EXERCISES) + [
    exercise("quadruped_leg", "Вытягивание ноги на четвереньках", "Обе ладони на коврике. Чередуйте ноги.",
             "Встаньте на четвереньки: ладони под плечами, колени под тазом. Плавно вытяните одну ногу назад, не выше линии корпуса. "
             "Верните колено под таз и смените ногу. Не разворачивайте таз и не прогибайте поясницу. "
             "Каждая сторона считается одним повтором.", "quadruped_leg", 3.0, equipment=["Коврик"]),
]
_adaptations = {
    "squat": "Сделайте приседание менее глубоким. Если нужно, придерживайтесь за устойчивую опору.",
    "wall_push": "Встаньте ближе к стене и уменьшите сгибание локтей. Опора не должна скользить.",
    "calf_raise": "Придерживайтесь за стену и поднимайте пятки невысоко.",
    "leg_left": "Придерживайтесь за стену. Отводите ногу совсем немного, сохраняя таз неподвижным.",
    "leg_right": "Придерживайтесь за стену. Отводите ногу совсем немного, сохраняя таз неподвижным.",
    "prone_pull": "Уменьшите подъём груди и амплитуду рук. Движение тренирует контроль спины и не заменяет тягу с сопротивлением.",
    "glute_bridge": "Поднимайте таз невысоко. Остановите подъём до прогиба в пояснице.",
    "quadruped_leg": "Скользите носком назад по коврику, не поднимая стопу. Обе ладони остаются на опоре.",
    "bird_dog": "Поднимайте только ногу, оставляя обе ладони на коврике. Каждая сторона — один повтор.",
}
for _ex in BEGINNER_EXERCISES:
    if _ex["id"] in _adaptations:
        # Extra guidance is additive; legacy titles/instructions/MET stay unchanged.
        _ex["easier"] = _adaptations[_ex["id"]]
    if _ex["id"] == "bird_dog":
        _ex["repetition_note"] = "Чередуйте стороны. Каждая сторона — один повтор."
    elif _ex["id"] == "quadruped_leg":
        _ex["repetition_note"] = "Чередуйте ноги. Каждая нога — один повтор."
BEGINNER_COURSE, BEGINNER_WORKOUTS = build_course_v2(BEGINNER_EXERCISES)
CATALOGS[4] = dict(version=4, exercises=BEGINNER_EXERCISES,
                   workouts=deepcopy(CATALOGS[3]["workouts"]) + BEGINNER_WORKOUTS, course=BEGINNER_COURSE)

# Catalogue 5 adds independent courses and profile-selected programmes. History
# and offline drafts continue to resolve their original immutable definitions.
from src.shared.workout_courses import build_courses

PERSONAL_EXERCISES = deepcopy(BEGINNER_EXERCISES) + [
    exercise("push_up", "Отжимания от пола", "Корпус ровный. Опускайтесь и поднимайтесь плавно.",
             "Поставьте ладони примерно на ширине плеч, обопритесь на носки. Держите голову, корпус и ноги на одной линии. "
             "Согните локти и плавно опустите грудь к коврику до удобной глубины. На выдохе выпрямите руки. "
             "Не проваливайте поясницу и не поднимайте таз отдельно от плеч. Закончите подход до потери техники.",
             "push_up", 3.0, equipment=["Коврик"]),
    exercise("knee_push_up", "Отжимания с колен", "Опора на ладони и колени. Таз и плечи движутся вместе.",
             "Поставьте ладони примерно на ширине плеч, колени — на коврик. Отведите колени назад, выстроив прямую линию от головы до колен. "
             "Согните локти и плавно опустите грудь до удобной глубины. На выдохе выпрямите руки. "
             "Сохраняйте корпус ровным; не садитесь тазом на пятки. Закончите подход до потери техники.",
             "knee_push_up", 3.0, equipment=["Коврик"]),
]
for _ex in PERSONAL_EXERCISES:
    if _ex["id"] in ("push_up", "knee_push_up"):
        _ex["easier"] = ("Выберите лёгкую нагрузку для отжиманий от стены. Также можно отжиматься от устойчивой, нескользящей опоры перед собой. "
                         + ("На среднем уровне доступны отжимания с колен." if _ex["id"] == "push_up" else "Уменьшите глубину движения."))
    elif _ex["id"] == "standing_knee_elbow":
        _ex["repetition_note"] = "Чередуйте стороны. Каждая сторона считается одним повтором."
    elif _ex["id"] == "sumo_squat":
        _ex["easier"] = "Уменьшите глубину приседания; при необходимости придерживайтесь за устойчивую опору."
    elif _ex["id"] == "crunch_reach":
        _ex["easier"] = "Приподнимайте лопатки совсем немного. Не тяните голову вперёд и сохраняйте спокойное дыхание."
PERSONAL_COURSES, PERSONAL_WORKOUTS = build_courses(PERSONAL_EXERCISES, BEGINNER_COURSE, BEGINNER_WORKOUTS)
COURSES = {course["id"]: course for course in PERSONAL_COURSES}
CATALOGS[5] = dict(version=5, exercises=PERSONAL_EXERCISES,
                   workouts=deepcopy(CATALOGS[4]["workouts"]) + PERSONAL_WORKOUTS, courses=PERSONAL_COURSES)


def catalogue(version: int = 1):
    return deepcopy(CATALOGS[version])


def workout_definition(version: int, id: str):
    return next((item for item in CATALOGS.get(version, {}).get("workouts", []) if item["id"] == id), None)


def active_kcal(version: int, steps: list[dict], weight_kg: float) -> float:
    """Net active energy, excluding rest and the 1 MET resting component."""
    exercises = {item["id"]: item for item in CATALOGS[version]["exercises"]}
    return round(sum(max(exercises[s["exercise_id"]]["met"] - 1, 0) * 3.5 * weight_kg
                     / 200 * s["active_seconds"] / 60 for s in steps), 1)
