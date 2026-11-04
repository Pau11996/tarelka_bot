"""Short introductory curriculum, published in catalogue 4.

Keep the course identity/calendar so previously completed days remain credited.
Every revised workout has a new ID; catalogue 3 remains immutable.
References: https://acsm.org/resistance-training-guidelines-update-2026/
https://www.cdc.gov/physical-activity-basics/guidelines/adults.html
"""
from src.shared.workout_course import COURSE_ID

LEVELS = {"light": ("Лёгкий", 6), "medium": ("Средний", 8), "intense": ("Интенсивный", 10)}
A = ["squat", "wall_push", "calf_raise", "prone_pull", "glute_bridge"]
B = ["squat", "wall_push", "leg_left", "leg_right", "prone_pull", "glute_bridge"]
C = ["squat", "wall_push", "prone_pull", "glute_bridge", "quadruped_leg"]
SEQUENCES = {1: A, 3: B, 5: A, 8: C, 10: B, 12: C, 15: C, 17: B, 19: C, 22: C, 24: B, 26: A}
TITLES = {1: "Знакомство с движениями", 3: "Ноги и равновесие", 5: "Повторяем основу",
          8: "Контроль корпуса", 10: "Уверенная опора", 12: "Закрепляем технику",
          15: "Движения под контролем", 17: "Ноги и ягодицы", 19: "В своём темпе",
          22: "Уверенное выполнение", 24: "Закрепляем привычку", 26: "Сравнение со стартом"}
WALK_MINUTES = {2: 15, 6: 15, 9: 20, 13: 20, 16: 25, 20: 25, 23: 30, 27: 30}
MOBILITY_DAYS = {4, 11, 18, 25}
# Five minutes of gradual warming up, with fewer separate transitions.
WARMUP = [("march", 180), ("side_step", 90), ("shoulders", 30)]
MOBILITY = [("march", 120), ("shoulders", 30), ("arm_raise", 30),
            ("bend_left", 30), ("bend_right", 30), ("chest", 30)]


def build_course(exercises):
    by_id = {e["id"]: e for e in exercises}
    days, workouts = [], []
    for day in range(1, 29):
        kind = "strength" if day in SEQUENCES else "mobility" if day in MOBILITY_DAYS else "walk" if day in WALK_MINUTES else "rest"
        week = (day - 1) // 7 + 1
        title = TITLES.get(day, {"mobility": "Мягкая подвижность", "walk": "Прогулка", "rest": "Отдых и восстановление"}.get(kind))
        description = ""
        if kind == "walk":
            description = (f"Прогулка около {WALK_MINUTES[day]} минут. Можно разделить её на короткие выходы. "
                           "Выберите темп, при котором дышите чаще, но можете разговаривать. "
                           "Начните и закончите спокойно. Если пока тяжело, сократите время. "
                           "В остальные дни добавляйте посильную ходьбу и постепенно приближайтесь к 150 минутам умеренной активности в неделю. "
                           "Дополнительная растяжка — по желанию.")
        elif kind == "rest":
            description = ("Без обязательной тренировки. Обычная активность и прогулка по желанию. "
                           + ("Курс завершён. Сравните уверенность движений и усилие с первым занятием." if day == 28 else "Отдых помогает восстановиться к следующему занятию."))
        elif kind == "strength":
            description = ("Один подход каждого упражнения. Выполняйте повторы плавно, без гонки с таймером. "
                           "Заканчивайте подход до потери техники; отдых можно продлевать. "
                           "Если тяжело, выберите лёгкую нагрузку или облегчение в описании упражнения. "
                           "Повышайте уровень только после уверенного выполнения и нормального восстановления.")
            if day == 26:
                description += " Для сравнения выберите ту же нагрузку и положение опоры, что в день 1."
        else:
            description = "Шесть спокойных движений. Не стремитесь увеличить амплитуду через дискомфорт."
        entry = dict(day=day, week=week, kind=kind, title=title, description=description,
                     workout_ids={}, walk_minutes=WALK_MINUTES.get(day))
        if kind in ("strength", "mobility"):
            for level, (label, reps) in LEVELS.items():
                wid = f"fb28r2_d{day:02}_{level}"
                entry["workout_ids"][level] = wid
                steps = []

                def add(exercise_id, section, seconds=None, repetitions=None):
                    steps.append(dict(id=f"{wid}-{len(steps) + 1}", exercise_id=exercise_id,
                                      section=section, duration_seconds=seconds, repetitions=repetitions,
                                      expected_seconds=seconds if seconds is not None else repetitions * (5 if exercise_id in ("bird_dog", "quadruped_leg") else 4),
                                      rest_seconds=30 if section == "main" else 15, optional=False))

                if kind == "strength":
                    for ex, seconds in WARMUP:
                        add(ex, "warmup", seconds=seconds)
                    for ex in SEQUENCES[day]:
                        # Skill progression is chosen by the user, never forced by the calendar.
                        if ex == "quadruped_leg" and level == "intense":
                            ex = "bird_dog"
                        add(ex, "main", repetitions=reps)
                    add("march", "cooldown", seconds=300)
                    add("chest", "stretch", seconds=30)
                else:
                    for ex, seconds in MOBILITY:
                        add(ex, "mobility", seconds=seconds)
                used = {s["exercise_id"] for s in steps}
                workouts.append(dict(id=wid, title=f"Всё тело · День {day} · {label}", subtitle=title,
                    focus="Всё тело" if kind == "strength" else "Восстановление", level=label,
                    equipment=sorted({v for ex in used for v in by_id[ex]["equipment"]}),
                    space="Место для шага в сторону и упражнений на коврике", preview_exercise_id="squat" if kind == "strength" else "march",
                    duration_seconds=sum(s["expected_seconds"] + s["rest_seconds"] for s in steps),
                    steps=steps, course_id=COURSE_ID, course_day=day, activity_level=level, kind=kind, curriculum_revision=2))
        days.append(entry)
    return dict(id=COURSE_ID, title="Всё тело — 28 дней", revision=2, days=days), workouts
