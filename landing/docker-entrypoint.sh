#!/bin/sh
set -eu

: "${TELEGRAM_BOT_USERNAME:=taarelka_bot}"
: "${LANDING_TITLE:=ТАРЕЛКА}"
: "${SUPPORT_EMAIL:=help.4posts@gmail.com}"
: "${LEGAL_OPERATOR_NAME:=Администратор сервиса ТАРЕЛКА}"
: "${FREE_DAILY_LIMIT:=6}"
: "${SUBSCRIPTION_DAILY_LIMIT:=30}"
: "${SUBSCRIPTION_PRICE_STARS:=150}"
: "${SUBSCRIPTION_DURATION_DAYS:=30}"
: "${REFERRAL_BONUS_REQUESTS:=3}"
: "${LANDING_HOST:=tarelkaa.by}"
LANDING_ORIGIN="${LANDING_ORIGIN:-https://${LANDING_HOST}}"
LANDING_ORIGIN="${LANDING_ORIGIN%/}"

: "${TELEGRAM_FEEDBACK_CHAT:=}"

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

export TELEGRAM_BOT_USERNAME LANDING_TITLE SUPPORT_EMAIL LEGAL_OPERATOR_NAME
export FREE_DAILY_LIMIT SUBSCRIPTION_DAILY_LIMIT SUBSCRIPTION_PRICE_STARS SUBSCRIPTION_DURATION_DAYS
export REFERRAL_BONUS_REQUESTS
export FEEDBACK_LINK_HTML FEEDBACK_NAV_HTML FEEDBACK_FAQ_HTML
export LANDING_HOST LANDING_ORIGIN

envsubst '${LANDING_HOST}' \
    < /opt/nginx.conf.template \
    > /etc/nginx/conf.d/default.conf

cat > /usr/share/nginx/html/robots.txt <<EOF
User-agent: *
Allow: /

Disallow: /admin
Disallow: /health

Sitemap: ${LANDING_ORIGIN}/sitemap.xml
EOF

cat > /usr/share/nginx/html/sitemap.xml <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${LANDING_ORIGIN}/</loc></url>
  <url><loc>${LANDING_ORIGIN}/privacy.html</loc></url>
  <url><loc>${LANDING_ORIGIN}/terms.html</loc></url>
</urlset>
EOF

envsubst '${TELEGRAM_BOT_USERNAME} ${LANDING_TITLE} ${LANDING_ORIGIN} ${FREE_DAILY_LIMIT} ${SUBSCRIPTION_DAILY_LIMIT} ${SUBSCRIPTION_PRICE_STARS} ${SUBSCRIPTION_DURATION_DAYS} ${REFERRAL_BONUS_REQUESTS} ${FEEDBACK_LINK_HTML} ${FEEDBACK_NAV_HTML} ${FEEDBACK_FAQ_HTML}' \
    < /usr/share/nginx/html/index.template.html \
    > /usr/share/nginx/html/index.html

envsubst '${LANDING_TITLE} ${LANDING_ORIGIN} ${SUPPORT_EMAIL} ${LEGAL_OPERATOR_NAME}' \
    < /usr/share/nginx/html/privacy.template.html \
    > /usr/share/nginx/html/privacy.html

envsubst '${LANDING_TITLE} ${LANDING_ORIGIN} ${SUPPORT_EMAIL} ${LEGAL_OPERATOR_NAME} ${FREE_DAILY_LIMIT} ${SUBSCRIPTION_DAILY_LIMIT} ${SUBSCRIPTION_PRICE_STARS} ${SUBSCRIPTION_DURATION_DAYS}' \
    < /usr/share/nginx/html/terms.template.html \
    > /usr/share/nginx/html/terms.html

envsubst '${TELEGRAM_BOT_USERNAME} ${FREE_DAILY_LIMIT}' \
    < /usr/share/nginx/html/admin.html \
    > /tmp/admin.html
mv /tmp/admin.html /usr/share/nginx/html/admin.html

exec nginx -g 'daemon off;'
