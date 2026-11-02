"""Authored 28-day introductory course. Version 1 is immutable once released."""
COURSE_ID = "full_body_28_v1"
LEVELS = {"light": ("Лёгкий", 20), "medium": ("Средний", 30), "intense": ("Интенсивный", 40)}

A = ["standing_knee_elbow", "sumo_squat", "incline_pushup", "squat_kick", "chair_dip", "prone_pull", "plank_pike", "seated_knee_tuck", "crunch_reach"]
B = ["standing_knee_elbow", "sumo_squat", "incline_pushup", "calf_raise", "leg_left", "leg_right", "prone_pull", "crunch_reach"]
C = ["standing_knee_elbow", "squat_kick", "incline_pushup", "sumo_squat", "chair_dip", "prone_pull", "plank_pike", "seated_knee_tuck"]
A2 = ["glute_bridge" if x == "seated_knee_tuck" else x for x in A]
B2 = B[:-1] + ["glute_bridge", "crunch_reach"]
C2 = C[:-1] + ["glute_bridge", "seated_knee_tuck"]
A3 = ["bird_dog" if x == "plank_pike" else x for x in A2]
B3 = ["bird_dog" if x == "crunch_reach" else x for x in B2]
C3 = ["bird_dog" if x == "seated_knee_tuck" else x for x in C2]
SEQUENCES = {1: A, 3: B, 5: C, 8: A2, 10: B2, 12: C2, 15: A3, 17: B3, 19: C3,
             22: A3 + ["sumo_squat", "glute_bridge"], 24: C3 + ["incline_pushup", "prone_pull"], 26: A}
TITLES = {1: "Старт", 3: "Акцент на ноги", 5: "Координация", 8: "Знакомство с мостом", 10: "Ноги и ягодицы",
          12: "Закрепляем движения", 15: "Устойчивый корпус", 17: "Ноги и контроль корпуса", 19: "Всё тело",
          22: "Чуть больше объёма", 24: "Закрепление", 26: "Сравнение со стартом"}
WALK_MINUTES = {2: 10, 6: 15, 9: 15, 13: 20, 16: 20, 20: 20, 23: 25, 27: 25}
MOBILITY_DAYS = {4, 11, 18, 25}
STRETCH = [("hands_behind", 30), ("quad_right", 30), ("quad_left", 30)]
WARMUP = [("march", 120), ("side_step", 60), ("shoulders", 30), ("arm_raise", 30), ("squat", 30), ("wall_push", 30)]
MOBILITY = [("march", 180)] + [(x, 30) for x in ["shoulders", "arm_raise", "bend_left", "bend_right", "hands_behind", "quad_right", "quad_left", "stretch_right", "stretch_left"]]


def build_course(exercises):
    by_id = {e["id"]: e for e in exercises}
    days, workouts = [], []
    for day in range(1, 29):
        kind = "strength" if day in SEQUENCES else "mobility" if day in MOBILITY_DAYS else "walk" if day in WALK_MINUTES else "rest"
        title = TITLES.get(day, {"mobility": "Мягкая подвижность", "walk": "Прогулка", "rest": "Отдых и восстановление"}.get(kind))
        entry = dict(day=day, week=(day - 1) // 7 + 1, kind=kind, title=title, workout_ids={},
                     walk_minutes=WALK_MINUTES.get(day), description="")
        if kind == "walk":
            entry["description"] = f"Прогулка в удобном темпе около {WALK_MINUTES[day]} минут. После — руки за спиной и растяжка каждого бедра по 30 секунд."
        elif kind == "rest":
            entry["description"] = "Без обязательной тренировки. Обычная повседневная активность по самочувствию." if day != 28 else "Курс завершён. Отдохните и сравните самочувствие и качество движений со стартом."
        else:
            for level, (label, seconds) in LEVELS.items():
                wid = f"fb28_d{day:02}_{level}"
                entry["workout_ids"][level] = wid
                steps = []

                def add(exercise_id, duration, rest, section, optional=False):
                    steps.append(dict(id=f"{wid}-{len(steps) + 1}", exercise_id=exercise_id,
                                      duration_seconds=duration, repetitions=None, expected_seconds=duration,
                                      rest_seconds=rest, section=section, optional=optional))

                if kind == "strength":
                    for ex, duration in WARMUP:
                        add(ex, duration, 0, "warmup")
                    for i, ex in enumerate(SEQUENCES[day]):
                        # Level affects time only; identical sequence, rest, technique and animation.
                        duration = seconds + (5 if day >= 15 and day != 26 and ex != "bird_dog" else 0)
                        add(ex, duration, 30, "main", day in (22, 24) and i >= 9)
                    add("march", 300, 0, "cooldown")
                    for ex, duration in STRETCH:
                        add(ex, duration, 10, "stretch")
                else:
                    for i, (ex, duration) in enumerate(MOBILITY):
                        add(ex, duration, 10 if i in (0, 3, 6) else 0, "mobility")
                steps[-1]["rest_seconds"] = 0
                used = {s["exercise_id"] for s in steps}
                workouts.append(dict(id=wid, title=f"Всё тело · День {day} · {label}", subtitle=title,
                    focus="Всё тело" if kind == "strength" else "Восстановление", level=label,
                    equipment=sorted({v for ex in used for v in by_id[ex]["equipment"]}),
                    space="Место, чтобы лечь во весь рост, вытянуть руки и шагнуть в сторону",
                    preview_exercise_id="standing_knee_elbow" if kind == "strength" else "hands_behind",
                    duration_seconds=sum(s["expected_seconds"] + s["rest_seconds"] for s in steps), steps=steps,
                    course_id=COURSE_ID, course_day=day, activity_level=level, kind=kind))
        days.append(entry)
    return dict(id=COURSE_ID, title="Всё тело — 28 дней", days=days), workouts


def required_course_steps(definition):
    return [s for s in definition["steps"] if s.get("section") in ("main", "mobility") and not s.get("optional")]
