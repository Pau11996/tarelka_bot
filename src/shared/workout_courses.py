"""Authored home/walking curricula for catalogue 5. Published versions stay immutable."""
from copy import deepcopy

from src.shared.workout_course import COURSE_ID
from src.shared.workout_course_v2 import LEVELS, MOBILITY, WALK_MINUTES

HOME_COURSE_ID = "full_body_home_28_v1"
WEEKS = (
    ("A", "L1", "B", "L2", "C", "L3", "rest"),
    ("B", "L2", "C", "L3", "A", "L1", "rest"),
    ("C", "L3", "A", "L1", "B", "L2", "rest"),
    ("B", "L1", "C", "L2", "A", "L3", "rest"),
)
SEQUENCES = {
    "female": {
        "A": ("squat", "wall_push", "calf_raise", "prone_pull", "glute_bridge", "quadruped_leg"),
        "B": ("squat", "wall_push", "leg_left", "leg_right", "prone_pull", "glute_bridge"),
        "C": ("sumo_squat", "wall_push", "calf_raise", "prone_pull", "glute_bridge", "standing_knee_elbow"),
    },
    "male": {
        "A": ("push", "squat", "prone_pull", "push", "glute_bridge", "calf_raise"),
        "B": ("squat", "push", "leg_left", "leg_right", "glute_bridge", "quadruped_leg"),
        "C": ("sumo_squat", "push", "prone_pull", "glute_bridge", "push", "crunch_reach"),
    },
}
LIGHT = {
    "L1": ("shoulders", "arm_raise", "bend_left", "bend_right", "chest", "hands_behind", "stretch_left", "stretch_right"),
    "L2": ("side_step", "arm_raise", "standing_knee_elbow", "shoulders", "bend_left", "bend_right", "stretch_left", "stretch_right"),
    "L3": ("side_step", "arm_raise", "shoulders", "hands_behind", "bend_left", "bend_right", "quad_left", "quad_right"),
}
TITLES = {"A": "Всё тело", "B": "Ноги и равновесие", "C": "Движение и координация",
          "L1": "Плечи и спина", "L2": "Мягкое движение", "L3": "Подвижность"}
WARMUP = (("march", 60), ("side_step", 45), ("shoulders", 30))
FINISH = (("arm_raise", "cooldown"), ("shoulders", "cooldown"), ("chest", "stretch"))
PUSH = {"light": "wall_push", "medium": "knee_push_up", "intense": "push_up"}
EQUIPMENT = "Коврик и свободная стена. Устойчивая опора — по необходимости для равновесия и облегчения отжиманий."
PACING = "Выполняйте движения плавно, без боли и спешки. Отдых можно продлевать. Нагрузка не увеличивается автоматически."
LOAD = "Нагрузка меняет число повторов. Выберите удобный уровень; после занятия можно оценить усилие."
MALE_LOAD = "Нагрузка меняет число повторов и отжимания: от стены, с колен или от пола. Выберите вариант, в котором сохраняете технику."


def _legacy_female(course, workouts):
    """Give the unchanged v4 programme new IDs while retaining every old definition."""
    program = deepcopy(course)
    program.pop("id")
    program.pop("title")
    program.update(description="Занятия для всего тела, прогулки и восстановление.",
                   load_description="Нагрузка меняет число повторов и вариант упражнения на четвереньках.",
                   instructions=[EQUIPMENT, "Один подход каждого упражнения. Разминка и спокойные шаги в конце — по пять минут.",
                                 PACING, "Прогулки постепенно увеличиваются от 15 до 30 минут; время можно сокращать и делить на части."])
    definitions = []
    for source in workouts:
        workout = deepcopy(source)
        wid = f"fbwalk_f_d{source['course_day']:02}_{source['activity_level']}"
        workout.update(id=wid, course_variant="female", title=f"Всё тело + прогулки · День {source['course_day']} · {source['level']}")
        for index, step in enumerate(workout["steps"], 1):
            step["id"] = f"{wid}-{index}"
        program["days"][source["course_day"] - 1]["workout_ids"][source["activity_level"]] = wid
        definitions.append(workout)
    return program, definitions


def _program(course_id, title, variant, exercises, legacy_course):
    home = course_id == HOME_COURSE_ID
    days, workouts = [], []
    for number in range(1, 29):
        week, weekday = divmod(number - 1, 7)
        sequence = WEEKS[week][weekday]
        if not home and weekday in (1, 3, 5):
            sequence = "mobility" if weekday == 3 else "walk"
        kind = "rest" if sequence == "rest" else "walk" if sequence == "walk" else "mobility" if sequence.startswith("L") or sequence == "mobility" else "strength"
        description = ("Два круга упражнений. " + PACING) if kind == "strength" else "Два круга спокойных движений. Не увеличивайте амплитуду через дискомфорт."
        day_title = TITLES.get(sequence, {"rest": "Отдых и восстановление", "walk": "Прогулка", "mobility": "Мягкая подвижность"}.get(sequence))
        if kind == "rest":
            description = "День без обязательных упражнений. Отдохните и восстановитесь."
            if number == 28:
                description += " Курс завершён. Сравните уверенность движений и усилие с началом курса."
        elif kind == "walk":
            description = legacy_course["days"][number - 1]["description"]
        elif sequence == "mobility":
            description = "Шесть спокойных движений. Не стремитесь увеличить амплитуду через дискомфорт."
        if number == 26:
            day_title = "Сравнение со стартом"
            description += " Повтор первого занятия. Для сравнения выберите ту же нагрузку и вариант опоры."
        day = dict(day=number, week=week + 1, kind=kind, title=day_title, description=description,
                   workout_ids={}, walk_minutes=WALK_MINUTES.get(number) if kind == "walk" else None)
        for level, (label, reps) in LEVELS.items():
            if kind not in ("strength", "mobility"):
                break
            wid = f"fb{'home' if home else 'walk'}_{variant[0]}_d{number:02}_{level}"
            day["workout_ids"][level] = wid
            steps = []

            def add(exercise_id, section, seconds=None, repetitions=None, round_number=None):
                step = dict(id=f"{wid}-{len(steps) + 1}", exercise_id=exercise_id, section=section,
                            duration_seconds=seconds, repetitions=repetitions,
                            expected_seconds=seconds if seconds is not None else repetitions * (5 if exercise_id == "quadruped_leg" else 4),
                            rest_seconds=30 if section == "main" else 15, optional=False)
                if round_number is not None:
                    step["round"] = round_number
                steps.append(step)

            if sequence == "mobility":
                for exercise_id, seconds in MOBILITY:
                    add(exercise_id, "mobility", seconds=seconds)
            else:
                for exercise_id, seconds in WARMUP:
                    add(exercise_id, "warmup", seconds=seconds)
                for round_number in (1, 2):
                    for exercise_id in SEQUENCES[variant][sequence] if kind == "strength" else LIGHT[sequence]:
                        if exercise_id == "push":
                            exercise_id = PUSH[level]
                        add(exercise_id, "main" if kind == "strength" else "mobility",
                            repetitions=reps if kind == "strength" else None,
                            seconds=30 if kind == "mobility" else None, round_number=round_number)
                for exercise_id, section in FINISH:
                    add(exercise_id, section, seconds=30)
            used = {step["exercise_id"] for step in steps}
            workouts.append(dict(id=wid, title=f"{title} · День {number} · {label}", subtitle=day_title,
                                 focus="Всё тело" if kind == "strength" else "Подвижность", level=label,
                                 equipment=sorted({item for ex in used for item in exercises[ex]["equipment"]}),
                                 space="Место для шага в сторону и упражнений на коврике",
                                 preview_exercise_id="squat" if kind == "strength" else "arm_raise",
                                 duration_seconds=sum(s["expected_seconds"] + s["rest_seconds"] for s in steps),
                                 steps=steps, course_id=course_id, course_variant=variant, course_day=number,
                                 activity_level=level, kind=kind, curriculum_revision=1))
        days.append(day)
    description = ("Занятия для всего тела дома, подвижность и восстановление. Короткая разминка, коврик и стена."
                   if home else "Упражнения для всего тела, прогулки и восстановление.")
    instructions = [EQUIPMENT, "Два круга в основных занятиях. Разминка с переходами — три минуты, в конце — короткая заминка.", PACING]
    if not home:
        instructions.append("Прогулки постепенно увеличиваются от 15 до 30 минут; время можно сокращать и делить на части.")
    return dict(revision=1, days=days, description=description, instructions=instructions,
                load_description=MALE_LOAD if variant == "male" else LOAD), workouts


def build_courses(exercises, legacy_course, legacy_workouts):
    by_id = {exercise["id"]: exercise for exercise in exercises}
    courses, workouts = [], []
    for course_id, title in ((HOME_COURSE_ID, "Всё тело"), (COURSE_ID, "Всё тело + прогулки")):
        course = dict(id=course_id, title=title, variants={})
        for variant in ("female", "male"):
            if course_id == COURSE_ID and variant == "female":
                program, definitions = _legacy_female(legacy_course, legacy_workouts)
            else:
                program, definitions = _program(course_id, title, variant, by_id, legacy_course)
            course["variants"][variant] = program
            workouts.extend(definitions)
        courses.append(course)
    return courses, workouts
