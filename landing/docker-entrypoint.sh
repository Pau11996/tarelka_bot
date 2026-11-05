#!/bin/sh
set -eu

: "${TELEGRAM_BOT_USERNAME:=taarelka_bot}"
: "${LANDING_BOT_USERNAME:=taarelka_bot}"
: "${LANDING_TITLE:=ТАРЕЛКА}"
: "${SUPPORT_EMAIL:=help.4posts@gmail.com}"
: "${LEGAL_OPERATOR_NAME:=Администратор сервиса ТАРЕЛКА}"
: "${LEGAL_OPERATOR_STATUS:=Самозанятый}"
: "${LEGAL_OPERATOR_UNP:=}"
: "${LEGAL_OPERATOR_ADDRESS:=}"
: "${LEGAL_OPERATOR_PHONE:=}"
: "${FREE_PHOTO_DAILY_LIMIT:=3}"
: "${FREE_TEXT_DAILY_LIMIT:=60}"
: "${FREE_VOICE_DAILY_LIMIT:=10}"
: "${SUBSCRIPTION_DAILY_LIMIT:=30}"
: "${SUBSCRIPTION_VOICE_DAILY_LIMIT:=30}"
: "${SUBSCRIPTION_PRICE_STARS:=150}"
: "${SUBSCRIPTION_PRICE_RUB:=399}"
: "${SUBSCRIPTION_DURATION_DAYS:=30}"
: "${REFERRAL_MONTHLY_GOAL:=5}"
: "${LANDING_HOST:=tarelkaa.by}"
LANDING_ORIGIN="${LANDING_ORIGIN:-https://${LANDING_HOST}}"
LANDING_ORIGIN="${LANDING_ORIGIN%/}"

: "${TELEGRAM_FEEDBACK_CHAT:=}"

# Public contact details are plain text, never executable HTML.
html_escape() {
    printf '%s' "$1" | sed 's/\&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g; s/'"'"'/\&#39;/g'
}
LEGAL_OPERATOR_NAME=$(html_escape "$LEGAL_OPERATOR_NAME")
LEGAL_DETAILS_HTML=$(cat <<EOF
<section class="legal-details" id="requisites" aria-labelledby="requisites-title">
    <h2 id="requisites-title">Контакты и реквизиты</h2>
    <p class="legal-details-name">${LEGAL_OPERATOR_NAME}</p>
    <p>$(html_escape "$LEGAL_OPERATOR_STATUS")</p>
    <dl>
EOF
)
if [ -n "$LEGAL_OPERATOR_UNP" ]; then
    LEGAL_DETAILS_HTML="${LEGAL_DETAILS_HTML}<div><dt>УНП</dt><dd>$(html_escape "$LEGAL_OPERATOR_UNP")</dd></div>"
fi
if [ -n "$LEGAL_OPERATOR_ADDRESS" ]; then
    LEGAL_DETAILS_HTML="${LEGAL_DETAILS_HTML}<div><dt>Почтовый адрес</dt><dd>$(html_escape "$LEGAL_OPERATOR_ADDRESS")</dd></div>"
fi
if [ -n "$LEGAL_OPERATOR_PHONE" ]; then
    LEGAL_PHONE_HREF=$(printf '%s' "$LEGAL_OPERATOR_PHONE" | tr -cd '+0-9')
    LEGAL_DETAILS_HTML="${LEGAL_DETAILS_HTML}<div><dt>Телефон</dt><dd><a href=\"tel:${LEGAL_PHONE_HREF}\">$(html_escape "$LEGAL_OPERATOR_PHONE")</a></dd></div>"
fi
LEGAL_DETAILS_HTML="${LEGAL_DETAILS_HTML}<div><dt>Электронная почта</dt><dd><a href=\"mailto:$(html_escape "$SUPPORT_EMAIL")\">$(html_escape "$SUPPORT_EMAIL")</a></dd></div></dl></section>"
export LEGAL_DETAILS_HTML

if [ -n "$TELEGRAM_FEEDBACK_CHAT" ]; then
    case "$TELEGRAM_FEEDBACK_CHAT" in
        http*) FEEDBACK_URL="$TELEGRAM_FEEDBACK_CHAT" ;;
        *) FEEDBACK_URL="https://t.me/${TELEGRAM_FEEDBACK_CHAT#@}" ;;
    esac
    FEEDBACK_LINK_HTML="<a class=\"link-accent\" href=\"${FEEDBACK_URL}\" target=\"_blank\" rel=\"noopener noreferrer\">💬 Чат поддержки</a>"
    FEEDBACK_NAV_HTML="<a class=\"link-accent nav-support-link\" href=\"${FEEDBACK_URL}\" target=\"_blank\" rel=\"noopener noreferrer\">💬 Поддержка</a>"
    FEEDBACK_FAQ_HTML="<article class=\"faq-item\"><h3>Куда писать с вопросами?</h3><p>Задавайте вопросы, делитесь идеями и сообщайте о проблемах в <a class=\"link-accent\" href=\"${FEEDBACK_URL}\" target=\"_blank\" rel=\"noopener noreferrer\">чате поддержки</a>.</p></article>"
else
    FEEDBACK_LINK_HTML=""
    FEEDBACK_NAV_HTML=""
    FEEDBACK_FAQ_HTML=""
fi

export TELEGRAM_BOT_USERNAME LANDING_BOT_USERNAME LANDING_TITLE SUPPORT_EMAIL LEGAL_OPERATOR_NAME
export FREE_PHOTO_DAILY_LIMIT FREE_TEXT_DAILY_LIMIT FREE_VOICE_DAILY_LIMIT
export SUBSCRIPTION_DAILY_LIMIT SUBSCRIPTION_VOICE_DAILY_LIMIT SUBSCRIPTION_PRICE_STARS SUBSCRIPTION_PRICE_RUB SUBSCRIPTION_DURATION_DAYS
export REFERRAL_MONTHLY_GOAL
export FEEDBACK_LINK_HTML FEEDBACK_NAV_HTML FEEDBACK_FAQ_HTML
export LANDING_HOST LANDING_ORIGIN

PUBLIC_DIR="${LANDING_PUBLIC_DIR:-/usr/share/nginx/html}"

# Only offer the standalone APK after a release file has been installed here.
# Development-client APKs in outputs/ intentionally never enter the website image.
if [ -s "$PUBLIC_DIR/downloads/tarelka.apk" ]; then
    ANDROID_DOWNLOAD_HTML='<a class="lp-button" href="/downloads/tarelka.apk" download="tarelka.apk"><svg class="lp-icon" aria-hidden="true"><use href="#i-download"/></svg> Скачать APK для Android</a>
                        <p class="lp-android-note">Прямая установка на Android. Для работы нужен интернет.</p>
                        <details class="lp-android-install"><summary>Как установить APK</summary><p>Откройте скачанный файл на Android-телефоне. Если система попросит, разрешите установку для браузера, из которого скачали приложение, и подтвердите установку.</p></details>'
else
    ANDROID_DOWNLOAD_HTML='<button class="lp-button" type="button" disabled>APK скоро появится</button>
                        <p class="lp-android-note">Готовим приложение к скачиванию. Пока дневник доступен в Telegram.</p>'
fi
export ANDROID_DOWNLOAD_HTML

# Public measurement ID. It only identifies the GA4 web stream.
GA_MEASUREMENT_ID="${GA_MEASUREMENT_ID:-G-DBX8MSSJDK}"
if ! printf '%s' "$GA_MEASUREMENT_ID" | grep -Eq '^G-[A-Z0-9]+$'; then
    echo "GA_MEASUREMENT_ID must look like G-XXXXXXXX" >&2
    exit 1
fi
GA_TAG_HTML="<link rel=\"stylesheet\" href=\"/analytics.css?v=20261013\">
    <script src=\"/analytics.js?v=20261013\" data-measurement-id=\"${GA_MEASUREMENT_ID}\" data-site-origin=\"${LANDING_ORIGIN}\" data-bot-username=\"${LANDING_BOT_USERNAME}\" defer></script>"
export GA_TAG_HTML

TEMPLATE_VARIABLES='${LANDING_BOT_USERNAME} ${LANDING_TITLE} ${LANDING_ORIGIN} ${SUPPORT_EMAIL} ${LEGAL_OPERATOR_NAME} ${LEGAL_DETAILS_HTML} ${FREE_PHOTO_DAILY_LIMIT} ${FREE_TEXT_DAILY_LIMIT} ${FREE_VOICE_DAILY_LIMIT} ${SUBSCRIPTION_DAILY_LIMIT} ${SUBSCRIPTION_VOICE_DAILY_LIMIT} ${SUBSCRIPTION_PRICE_STARS} ${SUBSCRIPTION_PRICE_RUB} ${SUBSCRIPTION_DURATION_DAYS} ${REFERRAL_MONTHLY_GOAL} ${FEEDBACK_LINK_HTML} ${FEEDBACK_NAV_HTML} ${FEEDBACK_FAQ_HTML} ${ANDROID_DOWNLOAD_HTML} ${GA_TAG_HTML}'

# Render nested blog/about pages as well as the homepage and legal pages.
find "$PUBLIC_DIR" -type f -name '*.template.html' | sort | while IFS= read -r template; do
    envsubst "$TEMPLATE_VARIABLES" < "$template" > "${template%.template.html}.html"
done

envsubst '${TELEGRAM_BOT_USERNAME}' \
    < "$PUBLIC_DIR/admin.html" > "$PUBLIC_DIR/admin.rendered.html"
mv "$PUBLIC_DIR/admin.rendered.html" "$PUBLIC_DIR/admin.html"

envsubst '${GA_TAG_HTML}' \
    < "$PUBLIC_DIR/404.html" > "$PUBLIC_DIR/404.rendered.html"
mv "$PUBLIC_DIR/404.rendered.html" "$PUBLIC_DIR/404.html"

# Static assets are cached for a week. Change their URLs with every content change
# so returning visitors do not combine new markup with old CSS or JavaScript.
ASSET_VERSION=$(find "$PUBLIC_DIR" -type f \( -name '*.css' -o -name '*.js' \) \
    -exec sha256sum {} \; | sort | sha256sum | cut -c1-12)
find "$PUBLIC_DIR" -type f -name '*.html' ! -name '*.template.html' | while IFS= read -r page; do
    sed -E 's@((src|href)="/[^"?]+\.(css|js))(\?[^\"]*)?"@\1?v='"$ASSET_VERSION"'"@g' \
        "$page" > "$page.versioned"
    mv "$page.versioned" "$page"
done

cat > "$PUBLIC_DIR/robots.txt" <<EOF
User-agent: *
Allow: /

Disallow: /admin
Disallow: /health

Sitemap: ${LANDING_ORIGIN}/sitemap.xml
EOF

# Canonicals are the single source of truth for indexable template URLs.
{
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    find "$PUBLIC_DIR" -type f -name '*.template.html' | sort | while IFS= read -r template; do
        page="${template%.template.html}.html"
        if grep -qi 'content="[^"]*noindex' "$page"; then continue; fi
        canonical=$(sed -n 's/.*<link rel="canonical" href="\([^"]*\)".*/\1/p' "$page")
        if [ -n "$canonical" ]; then printf '  <url><loc>%s</loc></url>\n' "$canonical"; fi
    done
    printf '%s\n' '</urlset>'
} > "$PUBLIC_DIR/sitemap.xml"

# The same rendering path can be checked locally without starting nginx.
if [ "${LANDING_RENDER_ONLY:-0}" = "1" ]; then exit 0; fi

envsubst '${LANDING_HOST}' \
    < /opt/nginx.conf.template \
    > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
