# Обложки курсов «Всё тело» и «Всё тело + прогулки»

Текущие обложки находятся в `mobile/assets/workouts/courses/`:

| Курс | Мужская обложка | Женская обложка |
| --- | --- | --- |
| Всё тело | `full-body-home-male.png` | `full-body-home-female.png` |
| Всё тело + прогулки | `full-body-walk-male.png` | `full-body-walk-female.png` |

В каждом варианте сохранён один и тот же человек: дома рядом с ковриком и на
прогулке по парку. Исходные `full-body-gym-male.png` и `full-body-gym.png`
сохранены как референсы личности. Обложки созданы встроенным `image_gen`
с использованием исходных фото, без CLI/API-скриптов.

Формат 3:2, человек справа, свободное место для заголовка слева, мягкий дневной
свет и приглушённая зелёная палитра. Текст в изображение не встроен.
Все четыре ресурса включены через статический `require` в `CourseCard.tsx`
и доступны офлайн. `CoursePhoto` выбирает сцену по ID курса, человека — по
`profile_sex`. Мужской вариант используется только при `male`; иначе женский.
Карточка и страница курса передают одинаковые ID курса и вариант.
Подписей «Для мужчин» / «Для женщин» нет.

## Финальные промпты сцен

### full-body-home-male.png

Входное изображение: `full-body-gym-male.png` — референс личности и исходник для редактирования.

Use case: identity-preserve. Edit the supplied existing course cover into one new standalone photorealistic wellness course photograph. Input image 1 is the identity reference and edit target. Preserve this exact person's recognizable face, age, hairstyle, natural body proportions, skin tone and sage-green sports clothing. Keep the established soft natural daylight, muted green palette and realistic editorial photography. Horizontal 3:2, 1536x1024. Place the person in the right half, full head visible with headroom, keep the left half spacious and visually quiet, subtly darker, for white UI title overlay. No text, logos, watermarks, collage or UI. Show the same man in a comfortable modern home workout corner, standing at ease beside a rolled exercise mat, sage-painted wall, warm wooden floor and a softly lit living-room window. Preserve his face and green T-shirt and dark shorts. This is clearly an ordinary home, with no gym equipment. Frame head to upper thighs, relaxed natural posture.

### full-body-walk-male.png

Входное изображение: `full-body-gym-male.png` — референс личности и исходник для редактирования.

Use case: identity-preserve. Edit the supplied existing course cover into one new standalone photorealistic wellness course photograph. Input image 1 is the identity reference and edit target. Preserve this exact person's recognizable face, age, hairstyle, natural body proportions, skin tone and sage-green sports clothing. Keep the established soft natural daylight, muted green palette and realistic editorial photography. Horizontal 3:2, 1536x1024. Place the person in the right half, full head visible with headroom, keep the left half spacious and visually quiet, subtly darker, for white UI title overlay. No text, logos, watermarks, collage or UI. Show the same man taking a relaxed walk along a leafy park path. Slightly turned, an easy natural walking stride, arms swinging gently, friendly calm expression. Preserve his face, green T-shirt and dark shorts. Soft trees and path in the background, no other people. The scene must clearly read as a walk outdoors. Frame head to knees, right-half placement, leafy uncluttered negative space on the left.

### full-body-home-female.png

Входное изображение: `full-body-gym.png` — референс личности и исходник для редактирования.

Use case: identity-preserve. Edit the supplied existing course cover into one new standalone photorealistic wellness course photograph. Input image 1 is the identity reference and edit target. Preserve this exact person's recognizable face, age, hairstyle, natural body proportions, skin tone and sage-green sports clothing. Keep the established soft natural daylight, muted green palette and realistic editorial photography. Horizontal 3:2, 1536x1024. Place the person in the right half, full head visible with headroom, keep the left half spacious and visually quiet, subtly darker, for white UI title overlay. No text, logos, watermarks, collage or UI. Show the same woman in a comfortable modern home workout corner, standing at ease beside a rolled exercise mat, sage-painted wall, warm wooden floor and a softly lit living-room window. Preserve her face, ponytail and matching sage-green sports top and leggings. This is clearly an ordinary home, with no gym equipment. Frame head to upper thighs, relaxed natural posture.

### full-body-walk-female.png

Входное изображение: `full-body-gym.png` — референс личности и исходник для редактирования.

Use case: identity-preserve. Edit the supplied existing course cover into one new standalone photorealistic wellness course photograph. Input image 1 is the identity reference and edit target. Preserve this exact person's recognizable face, age, hairstyle, natural body proportions, skin tone and sage-green sports clothing. Keep the established soft natural daylight, muted green palette and realistic editorial photography. Horizontal 3:2, 1536x1024. Place the person in the right half, full head visible with headroom, keep the left half spacious and visually quiet, subtly darker, for white UI title overlay. No text, logos, watermarks, collage or UI. Show the same woman taking a relaxed walk along a leafy park path. Slightly turned, an easy natural walking stride, arms swinging gently, friendly calm expression. Preserve her face, ponytail and matching sage-green sports top and leggings. Soft trees and path in the background, no other people. The scene must clearly read as a walk outdoors. Frame head to knees, right-half placement, leafy uncluttered negative space on the left.

## Исходные референсы

### Финальный промпт женской обложки

Use case: photorealistic-natural. Asset type: landscape photograph for the cover of a full-body workout course in a Russian wellness mobile app. Primary request: an adult woman in sports clothing inside a gym. Scene: a bright contemporary gym, subtle strength-training equipment and large windows softly out of focus. Subject: a friendly athletic woman around 28 years old, natural healthy proportions, dark hair tied into a ponytail, wearing a coordinated muted sage-green sports top and high-waisted leggings, standing at ease with a relaxed confident smile, framed from head to upper thighs. Composition: horizontal 3:2 editorial fitness photograph, subject on the right half, generous calm darker green gym background on the left suitable for a title overlay added later by the app. Keep full head inside frame with generous top margin. Lighting: soft daylight, realistic skin texture, warm inviting atmosphere. Premium but approachable wellness photography. Constraints: no writing, no letters, no logos, no watermark, no collage, no UI, no extreme physique, no exaggerated retouching. This is a new original photograph, not a reproduction of any reference person.

### Финальный промпт мужской обложки

Создана встроенным `image_gen`, непрозрачный фон. Результат сохранён в ресурсы
приложения без изменения существующей женской фотографии.

Use case: photorealistic-natural. Create one new original landscape photograph for a full-body workout course in a Russian wellness mobile app. Match this established art direction: horizontal 3:2 editorial fitness photograph, muted sage green palette, soft natural daylight, a bright contemporary gym with large windows and subtle equipment softly out of focus. An adult man around 30 with a natural healthy athletic build, short dark hair, wearing a muted sage-green athletic T-shirt and dark workout shorts, relaxed confident smile, framed from full head to upper thighs. Place the man on the right half, generous headroom, and calm darker green negative space across the left half for a title overlay added later by the app. Realistic skin texture, approachable wellness photography. No text, no letters, no logos, no watermark, no collage, no UI, no exaggerated bodybuilding physique. Opaque background. Deliver the standalone photo.
