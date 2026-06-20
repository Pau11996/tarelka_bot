#!/bin/sh
set -eu

: "${TELEGRAM_BOT_USERNAME:=taarelka_bot}"
: "${LANDING_TITLE:=ТАРЕЛКА}"

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

export TELEGRAM_BOT_USERNAME LANDING_TITLE FEEDBACK_LINK_HTML FEEDBACK_NAV_HTML FEEDBACK_FAQ_HTML

envsubst '${TELEGRAM_BOT_USERNAME} ${LANDING_TITLE} ${FEEDBACK_LINK_HTML} ${FEEDBACK_NAV_HTML} ${FEEDBACK_FAQ_HTML}' \
    < /usr/share/nginx/html/index.template.html \
    > /usr/share/nginx/html/index.html

exec nginx -g 'daemon off;'
