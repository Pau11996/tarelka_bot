# Android push

Firebase-проект: `tarelka-8622c`, Android package: `by.tarelka.app`.
EAS Project ID: `857cec7e-bc63-4d60-a028-04648c5f9820`.

## Конфигурация

Публичный файл `mobile/google-services.json` подключён через
`expo.android.googleServicesFile` в `mobile/app.json`. Он содержит клиентскую
конфигурацию Firebase и должен попадать в Git и исходники EAS Build.

Приватный JSON сервисного аккаунта загружен в EAS Credentials → Android →
`by.tarelka.app` → Push Notifications (FCM V1). Ключ хранится в EAS; в репозиторий,
APK и окружение API его добавлять не нужно. Маски Firebase Admin SDK и
`service-account*.json` исключены в `mobile/.gitignore`.

Приложение получает Expo Push Token и регистрирует его через `/v1/devices`.
Сервер отправляет уведомления через Expo Push Service, который использует
привязанный FCM v1 ключ. Серверная интеграция уже реализована.

## Проверено 1 ноября 2026

- Firebase-проект в обоих JSON совпадает, package соответствует приложению.
- Google OAuth принимает ключ; валидный запрос FCM `messages:send` с
  `validate_only=true` возвращает HTTP 200. Реальные сообщения эта проверка
  не отправляет.
- После загрузки EAS показывает ключ FCM v1 у `by.tarelka.app`.
- Исходники EAS Build включают публичный JSON и исключают приватные ключи.
- В отдельной копии исходников Expo prebuild копирует JSON в
  `android/app/google-services.json` и подключает Google Services Gradle plugin.
- Нативная задача Gradle `:app:processReleaseGoogleServices` проходит.
- TypeScript, тесты модуля уведомлений и Android JavaScript export проходят.

После завершения доработок тренировок полный набор из 283 мобильных тестов
проходит, включая записанные анимации и защищённые фото. Тестам с локальным
HTTP-сервером требуется разрешённый localhost-порт. Фактическое получение push
на Android ещё не проверено.

## Сборка и проверка на телефоне

1. Подготовить релизный коммит. Перед публикацией APK проверить, что этот коммит
   есть в удалённой ветке GitHub, как требует `AGENTS.md`. Если push ещё не
   разрешён пользователем, публикацию приостановить.
2. Собрать новый APK из опубликованного коммита:
   `cd mobile && eas build --platform android --profile preview`.
   Уже установленный APK 1.0.4 не содержит этой конфигурации; обновления
   JavaScript недостаточно.
3. Установить APK на физический Android, войти и открыть настройки уведомлений.
   Выбрать уведомления в приложении и разрешить их в системном диалоге.
4. Убедиться, что `/v1/devices` зарегистрировал Expo Push Token этой установки.
   Отправить тест на этот токен через Expo Push Service или
   [официальный инструмент Expo](https://expo.dev/notifications).
5. Проверить уведомление в открытом приложении и в фоне, открытие нужного экрана
   по нажатию и отключение уведомлений в настройках.

Полная проверка новой регистрации по email дополнительно требует обновлённого
API, миграции `025_email_verification` и SMTP — это отдельные подготовленные
локальные изменения.

Настройка основана на [официальной инструкции Expo по FCM v1](https://docs.expo.dev/push-notifications/fcm-credentials/).
